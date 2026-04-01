import {
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

export class TaskStore {
  private tasks = new Map<string, TaskRecord>();

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
        if (event.type === "run.completed") {
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
      if (event.type === "run.completed") {
        this.store.update(task.id, { status: "completed" });
      } else if (event.type === "run.failed") {
        this.store.update(task.id, { status: "failed" });
      }
      this.bus.emit(event);
    });
  }
}
