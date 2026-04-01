import { NmdealclawEvent, RuntimeAdapter, RuntimeRunHandle, SendTaskInput } from "@nmdealclaw/protocol";

export class HiClawAdapter implements RuntimeAdapter {
  readonly id = "hiclaw";
  readonly displayName = "HiClaw";

  constructor(private readonly endpoint = "http://127.0.0.1:8080") {}

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
      type: "run.approval_required",
      taskId: input.taskId,
      runId,
      reason: "HiClaw team-mode scaffold only. Implement manager-worker dispatch here."
    });

    return {
      async abort(): Promise<void> {
        return;
      }
    };
  }
}
