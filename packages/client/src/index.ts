export interface QmeClientOptions {
  apiUrl?: string;
}

export type JobType = "node" | "python" | "shell";
export type DedupeScope = "flow" | "queue" | "global";
export type BackoffKind = "fixed" | "exponential";
export type CommandAckState = "accepted" | "received" | "completed" | "expired" | "rejected";

export interface JobPayload {
  type: JobType;
  script: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  originApp?: string;
}

export interface ScriptOptions {
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  originApp?: string;
}

export interface RetryPolicyInput {
  attempts?: number;
  backoff?: BackoffKind;
  delayMs?: number;
}

export interface RetryDelayInput {
  attempts?: number;
  delay?: number;
  delayMs?: number;
}

export interface CreateJobInput {
  flowId?: string;
  dependsOn?: string[];
  dedupeKey?: string;
  dedupeScope?: DedupeScope;
  rateLimitBuckets?: string[];
  payload: JobPayload;
  priority?: number;
  delayMs?: number;
  retry?: RetryPolicyInput;
}

export interface CreateJobOptions extends Omit<CreateJobInput, "payload" | "rateLimitBuckets"> {
  script?: JobPayload;
  payload?: JobPayload;
  rateLimits?: string[];
  rateLimitBuckets?: string[];
}

export interface CreateFlowJobOptions extends CreateJobOptions {
  queue?: string;
}

export interface CreateFlowInput {
  name?: string;
  originApp?: string;
  completionPolicy?: "graph" | "explicit";
  failurePolicy?: "block" | "cancel";
  jobs?: CreateFlowJobOptions[];
}

export interface JobRecord<TPayload extends JobPayload = JobPayload, TResult = unknown> {
  id: string;
  queue: string;
  flowId: string | null;
  dedupeKey: string | null;
  dedupeScope: DedupeScope | null;
  rateLimitBuckets: string[];
  state: "waiting" | "active" | "retrying" | "completed" | "failed" | "canceling" | "canceled" | "interrupted";
  priority: number;
  payload: TPayload;
  retryPolicy: {
    attempts: number;
    backoff: BackoffKind;
    delayMs: number;
  };
  progressPercent: number | null;
  progressMeta: unknown;
  resultMeta: TResult | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface QueueRecord {
  name: string;
  state: "active" | "paused" | "draining" | "disabled";
  waitingJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export interface FlowRecord {
  id: string;
  name: string | null;
  state: "open" | "running" | "paused" | "completed" | "failed" | "canceled" | "interrupted";
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

export interface RateLimitBucketRecord {
  name: string;
  max: number;
  durationMs: number;
  windowStartedAt: string | null;
  used: number;
}

export interface JobCommandRecord<TPayload = unknown> {
  id: string;
  jobId: string;
  state: CommandAckState;
  payload: TPayload;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlowResult {
  flow: FlowRecord;
  jobs: JobRecord[];
}

export class QmeClient {
  readonly apiUrl: string;

  readonly scripts = {
    node: (script: string, options: ScriptOptions = {}): JobPayload => this.script("node", script, options),
    python: (script: string, options: ScriptOptions = {}): JobPayload => this.script("python", script, options),
    shell: (script: string, options: ScriptOptions = {}): JobPayload => this.script("shell", script, options)
  };

  readonly retry = {
    fixed: (options: RetryDelayInput = {}): RetryPolicyInput => ({
      attempts: options.attempts,
      backoff: "fixed",
      delayMs: options.delayMs ?? options.delay
    }),
    exponential: (options: RetryDelayInput = {}): RetryPolicyInput => ({
      attempts: options.attempts,
      backoff: "exponential",
      delayMs: options.delayMs ?? options.delay
    })
  };

  readonly jobs = {
    create: <T = JobRecord>(queue: string, input: CreateJobOptions) => this.createJob<T>(queue, input),
    list: <T = JobRecord[]>(queue?: string) => this.listJobs<T>(queue),
    get: <T = JobRecord>(id: string) => this.getJob<T>(id),
    logs: <T = unknown>(id: string) => this.getJobLogs<T>(id),
    cancel: (id: string) => this.cancelJob(id),
    retry: <T = JobRecord>(id: string, input: { delayMs?: number } = {}) => this.retryJob<T>(id, input),
    setPriority: <T = JobRecord>(id: string, priority: number) => this.setJobPriority<T>(id, priority)
  };

  readonly queues = {
    list: <T = QueueRecord[]>() => this.listQueues<T>(),
    jobs: <T = JobRecord[]>(queue: string) => this.listJobs<T>(queue),
    pause: (queue: string) => this.pauseQueue(queue),
    resume: (queue: string) => this.resumeQueue(queue)
  };

  readonly flows = {
    create: <T = CreateFlowResult>(input: CreateFlowInput = {}) => this.createFlow<T>(input),
    list: <T = FlowRecord[]>() => this.listFlows<T>(),
    get: <T = FlowRecord>(id: string) => this.getFlow<T>(id),
    jobs: <T = JobRecord[]>(id: string) => this.getFlowJobs<T>(id),
    pause: (id: string) => this.pauseFlow(id),
    resume: (id: string) => this.resumeFlow(id),
    cancel: (id: string) => this.cancelFlow(id)
  };

  readonly rateLimitBuckets = {
    list: <T = RateLimitBucketRecord[]>() => this.listRateLimitBuckets<T>(),
    upsert: <T = RateLimitBucketRecord>(name: string, input: { max: number; durationMs: number }) => this.upsertRateLimitBucket<T>(name, input)
  };

  readonly commands = {
    send: <T = JobCommandRecord>(jobId: string, payload: unknown, options: { ttlMs?: number } = {}) => this.sendCommand<T>(jobId, payload, options),
    list: <T = JobCommandRecord[]>(jobId: string) => this.listCommands<T>(jobId),
    next: <T = JobCommandRecord | null>(jobId: string) => this.receiveNextCommand<T>(jobId),
    ack: <T = JobCommandRecord>(commandId: string, state: "completed" | "rejected") => this.ackCommand<T>(commandId, state)
  };

  readonly events = {
    subscribe: (options: { jobId?: string; queue?: string; onEvent: (event: unknown) => void }) => this.subscribe(options)
  };

  readonly rateLimits = this.rateLimitBuckets;

  constructor(options: QmeClientOptions = {}) {
    this.apiUrl = options.apiUrl ?? process.env.QME_API_URL ?? "http://127.0.0.1:47321/api/v1";
  }

  async createJob<T = JobRecord>(queue: string, input: CreateJobOptions): Promise<T> {
    return this.request<T>(`/queues/${encodeURIComponent(queue)}/jobs`, {
      method: "POST",
      body: JSON.stringify(normalizeJobInput(input))
    });
  }

  async createFlow<T = CreateFlowResult>(input: CreateFlowInput = {}): Promise<T> {
    return this.request<T>("/flows", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        jobs: input.jobs?.map((job) => normalizeFlowJobInput(job))
      })
    });
  }

  async listQueues<T = QueueRecord[]>(): Promise<T> {
    return this.request<T>("/queues");
  }

  async listJobs<T = JobRecord[]>(queue?: string): Promise<T> {
    if (queue) return this.request<T>(`/queues/${encodeURIComponent(queue)}/jobs`);
    return this.request<T>("/jobs");
  }

  async listRateLimitBuckets<T = RateLimitBucketRecord[]>(): Promise<T> {
    return this.request<T>("/rate-limit-buckets");
  }

  async listFlows<T = FlowRecord[]>(): Promise<T> {
    return this.request<T>("/flows");
  }

  async getFlow<T = FlowRecord>(id: string): Promise<T> {
    return this.request<T>(`/flows/${encodeURIComponent(id)}`);
  }

  async getFlowJobs<T = JobRecord[]>(id: string): Promise<T> {
    return this.request<T>(`/flows/${encodeURIComponent(id)}/jobs`);
  }

  async getJob<T = JobRecord>(id: string): Promise<T> {
    return this.request<T>(`/jobs/${encodeURIComponent(id)}`);
  }

  async getJobLogs<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/jobs/${encodeURIComponent(id)}/logs`);
  }

  async sendCommand<T = unknown>(jobId: string, payload: unknown, options: { ttlMs?: number } = {}): Promise<T> {
    return this.request<T>(`/jobs/${encodeURIComponent(jobId)}/commands`, {
      method: "POST",
      body: JSON.stringify({ payload, ttlMs: options.ttlMs })
    });
  }

  async listCommands<T = unknown>(jobId: string): Promise<T> {
    return this.request<T>(`/jobs/${encodeURIComponent(jobId)}/commands`);
  }

  async receiveNextCommand<T = unknown>(jobId: string): Promise<T | null> {
    const response = await fetch(`${this.apiUrl}/jobs/${encodeURIComponent(jobId)}/commands/next`, {
      method: "POST"
    });
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error(`Qme request failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  async ackCommand<T = unknown>(commandId: string, state: "completed" | "rejected"): Promise<T> {
    return this.request<T>(`/commands/${encodeURIComponent(commandId)}/ack`, {
      method: "POST",
      body: JSON.stringify({ state })
    });
  }

  async pauseQueue(queue: string): Promise<unknown> {
    return this.request(`/queues/${encodeURIComponent(queue)}/pause`, { method: "POST" });
  }

  async pauseFlow(id: string): Promise<unknown> {
    return this.request(`/flows/${encodeURIComponent(id)}/pause`, { method: "POST" });
  }

  async resumeFlow(id: string): Promise<unknown> {
    return this.request(`/flows/${encodeURIComponent(id)}/resume`, { method: "POST" });
  }

  async cancelFlow(id: string): Promise<unknown> {
    return this.request(`/flows/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  async upsertRateLimitBucket<T = RateLimitBucketRecord>(name: string, input: { max: number; durationMs: number }): Promise<T> {
    return this.request<T>(`/rate-limit-buckets/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  }

  async resumeQueue(queue: string): Promise<unknown> {
    return this.request(`/queues/${encodeURIComponent(queue)}/resume`, { method: "POST" });
  }

  async cancelJob(id: string): Promise<unknown> {
    return this.request(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  async retryJob<T = JobRecord>(id: string, input: { delayMs?: number } = {}): Promise<T> {
    return this.request<T>(`/jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async setJobPriority<T = JobRecord>(id: string, priority: number): Promise<T> {
    return this.request<T>(`/jobs/${encodeURIComponent(id)}/priority`, {
      method: "POST",
      body: JSON.stringify({ priority })
    });
  }

  subscribe(options: { jobId?: string; queue?: string; onEvent: (event: unknown) => void }): WebSocket {
    const url = new URL(this.apiUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = url.pathname.replace(/\/$/, "") + "/events";
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "subscribe", jobId: options.jobId, queue: options.queue }));
    });
    socket.addEventListener("message", (message) => {
      options.onEvent(JSON.parse(String(message.data)));
    });
    return socket;
  }

  private script(type: JobType, script: string, options: ScriptOptions): JobPayload {
    return { type, script, ...options };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = init.body
      ? {
          "content-type": "application/json",
          ...init.headers
        }
      : init.headers;
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers
    });
    if (!response.ok) {
      throw new Error(`Qme request failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }
}

function normalizeJobInput(input: CreateJobOptions): CreateJobInput {
  const payload = input.payload ?? input.script;
  if (!payload) {
    throw new Error("Job creation requires payload or script.");
  }
  const { script: _script, rateLimits, ...rest } = input;
  return {
    ...rest,
    payload,
    rateLimitBuckets: input.rateLimitBuckets ?? rateLimits
  };
}

function normalizeFlowJobInput(input: CreateFlowJobOptions): CreateJobInput & { queue?: string } {
  const normalized = normalizeJobInput(input);
  return {
    ...normalized,
    queue: input.queue
  };
}
