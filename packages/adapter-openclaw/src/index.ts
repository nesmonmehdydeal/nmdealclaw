import { NmdealclawEvent, RuntimeAdapter, RuntimeRunHandle, SendTaskInput } from "@nmdealclaw/protocol";

export class OpenClawAdapter implements RuntimeAdapter {
  readonly id = "openclaw";
  readonly displayName = "OpenClaw";

  constructor(private readonly endpoint = "ws://127.0.0.1:18789") {}

  async connect(): Promise<void> {
    void this.endpoint;
  }

  async disconnect(): Promise<void> {
    return;
  }

  async runTask(
    input: SendTaskInput,
    emit: (event: NmdealclawEvent) => void
  ): Promise<RuntimeRunHandle> {
    const runId = `run_${Math.random().toString(36).slice(2, 10)}`;
    emit({
      type: "run.started",
      taskId: input.taskId,
      runId,
      runtime: this.id,
      startedAt: new Date().toISOString()
    });
    emit({
      type: "run.failed",
      taskId: input.taskId,
      runId,
      failedAt: new Date().toISOString(),
      error: "OpenClaw adapter scaffold only. Implement the gateway bridge here."
    });

    return {
      async abort(): Promise<void> {
        return;
      }
    };
  }
}
