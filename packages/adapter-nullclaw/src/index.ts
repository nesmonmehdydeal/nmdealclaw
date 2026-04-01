import { NmdealclawEvent, RuntimeAdapter, RuntimeRunHandle, SendTaskInput } from "@nmdealclaw/protocol";

export interface NullClawAdapterOptions {
  /**
   * NullClaw gateway base URL, e.g. http://127.0.0.1:3000
   */
  baseUrl?: string;
  /**
   * Stable bearer token. If omitted, the adapter tries env fallbacks.
   */
  token?: string;
  /**
   * One-time pairing code for POST /pair. Used only if no bearer token is available.
   */
  pairingCode?: string;
  /**
   * Optional timeout for HTTP requests.
   */
  timeoutMs?: number;
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

function firstText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = firstText(item);
      if (hit) return hit;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;

  if (Array.isArray(record["parts"])) {
    for (const part of record["parts"] as unknown[]) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        const text = p["text"];
        if (typeof text === "string" && text.trim()) return text;
      }
    }
  }

  for (const key of ["text", "content", "message", "artifact", "output", "result"]) {
    const hit = firstText(record[key]);
    if (hit) return hit;
  }

  return undefined;
}

function errorMessageFromEnvelope(envelope: JsonRpcEnvelope): string | undefined {
  if (!envelope.error) return undefined;
  return envelope.error.message || "Unknown JSON-RPC error";
}

export class NullClawAdapter implements RuntimeAdapter {
  readonly id = "nullclaw";
  readonly displayName = "NullClaw";

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private token?: string;
  private pairingCode?: string;

  constructor(options: NullClawAdapterOptions = {}) {
    this.baseUrl = ensureNoTrailingSlash(options.baseUrl ?? env("NULLCLAW_BASE_URL") ?? "http://127.0.0.1:3000");
    this.token =
      options.token ??
      env("NULLCLAW_GATEWAY_TOKEN") ??
      env("NULLCLAW_WEB_TOKEN") ??
      env("OPENCLAW_GATEWAY_TOKEN");
    this.pairingCode = options.pairingCode ?? env("NULLCLAW_PAIRING_CODE");
    this.timeoutMs = options.timeoutMs ?? 30000;
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
        headers: {
          "X-Pairing-Code": this.pairingCode
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`NullClaw pairing failed with HTTP ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const token = extractToken(payload);
      if (!token) {
        throw new Error("NullClaw pairing succeeded but no token was returned.");
      }
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
    emit({
      type: "run.started",
      taskId: input.taskId,
      runId,
      runtime: this.id,
      startedAt: nowIso()
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const envelope = await this.sendA2AMessage(input.prompt, controller.signal);

      const rpcError = errorMessageFromEnvelope(envelope);
      if (rpcError) {
        emit({
          type: "run.failed",
          taskId: input.taskId,
          runId,
          failedAt: nowIso(),
          error: rpcError
        });
        return {
          async abort(): Promise<void> {
            controller.abort();
          }
        };
      }

      const text = firstText(envelope.result) ?? JSON.stringify(envelope.result ?? {}, null, 2);

      emit({
        type: "run.delta",
        taskId: input.taskId,
        runId,
        text
      });

      emit({
        type: "run.completed",
        taskId: input.taskId,
        runId,
        completedAt: nowIso(),
        text
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown NullClaw adapter failure";
      emit({
        type: "run.failed",
        taskId: input.taskId,
        runId,
        failedAt: nowIso(),
        error: message
      });
    } finally {
      clearTimeout(timeout);
    }

    return {
      async abort(): Promise<void> {
        controller.abort();
      }
    };
  }

  private async sendA2AMessage(prompt: string, signal: AbortSignal): Promise<JsonRpcEnvelope> {
    if (!this.token) {
      throw new Error("NullClaw token is missing.");
    }

    const body = {
      jsonrpc: "2.0",
      id: randomId("rpc"),
      method: "message/send",
      params: {
        message: {
          messageId: randomId("msg"),
          role: "user",
          parts: [
            {
              kind: "text",
              text: prompt
            }
          ]
        }
      }
    };

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      throw new Error(`NullClaw A2A request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcEnvelope;
    if (!payload || payload.jsonrpc !== "2.0") {
      throw new Error("NullClaw returned a non-JSON-RPC response.");
    }

    return payload;
  }
}
