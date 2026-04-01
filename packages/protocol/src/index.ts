export type TaskStatus = "idle" | "running" | "completed" | "failed" | "aborted";

export interface ArtifactRef {
  id: string;
  taskId: string;
  path: string;
  kind: "file" | "url" | "note";
  createdAt: string;
}

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  runtime: string;
  artifacts: ArtifactRef[];
}

export interface RunDeltaEvent {
  type: "run.delta";
  taskId: string;
  runId: string;
  text: string;
}

export interface RunStartedEvent {
  type: "run.started";
  taskId: string;
  runId: string;
  runtime: string;
  startedAt: string;
}

export interface RunCompletedEvent {
  type: "run.completed";
  taskId: string;
  runId: string;
  completedAt: string;
  text: string;
  usage?: RunUsage;
}

export interface RunFailedEvent {
  type: "run.failed";
  taskId: string;
  runId: string;
  failedAt: string;
  error: string;
}

export interface ApprovalRequiredEvent {
  type: "run.approval_required";
  taskId: string;
  runId: string;
  reason: string;
}

export interface ArtifactCreatedEvent {
  type: "artifact.created";
  taskId: string;
  artifact: ArtifactRef;
}

export type NmdealclawEvent =
  | RunDeltaEvent
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | ApprovalRequiredEvent
  | ArtifactCreatedEvent;

export interface SendTaskInput {
  taskId: string;
  prompt: string;
}

export interface RuntimeRunHandle {
  abort(): Promise<void>;
}

export interface RuntimeAdapter {
  readonly id: string;
  readonly displayName: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runTask(
    input: SendTaskInput,
    emit: (event: NmdealclawEvent) => void
  ): Promise<RuntimeRunHandle>;
  resubscribeTask?(
    localTaskId: string,
    emit: (event: NmdealclawEvent) => void
  ): Promise<void>;
  getRemoteTaskId?(localTaskId: string): string | undefined;
}
