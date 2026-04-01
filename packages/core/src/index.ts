import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ArtifactRef,
  NmdealclawEvent,
  RuntimeAdapter,
  RuntimeRunHandle,
  TaskRecord,
} from "@nmdealclaw/protocol";

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + " …";
}

function normalizeLine(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-:./]/gu, "")
    .trim();
}

function safeDateWeight(iso: string, fallbackIndex: number): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return fallbackIndex;
  return ms;
}

interface TranscriptEntry {
  at: string;
  event: NmdealclawEvent;
}

interface RecoverySummary {
  stableFacts: string[];
  decisions: string[];
  outputs: string[];
  openIssues: string[];
  recentTail: string[];
}

type RecoveryBucket = "stableFacts" | "decisions" | "outputs" | "openIssues";

interface CandidateLine {
  bucket: RecoveryBucket;
  text: string;
  score: number;
  normalized: string;
}

class HeuristicRecoverySynthesizer {
  summarize(entries: TranscriptEntry[]): RecoverySummary {
    const candidates: CandidateLine[] = [];
    const recentTail: string[] = [];

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const entryWeight = safeDateWeight(entry.at, index);
      const event = entry.event;

      if (event.type === "run.started") {
        candidates.push(this.makeCandidate(
          "stableFacts",
          `Run ${event.runId} started on runtime ${event.runtime} at ${entry.at}.`,
          40 + entryWeight * 0.000000001
        ));
      }

      if (event.type === "run.completed") {
        candidates.push(this.makeCandidate(
          "decisions",
          `A run completed successfully at ${entry.at}.`,
          80 + entryWeight * 0.000000001
        ));
        for (const line of this.extractSemanticallyUsefulLines(event.text)) {
          candidates.push(this.makeCandidate(
            "outputs",
            `Output: ${line}`,
            90 + entryWeight * 0.000000001 + this.signalBonus(line)
          ));
        }
      }

      if (event.type === "run.failed") {
        candidates.push(this.makeCandidate(
          "openIssues",
          `Failure at ${entry.at}: ${event.error}`,
          100 + entryWeight * 0.000000001 + this.signalBonus(event.error)
        ));
      }

      if (event.type === "run.approval_required") {
        candidates.push(this.makeCandidate(
          "openIssues",
          `Approval required: ${event.reason}`,
          110 + entryWeight * 0.000000001 + this.signalBonus(event.reason)
        ));
      }

      if (event.type === "artifact.created") {
        candidates.push(this.makeCandidate(
          "outputs",
          `Artifact created: ${event.artifact.path}`,
          95 + entryWeight * 0.000000001
        ));
      }

      if (event.type === "run.delta") {
        const usefulLines = this.extractSemanticallyUsefulLines(event.text);
        for (const line of usefulLines) {
          const bucket = this.classifyLine(line);
          candidates.push(this.makeCandidate(
            bucket,
            line,
            20 + entryWeight * 0.000000001 + this.signalBonus(line)
          ));
        }
        recentTail.push(`[${entry.at}] ${clip(event.text.replace(/\s+/g, " ").trim(), 220)}`);
      }
    }

    const grouped = this.pickTopByBucket(candidates);

    return {
      stableFacts: grouped.stableFacts.length ? grouped.stableFacts : ["No stable facts were extracted from the preserved transcript."],
      decisions: grouped.decisions.length ? grouped.decisions : ["No explicit completed decisions were extracted."],
      outputs: grouped.outputs.length ? grouped.outputs : ["No preserved final outputs or artifacts were extracted."],
      openIssues: grouped.openIssues.length ? grouped.openIssues : ["No unresolved failures or approval blockers were extracted."],
      recentTail: recentTail.slice(-8).length ? recentTail.slice(-8) : ["No recent transcript tail is available."]
    };
  }

  private makeCandidate(bucket: RecoveryBucket, text: string, score: number): CandidateLine {
    const clean = clip(text.replace(/\s+/g, " ").trim(), 220);
    return {
      bucket,
      text: clean,
      score,
      normalized: normalizeLine(clean)
    };
  }

  private extractSemanticallyUsefulLines(text: string): string[] {
    const rawLines = text
      .split(/\r?\n|(?<=\.)\s+(?=[A-Z0-9\-])/)
      .map((line) => line.trim())
      .filter(Boolean);

    const out: string[] = [];
    for (const line of rawLines) {
      if (line.length < 12) continue;
      if (/^(ok|done|yes|no|thanks?)$/i.test(line)) continue;
      out.push(clip(line, 180));
      if (out.length >= 6) break;
    }
    return out;
  }

  private classifyLine(line: string): RecoveryBucket {
    const n = normalizeLine(line);

    if (/(error|failed|missing|blocked|todo|next step|issue|problem|warning|approval|auth-required|input-required)/.test(n)) {
      return "openIssues";
    }
    if (/(decision|choose|selected|approved|completed|final|resolved|therefore|we will|adopt|use )/.test(n)) {
      return "decisions";
    }
    if (/(artifact|output|result|generated|created|saved|path|file|summary|deliverable)/.test(n)) {
      return "outputs";
    }
    return "stableFacts";
  }

  private signalBonus(line: string): number {
    const n = normalizeLine(line);
    let bonus = 0;
    if (/(must|should|important|critical|final|selected|approved|completed)/.test(n)) bonus += 15;
    if (/(error|failed|missing|blocked|todo|issue|problem|approval)/.test(n)) bonus += 20;
    if (/(artifact|output|generated|saved|deliverable|summary)/.test(n)) bonus += 12;
    return bonus;
  }

  private pickTopByBucket(candidates: CandidateLine[]): RecoverySummary {
    const buckets: Record<RecoveryBucket, CandidateLine[]> = {
      stableFacts: [],
      decisions: [],
      outputs: [],
      openIssues: []
    };

    for (const candidate of candidates) {
      buckets[candidate.bucket].push(candidate);
    }

    const pick = (bucket: RecoveryBucket, limit: number): string[] => {
      const seen = new Set<string>();
      return buckets[bucket]
        .sort((a, b) => b.score - a.score)
        .filter((candidate) => {
          if (!candidate.normalized) return false;
          if (seen.has(candidate.normalized)) return false;
          seen.add(candidate.normalized);
          return true;
        })
        .slice(0, limit)
        .map((candidate) => candidate.text);
    };

    return {
      stableFacts: pick("stableFacts", 6),
      decisions: pick("decisions", 6),
      outputs: pick("outputs", 6),
      openIssues: pick("openIssues", 6),
      recentTail: []
    };
  }
}

export class EventBus {
  private listeners = new Set<(event: NmdealclawEvent) => void>();

  subscribe(listener: (event: NmdealclawEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: NmdealclawEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export class RuntimeRegistry {
  private adapters = new Map<string, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): RuntimeAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Runtime adapter not found: ${id}`);
    return adapter;
  }

  list(): RuntimeAdapter[] {
    return [...this.adapters.values()];
  }
}

export class WorkspacePersistence {
  private readonly synthesizer = new HeuristicRecoverySynthesizer();

  constructor(private readonly workspaceDir = ".nmdealclaw/workspace") {
    mkdirSync(this.workspaceDir, { recursive: true });
  }

  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  getTaskDir(projectId: string, taskId: string): string {
    return join(this.workspaceDir, "projects", projectId, "tasks", taskId);
  }

  getTaskJsonPath(projectId: string, taskId: string): string {
    return join(this.getTaskDir(projectId, taskId), "task.json");
  }

  getTranscriptPath(projectId: string, taskId: string): string {
    return join(this.getTaskDir(projectId, taskId), "transcript.ndjson");
  }

  getArtifactsDir(projectId: string, taskId: string): string {
    return join(this.getTaskDir(projectId, taskId), "artifacts");
  }

  ensureTaskDir(projectId: string, taskId: string): void {
    mkdirSync(this.getTaskDir(projectId, taskId), { recursive: true });
    mkdirSync(this.getArtifactsDir(projectId, taskId), { recursive: true });
  }

  saveTask(task: TaskRecord): void {
    this.ensureTaskDir(task.projectId, task.id);
    writeFileSync(this.getTaskJsonPath(task.projectId, task.id), JSON.stringify(task, null, 2), "utf-8");
  }

  appendTranscript(projectId: string, taskId: string, event: NmdealclawEvent): void {
    this.ensureTaskDir(projectId, taskId);
    appendFileSync(
      this.getTranscriptPath(projectId, taskId),
      JSON.stringify({ at: nowIso(), event }) + "\n",
      "utf-8"
    );
  }

  createTextArtifact(task: TaskRecord, name: string, text: string): ArtifactRef {
    this.ensureTaskDir(task.projectId, task.id);
    const artifactId = randomId("artifact");
    const filename = `${name}.txt`;
    const absolutePath = join(this.getArtifactsDir(task.projectId, task.id), filename);
    writeFileSync(absolutePath, text, "utf-8");

    return {
      id: artifactId,
      taskId: task.id,
      path: absolutePath,
      kind: "file",
      createdAt: nowIso()
    };
  }

  loadAllTasks(): TaskRecord[] {
    const projectsRoot = join(this.workspaceDir, "projects");
    if (!existsSync(projectsRoot)) return [];

    const tasks: TaskRecord[] = [];
    for (const projectId of readdirSync(projectsRoot)) {
      const tasksRoot = join(projectsRoot, projectId, "tasks");
      if (!existsSync(tasksRoot)) continue;

      for (const taskId of readdirSync(tasksRoot)) {
        const taskJsonPath = this.getTaskJsonPath(projectId, taskId);
        if (!existsSync(taskJsonPath)) continue;

        try {
          tasks.push(parseJson<TaskRecord>(readFileSync(taskJsonPath, "utf-8")));
        } catch {
          // Skip malformed task metadata instead of crashing recovery.
        }
      }
    }

    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  loadTranscriptEntries(projectId: string, taskId: string): TranscriptEntry[] {
    const transcriptPath = this.getTranscriptPath(projectId, taskId);
    if (!existsSync(transcriptPath)) return [];

    const rawLines = readFileSync(transcriptPath, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const entries: TranscriptEntry[] = [];
    for (const line of rawLines) {
      try {
        entries.push(parseJson<TranscriptEntry>(line));
      } catch {
        // ignore malformed transcript lines
      }
    }
    return entries;
  }

  buildRecoveryPrompt(task: TaskRecord): string {
    const entries = this.loadTranscriptEntries(task.projectId, task.id);
    const summary = this.synthesizer.summarize(entries);

    return [
      `Recovered nmdealclaw task`,
      ``,
      `Task title:`,
      task.title,
      ``,
      `Task id:`,
      task.id,
      ``,
      `Original objective:`,
      task.prompt,
      ``,
      `Stable state:`,
      ...this.formatSection(summary.stableFacts),
      ``,
      `Decisions already made:`,
      ...this.formatSection(summary.decisions),
      ``,
      `Artifacts produced:`,
      ...this.formatSection(summary.outputs),
      ``,
      `Open issues / next steps:`,
      ...this.formatSection(summary.openIssues),
      ``,
      `Recent transcript tail:`,
      ...this.formatSection(summary.recentTail),
      ``,
      `Instruction: continue the work from this preserved state without repeating completed work unnecessarily.`
    ].join("\n");
  }

  private formatSection(lines: string[]): string[] {
    return lines.map((line) => `- ${line}`);
  }
}

export class TaskStore {
  private tasks = new Map<string, TaskRecord>();

  constructor(private readonly persistence = new WorkspacePersistence()) {
    for (const task of this.persistence.loadAllTasks()) {
      this.tasks.set(task.id, task);
    }
  }

  create(projectId: string, title: string, prompt: string, runtime: string): TaskRecord {
    const timestamp = nowIso();
    const task: TaskRecord = {
      id: randomId("task"),
      projectId,
      title,
      prompt,
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
      runtime,
      artifacts: []
    };
    this.tasks.set(task.id, task);
    this.persistence.saveTask(task);
    return task;
  }

  update(taskId: string, patch: Partial<TaskRecord>): TaskRecord {
    const current = this.require(taskId);
    const next: TaskRecord = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    this.tasks.set(taskId, next);
    this.persistence.saveTask(next);
    return next;
  }

  require(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getPersistence(): WorkspacePersistence {
    return this.persistence;
  }
}

export class TaskService {
  private running = new Map<string, RuntimeRunHandle>();

  constructor(
    private readonly store: TaskStore,
    private readonly registry: RuntimeRegistry,
    private readonly bus: EventBus
  ) {}

  async run(taskId: string): Promise<void> {
    const task = this.store.require(taskId);
    const adapter = this.registry.get(task.runtime);

    await adapter.connect();
    this.store.update(task.id, { status: "running" });

    const handle = await adapter.runTask(
      { taskId: task.id, prompt: task.prompt },
      (event) => {
        this.persistEvent(task.id, event);

        if (event.type === "run.completed") {
          this.handleCompletionArtifact(task.id, event.runId, event.text);
          this.store.update(task.id, { status: "completed" });
          this.running.delete(task.id);
        } else if (event.type === "run.failed") {
          this.store.update(task.id, { status: "failed" });
          this.running.delete(task.id);
        }
        this.bus.emit(event);
      }
    );

    this.running.set(task.id, handle);
  }

  async abort(taskId: string): Promise<void> {
    const handle = this.running.get(taskId);
    if (!handle) return;
    await handle.abort();
    this.store.update(taskId, { status: "aborted" });
    this.running.delete(taskId);
  }

  async resubscribe(taskId: string): Promise<void> {
    const task = this.store.require(taskId);
    const adapter = this.registry.get(task.runtime);
    if (!adapter.resubscribeTask) {
      throw new Error(`Runtime ${adapter.id} does not support resubscribe.`);
    }

    await adapter.resubscribeTask(task.id, (event) => {
      this.persistEvent(task.id, event);

      if (event.type === "run.completed") {
        this.handleCompletionArtifact(task.id, event.runId, event.text);
        this.store.update(task.id, { status: "completed" });
      } else if (event.type === "run.failed") {
        this.store.update(task.id, { status: "failed" });
      }
      this.bus.emit(event);
    });
  }

  /**
   * If remote recovery fails, continue the task from the durable local record
   * by creating a new remote turn from a bounded recovery prompt.
   */
  async recoverRemotely(taskId: string): Promise<void> {
    const original = this.store.require(taskId);
    const persistence = this.store.getPersistence();
    const recoveryPrompt = persistence.buildRecoveryPrompt(original);

    const recovered = this.store.create(
      original.projectId,
      `${original.title} [recovered]`,
      recoveryPrompt,
      original.runtime
    );

    await this.run(recovered.id);
  }

  private persistEvent(taskId: string, event: NmdealclawEvent): void {
    const task = this.store.require(taskId);
    this.store.getPersistence().appendTranscript(task.projectId, task.id, event);
  }

  private handleCompletionArtifact(taskId: string, runId: string, text: string): void {
    const task = this.store.require(taskId);
    if (!text.trim()) return;

    const artifact = this.store.getPersistence().createTextArtifact(task, `final-${runId}`, text);
    const updatedArtifacts = [...task.artifacts, artifact];
    this.store.update(task.id, { artifacts: updatedArtifacts });

    this.bus.emit({
      type: "artifact.created",
      taskId: task.id,
      artifact
    });
  }
}
