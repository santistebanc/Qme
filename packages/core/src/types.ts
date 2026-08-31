export type JobType = "node" | "python" | "shell" | "handler";

export type JobState =
  | "waiting"
  | "active"
  | "retrying"
  | "completed"
  | "failed"
  | "canceling"
  | "canceled"
  | "interrupted";

export type QueueState = "active" | "paused" | "draining" | "disabled";
export type FlowState = "open" | "running" | "paused" | "completed" | "failed" | "canceled" | "interrupted";
export type DedupeScope = "flow" | "queue" | "global";

export interface JobPayload {
  type: JobType;
  script: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  originApp?: string;
  data?: unknown;
}

export type BackoffKind = "fixed" | "exponential";

export interface RetryPolicy {
  attempts: number;
  backoff: BackoffKind;
  delayMs: number;
}

export interface JobRecord {
  id: string;
  queue: string;
  flowId: string | null;
  dedupeKey: string | null;
  dedupeScope: DedupeScope | null;
  rateLimitBuckets: string[];
  state: JobState;
  priority: number;
  payload: JobPayload;
  retryPolicy: RetryPolicy;
  progressPercent: number | null;
  progressMeta: unknown;
  resultMeta: unknown;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RateLimitBucketRecord {
  name: string;
  max: number;
  durationMs: number;
  windowStartedAt: string | null;
  used: number;
}

export type CommandAckState = "accepted" | "received" | "completed" | "expired" | "rejected";

export interface JobCommandRecord {
  id: string;
  jobId: string;
  state: CommandAckState;
  payload: unknown;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowRecord {
  id: string;
  name: string | null;
  state: FlowState;
  originApp: string | null;
  completionPolicy: "graph" | "explicit";
  failurePolicy: "block" | "cancel";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  waitingJobs: number;
}

export interface QmeEvent {
  id: string;
  type: string;
  at: string;
  jobId?: string;
  queue?: string;
  data: unknown;
}
