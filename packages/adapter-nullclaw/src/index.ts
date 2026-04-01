import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NmdealclawEvent, RuntimeAdapter, RuntimeRunHandle, SendTaskInput } from "@nmdealclaw/protocol";

export interface NullClawAdapterOptions {
  baseUrl?: string;
  token?: string;
  pairingCode?: string;
  timeoutMs?: number;
  useStreaming?: boolean;
  useTaskContextId?: boolean;
  /**
   * JSON file for persisting local->remote task ids across restarts.
   */
  mappingFilePath?: string;
}

interface JsonRpcEnvelope {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface A2ATaskObject {
  id?: string;
  kind?: string;
  contextId?: string;
  status?: {
    state?: string;
    timestamp?: string;
  };
  artifacts?: Array<{
    artifactId?: string;
    parts?: Array<{ kind?: string; text?: string }>;
  }>;
}

interface A2ATaskListResult {
  tasks?: A2ATaskObject[];
  nextPageToken?: string;
  pageSize?: number;
  totalSize?: number;
}

interface ArtifactUpdateResult {
  kind?: "artifact-update";
  taskId?: string;
  contextId?: string;
  artifact?: {
    artifactId?: string;
    parts?: Array<{ kind?: string; text?: string }>;
  };
  append?: boolean;
  lastChunk?: boolean;
}

interface StatusUpdateResult {
  kind?: "status-update";
  taskId?: string;
  contextId?: string;
  status?: {
    state?: string;
    timestamp?: string;
  };
  final?: boolean;
}

interface StreamState {
  serverTaskId?: string;
  contextId?: string;
  aggregatedText: string;
  completed: boolean;
}

function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value && value.trim() ? value.trim() : undefined;
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureNoTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

function extractToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const token = record["token"];
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

function isJsonRpcEnvelope(value: unknown): value is JsonRpcEnvelope {
  return !!value && typeof value === "object" && (value as { jsonrpc?: unknown }).jsonrpc === "2.0";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function getEnvelopeErrorMessage(envelope: JsonRpcEnvelope): string | undefined {
  return envelope.error?.message?.trim() ? envelope.error.message : undefined;
}

function getEnvelopeErrorCode(envelope: JsonRpcEnvelope): number | undefined {
  return envelope.error?.code;
}

function asTaskObject(value: unknown): A2ATaskObject | undefined {
  if (!isRecord(value)) return undefined;
  if ((value as Record<string, unknown>)["kind"] !== "task") return undefined;
  return value as A2ATaskObject;
}

function asTaskListResult(value: unknown): A2ATaskListResult | undefined {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray((value as Record<string, unknown>)["tasks"])) return undefined;
  return value as A2ATaskListResult;
}

function asArtifactUpdate(value: unknown): ArtifactUpdateResult | undefined {
  if (!isRecord(value)) return undefined;
  if ((value as Record<string, unknown>)["kind"] !== "artifact-update") return undefined;
  return value as ArtifactUpdateResult;
}

function asStatusUpdate(value: unknown): StatusUpdateResult | undefined {
  if (!isRecord(value)) return undefined;
  if ((value as Record<string, unknown>)["kind"] !== "status-update") return undefined;
  return value as StatusUpdateResult;
}

function extractArtifactText(update: ArtifactUpdateResult): string {
  const parts = update.artifact?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

function extractTaskArtifactText(task: A2ATaskObject): string {
  const artifacts = task.artifacts ?? [];
  return artifacts
    .flatMap((artifact) => artifact.parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

function contentType(headers: Headers): string {
  return headers.get("content-type")?.toLowerCase() ?? "";
}

export class NullClawAdapter implements RuntimeAdapter {
  readonly id = "nullclaw";
  readonly displayName = "NullClaw";

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly useStreaming: boolean;
  private readonly useTaskContextId: boolean;
  private readonly mappingFilePath: string;
  private token?: string;
  private pairingCode?: string;
  private readonly remoteTaskIds = new Map<string, string>();

  constructor(options: NullClawAdapterOptions = {}) {
    this.baseUrl = ensureNoTrailingSlash(options.baseUrl ?? env("NULLCLAW_BASE_URL") ?? "http://127.0.0.1:3000");
    this.token =
      options.token ??
      env("NULLCLAW_GATEWAY_TOKEN") ??
      env("NULLCLAW_WEB_TOKEN") ??
      env("OPENCLAW_GATEWAY_TOKEN");
    this.pairingCode = options.pairingCode ?? env("NULLCLAW_PAIRING_CODE");
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.useStreaming = options.useStreaming ?? true;
    this.useTaskContextId = options.useTaskContextId ?? true;
    this.mappingFilePath =
      options.mappingFilePath ??
      env("NMDEALCLAW_NULLCLAW_MAP") ??
      ".nmdealclaw/nullclaw-task-map.json";

    this.loadRemoteTaskMapping();
  }

  getRemoteTaskId(localTaskId: string): string | undefined {
    return this.remoteTaskIds.get(localTaskId);
  }

  async connect(): Promise<void> {
    if (this.token) return;

    if (!this.pairingCode) {
      throw new Error(
        "NullClaw adapter is not authenticated. Set NULLCLAW_GATEWAY_TOKEN or provide NULLCLAW_PAIRING_CODE."
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/pair`, {
        method: "POST",
        headers: { "X-Pairing-Code": this.pairingCode },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`NullClaw pairing failed with HTTP ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const token = extractToken(payload);
      if (!token) throw new Error("NullClaw pairing succeeded but no token was returned.");
      this.token = token;
    } finally {
      clearTimeout(timeout);
    }
  }

  async disconnect(): Promise<void> {
    return;
  }

  async runTask(
    input: SendTaskInput,
    emit: (event: NmdealclawEvent) => void
  ): Promise<RuntimeRunHandle> {
    await this.connect();

    const runId = randomId("run");
    const controller = new AbortController();
    let serverTaskId: string | undefined;

    emit({
      type: "run.started",
      taskId: input.taskId,
      runId,
      runtime: this.id,
      startedAt: nowIso()
    });

    const execution = (async () => {
      if (this.useStreaming) {
        const state = await this.streamA2AMessage(input, runId, emit, controller.signal);
        serverTaskId = state.serverTaskId;
        if (serverTaskId) this.rememberRemoteTaskId(input.taskId, serverTaskId);

        if (!state.completed) {
          emit({
            type: "run.completed",
            taskId: input.taskId,
            runId,
            completedAt: nowIso(),
            text: state.aggregatedText
          });
        }
        return;
      }

      const envelope = await this.sendA2AMessage(input, controller.signal);
      const rpcError = getEnvelopeErrorMessage(envelope);
      if (rpcError) {
        emit({
          type: "run.failed",
          taskId: input.taskId,
          runId,
          failedAt: nowIso(),
          error: rpcError
        });
        return;
      }

      const result = envelope.result;
      const task = asTaskObject(result);
      const text = task ? extractTaskArtifactText(task) : JSON.stringify(result ?? {}, null, 2);
      serverTaskId = task?.id;
      if (serverTaskId) this.rememberRemoteTaskId(input.taskId, serverTaskId);

      if (text) {
        emit({
          type: "run.delta",
          taskId: input.taskId,
          runId,
          text
        });
      }

      emit({
        type: "run.completed",
        taskId: input.taskId,
        runId,
        completedAt: nowIso(),
        text
      });
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown NullClaw adapter failure";
      emit({
        type: "run.failed",
        taskId: input.taskId,
        runId,
        failedAt: nowIso(),
        error: message
      });
    });

    return {
      async abort(): Promise<void> {
        controller.abort();
        if (serverTaskId) {
          try {
            await this.cancelTask(serverTaskId);
          } catch {
            // best effort only
          }
        }
        await execution;
      }
    };
  }

  async resubscribeTask(
    localTaskId: string,
    emit: (event: NmdealclawEvent) => void
  ): Promise<void> {
    await this.connect();

    const remoteTaskId = await this.resolveRemoteTaskIdForLocalTask(localTaskId);
    if (!remoteTaskId) {
      throw new Error(
        `NullClaw could not reconcile a remote task for local task ${localTaskId}. The saved mapping is stale or the remote task was evicted.`
      );
    }

    const runId = randomId("resub");
    emit({
      type: "run.started",
      taskId: localTaskId,
      runId,
      runtime: this.id,
      startedAt: nowIso()
    });

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomId("rpc"),
        method: "tasks/resubscribe",
        params: { id: remoteTaskId }
      })
    });

    if (!response.ok) {
      throw new Error(`NullClaw resubscribe failed with HTTP ${response.status}`);
    }

    const type = contentType(response.headers);
    if (!type.includes("text/event-stream") && !type.includes("application/json")) {
      throw new Error(`NullClaw resubscribe returned unexpected content-type: ${type || "unknown"}`);
    }

    const envelopes = type.includes("application/json")
      ? [((await response.json()) as unknown)]
      : await this.readSseJsonRpcEnvelopes(response);

    for (const candidate of envelopes) {
      if (!isJsonRpcEnvelope(candidate)) continue;

      const rpcError = getEnvelopeErrorMessage(candidate);
      const rpcCode = getEnvelopeErrorCode(candidate);
      if (rpcError) {
        if (rpcCode === -32001) {
          this.forgetRemoteTaskId(localTaskId);
        }
        emit({
          type: "run.failed",
          taskId: localTaskId,
          runId,
          failedAt: nowIso(),
          error: rpcError
        });
        return;
      }

      const status = asStatusUpdate(candidate.result);
      if (!status) continue;

      const state = status.status?.state?.toLowerCase();
      if (state === "completed") {
        emit({
          type: "run.completed",
          taskId: localTaskId,
          runId,
          completedAt: nowIso(),
          text: ""
        });
        return;
      }

      if (state === "working" || state === "submitted") {
        emit({
          type: "run.delta",
          taskId: localTaskId,
          runId,
          text: `[resubscribe] remote task is currently ${state}.`
        });
        return;
      }

      emit({
        type: "run.failed",
        taskId: localTaskId,
        runId,
        failedAt: nowIso(),
        error: `NullClaw remote task state: ${state ?? "unknown"}`
      });
      return;
    }

    emit({
      type: "run.failed",
      taskId: localTaskId,
      runId,
      failedAt: nowIso(),
      error: "NullClaw resubscribe returned no usable status-update event."
    });
  }

  private buildMessage(input: SendTaskInput): Record<string, unknown> {
    const message: Record<string, unknown> = {
      messageId: randomId("msg"),
      role: "user",
      parts: [{ kind: "text", text: input.prompt }]
    };
    if (this.useTaskContextId) {
      message["contextId"] = input.taskId;
    }
    return message;
  }

  private async sendA2AMessage(input: SendTaskInput, signal: AbortSignal): Promise<JsonRpcEnvelope> {
    if (!this.token) throw new Error("NullClaw token is missing.");

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomId("rpc"),
        method: "message/send",
        params: { message: this.buildMessage(input) }
      }),
      signal
    });

    if (!response.ok) throw new Error(`NullClaw A2A request failed with HTTP ${response.status}`);
    const payload = (await response.json()) as unknown;
    if (!isJsonRpcEnvelope(payload)) {
      throw new Error("NullClaw returned a non-JSON-RPC response.");
    }
    return payload;
  }

  private async streamA2AMessage(
    input: SendTaskInput,
    runId: string,
    emit: (event: NmdealclawEvent) => void,
    signal: AbortSignal
  ): Promise<StreamState> {
    if (!this.token) throw new Error("NullClaw token is missing.");

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomId("rpc"),
        method: "message/stream",
        params: { message: this.buildMessage(input) }
      }),
      signal
    });

    if (!response.ok) throw new Error(`NullClaw A2A stream failed with HTTP ${response.status}`);

    const type = contentType(response.headers);
    if (type.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      if (!isJsonRpcEnvelope(payload)) throw new Error("NullClaw returned invalid JSON-RPC.");
      const rpcError = getEnvelopeErrorMessage(payload);
      if (rpcError) throw new Error(rpcError);

      const task = asTaskObject(payload.result);
      const text = task ? extractTaskArtifactText(task) : JSON.stringify(payload.result ?? {}, null, 2);
      if (text) {
        emit({
          type: "run.delta",
          taskId: input.taskId,
          runId,
          text
        });
      }
      return {
        serverTaskId: task?.id,
        contextId: task?.contextId,
        aggregatedText: text,
        completed: true
      };
    }

    if (!type.includes("text/event-stream")) {
      throw new Error(`NullClaw returned unexpected content-type: ${type || "unknown"}`);
    }

    const envelopes = await this.readSseJsonRpcEnvelopes(response);
    const state: StreamState = { aggregatedText: "", completed: false };

    for (const payload of envelopes) {
      if (!isJsonRpcEnvelope(payload)) continue;

      const rpcError = getEnvelopeErrorMessage(payload);
      if (rpcError) throw new Error(rpcError);

      const task = asTaskObject(payload.result);
      if (task) {
        if (task.id) state.serverTaskId = task.id;
        if (task.contextId) state.contextId = task.contextId;
        const seededText = extractTaskArtifactText(task);
        if (seededText) {
          state.aggregatedText = seededText;
        }
        continue;
      }

      const chunk = asArtifactUpdate(payload.result);
      if (chunk) {
        if (chunk.taskId) state.serverTaskId = chunk.taskId;
        if (chunk.contextId) state.contextId = chunk.contextId;
        const text = extractArtifactText(chunk);
        if (text) {
          state.aggregatedText += text;
          emit({
            type: "run.delta",
            taskId: input.taskId,
            runId,
            text
          });
        }
        continue;
      }

      const status = asStatusUpdate(payload.result);
      if (status) {
        if (status.taskId) state.serverTaskId = status.taskId;
        if (status.contextId) state.contextId = status.contextId;
        const statusState = status.status?.state?.toLowerCase();

        if (statusState === "completed") {
          emit({
            type: "run.completed",
            taskId: input.taskId,
            runId,
            completedAt: nowIso(),
            text: state.aggregatedText
          });
          state.completed = true;
          continue;
        }

        if (statusState === "failed" || statusState === "rejected" || statusState === "auth-required" || statusState === "input-required") {
          throw new Error(`NullClaw task ended in state: ${statusState}`);
        }

        if (statusState === "canceled") {
          throw new Error("NullClaw task was canceled.");
        }
      }
    }

    return state;
  }

  private async resolveRemoteTaskIdForLocalTask(localTaskId: string): Promise<string | undefined> {
    const existing = this.remoteTaskIds.get(localTaskId);
    if (existing) {
      const verified = await this.verifyRemoteTaskId(existing);
      if (verified) return existing;
      this.forgetRemoteTaskId(localTaskId);
    }

    if (!this.useTaskContextId) {
      return undefined;
    }

    const replacement = await this.findLatestTaskIdByContext(localTaskId);
    if (replacement) {
      this.rememberRemoteTaskId(localTaskId, replacement);
      return replacement;
    }

    return undefined;
  }

  private async verifyRemoteTaskId(remoteTaskId: string): Promise<boolean> {
    const envelope = await this.callA2A("tasks/get", { id: remoteTaskId });
    const code = getEnvelopeErrorCode(envelope);
    if (code === -32001) {
      return false;
    }
    if (getEnvelopeErrorMessage(envelope)) {
      return false;
    }
    return !!asTaskObject(envelope.result);
  }

  private async findLatestTaskIdByContext(contextId: string): Promise<string | undefined> {
    const envelope = await this.callA2A("tasks/list", {
      contextId,
      pageSize: 10
    });

    if (getEnvelopeErrorMessage(envelope)) {
      return undefined;
    }

    const result = asTaskListResult(envelope.result);
    const tasks = result?.tasks ?? [];
    for (const task of tasks) {
      if (typeof task.id === "string" && task.id.trim()) {
        return task.id;
      }
    }
    return undefined;
  }

  private async callA2A(method: string, params: Record<string, unknown>): Promise<JsonRpcEnvelope> {
    if (!this.token) throw new Error("NullClaw token is missing.");

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomId("rpc"),
        method,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`NullClaw ${method} failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!isJsonRpcEnvelope(payload)) {
      throw new Error(`NullClaw ${method} returned a non-JSON-RPC response.`);
    }
    return payload;
  }

  private async readSseJsonRpcEnvelopes(response: Response): Promise<unknown[]> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("NullClaw returned an empty SSE body.");

    const decoder = new TextDecoder();
    let buffer = "";
    const events: unknown[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = this.parseSseData(rawEvent);
        if (!data) continue;

        try {
          events.push(JSON.parse(data));
        } catch {
          // ignore malformed frames
        }
      }
    }

    return events;
  }

  private parseSseData(rawEvent: string): string | undefined {
    const lines = rawEvent.split(/\r?\n/);
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    const joined = dataLines.join("\n").trim();
    return joined || undefined;
  }

  private async cancelTask(id: string): Promise<void> {
    if (!this.token) return;

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomId("rpc"),
        method: "tasks/cancel",
        params: { id }
      })
    });

    if (!response.ok) {
      throw new Error(`NullClaw task cancellation failed with HTTP ${response.status}`);
    }
  }

  private rememberRemoteTaskId(localTaskId: string, remoteTaskId: string): void {
    this.remoteTaskIds.set(localTaskId, remoteTaskId);
    this.persistRemoteTaskMapping();
  }

  private forgetRemoteTaskId(localTaskId: string): void {
    this.remoteTaskIds.delete(localTaskId);
    this.persistRemoteTaskMapping();
  }

  private loadRemoteTaskMapping(): void {
    try {
      if (!existsSync(this.mappingFilePath)) return;
      const raw = readFileSync(this.mappingFilePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [localTaskId, remoteTaskId] of Object.entries(parsed)) {
        if (typeof remoteTaskId === "string" && remoteTaskId.trim()) {
          this.remoteTaskIds.set(localTaskId, remoteTaskId);
        }
      }
    } catch {
      // tolerate malformed or missing mapping files
    }
  }

  private persistRemoteTaskMapping(): void {
    try {
      const dir = dirname(this.mappingFilePath);
      mkdirSync(dir, { recursive: true });
      const payload = Object.fromEntries(this.remoteTaskIds.entries());
      writeFileSync(this.mappingFilePath, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      // keep runtime alive even if persistence fails
    }
  }
}
