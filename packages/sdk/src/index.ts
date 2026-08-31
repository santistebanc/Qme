import { QmeClient } from "@qme/client";
import type { JobPayload } from "@qme/client";
export { QmeClient } from "@qme/client";
export type {
  CreateFlowInput,
  CreateFlowJobOptions,
  CreateJobInput,
  CreateJobOptions,
  JobPayload,
  QmeClientOptions,
  ScriptOptions
} from "@qme/client";

export interface QmeSdkOptions {
  apiUrl?: string;
  jobId?: string;
  argv?: string[];
}

export interface QmeSleepOptions {
  signal?: AbortSignal;
}

export interface QmeTimeoutOptions extends QmeSleepOptions {
  message?: string;
}

export interface QmePollOptions extends QmeSleepOptions {
  everyMs?: number;
  timeoutMs?: number;
  message?: string;
}

export interface QmeCommand<TPayload = unknown> {
  id: string;
  jobId: string;
  state: string;
  payload: TPayload;
  createdAt: string;
}

export interface AddFlowJobInput {
  queue?: string;
  script?: JobPayload;
  payload?: JobPayload;
  dependsOn?: string[];
  priority?: number;
  delayMs?: number;
  retry?: {
    attempts?: number;
    backoff?: "fixed" | "exponential";
    delayMs?: number;
  };
  dedupeKey?: string;
  dedupeScope?: "flow" | "queue" | "global";
  rateLimitBuckets?: string[];
}

export interface QmeArtifactInput {
  path: string;
  meta?: unknown;
}

export interface QmeJobResultInput {
  summary?: unknown;
  outputs?: Record<string, unknown>;
  artifacts?: Array<string | QmeArtifactInput>;
}

export class QmeSdk {
  readonly apiUrl: string;
  readonly jobId?: string;
  readonly args: QmeArgs;
  readonly client: QmeClient;
  readonly context: QmeContext;

  readonly milliseconds = (value: number) => value;
  readonly seconds = (value: number) => value * 1_000;
  readonly minutes = (value: number) => value * 60_000;

  readonly time = {
    milliseconds: this.milliseconds,
    seconds: this.seconds,
    minutes: this.minutes
  };

  readonly sleep = (ms: number, options: QmeSleepOptions = {}) => sleep(ms, options);
  readonly withTimeout = <T>(work: Promise<T>, timeoutMs: number, options: QmeTimeoutOptions = {}) => withTimeout(work, timeoutMs, options);
  readonly poll = <T>(check: () => T | Promise<T>, options: QmePollOptions = {}) => poll(check, options);

  readonly timers = {
    sleep: this.sleep,
    withTimeout: this.withTimeout,
    poll: this.poll
  };

  readonly scripts = {
    node: (...args: Parameters<QmeClient["scripts"]["node"]>) => this.client.scripts.node(...args),
    python: (...args: Parameters<QmeClient["scripts"]["python"]>) => this.client.scripts.python(...args),
    shell: (...args: Parameters<QmeClient["scripts"]["shell"]>) => this.client.scripts.shell(...args)
  };

  readonly retry = {
    fixed: (...args: Parameters<QmeClient["retry"]["fixed"]>) => this.client.retry.fixed(...args),
    exponential: (...args: Parameters<QmeClient["retry"]["exponential"]>) => this.client.retry.exponential(...args)
  };

  readonly job = {
    progress: (progressPercent: number, progressMeta?: unknown) => this.progress(progressPercent, progressMeta),
    artifact: (path: string, meta?: unknown) => this.artifact(path, meta),
    output: (name: string, value: unknown) => this.output(name, value),
    result: (result: QmeJobResultInput) => this.result(result),
    event: (type: string, data?: unknown) => this.event(type, data),
    log: (line: string, stream: "stdout" | "stderr" = "stdout") => this.log(line, stream),
    warn: (message: string, data?: unknown) => this.warn(message, data),
    error: (message: string, data?: unknown) => this.error(message, data),
    fail: (message: string, data?: unknown) => this.fail(message, data)
  };

  readonly commands = {
    next: <TPayload = unknown>(options: { timeoutMs?: number; pollMs?: number } = {}) => this.nextCommand<TPayload>(options),
    ack: (commandId: string, state: "completed" | "rejected" = "completed") => this.ackCommand(commandId, state),
    handleNext: <TPayload = unknown>(
      options: { timeoutMs?: number; pollMs?: number } = {},
      handler: (command: QmeCommand<TPayload>) => void | Promise<void>
    ) => this.handleNextCommand(options, handler)
  };

  readonly jobs = {
    create: <T = unknown>(queue: string, input: Parameters<QmeClient["jobs"]["create"]>[1]) => this.client.jobs.create<T>(queue, input),
    list: <T = unknown>(queue?: string) => this.client.jobs.list<T>(queue),
    get: <T = unknown>(id: string) => this.client.jobs.get<T>(id),
    logs: <T = unknown>(id: string) => this.client.jobs.logs<T>(id),
    cancel: (id: string) => this.client.jobs.cancel(id),
    retry: <T = unknown>(id: string, input: { delayMs?: number } = {}) => this.client.jobs.retry<T>(id, input),
    setPriority: <T = unknown>(id: string, priority: number) => this.client.jobs.setPriority<T>(id, priority)
  };

  readonly queues = {
    list: <T = unknown>() => this.client.queues.list<T>(),
    jobs: <T = unknown>(queue: string) => this.client.queues.jobs<T>(queue),
    pause: (queue: string) => this.client.queues.pause(queue),
    resume: (queue: string) => this.client.queues.resume(queue)
  };

  readonly flows = {
    create: <T = unknown>(input: Parameters<QmeClient["flows"]["create"]>[0] = {}) => this.client.flows.create<T>(input),
    list: <T = unknown>() => this.client.flows.list<T>(),
    get: <T = unknown>(id: string) => this.client.flows.get<T>(id),
    jobs: <T = unknown>(id: string) => this.client.flows.jobs<T>(id),
    pause: (id: string) => this.client.flows.pause(id),
    resume: (id: string) => this.client.flows.resume(id),
    cancel: (id: string) => this.client.flows.cancel(id)
  };

  readonly rateLimitBuckets = {
    list: <T = unknown>() => this.client.rateLimitBuckets.list<T>(),
    upsert: <T = unknown>(name: string, input: { max: number; durationMs: number }) => this.client.rateLimitBuckets.upsert<T>(name, input)
  };

  readonly currentFlow = {
    addJobs: (jobs: AddFlowJobInput[]) => this.addFlowJobs(jobs),
    addChild: (job: AddFlowJobInput) => this.addFlowJobs([job])
  };

  readonly rateLimits = this.rateLimitBuckets;
  readonly flow = this.currentFlow;

  constructor(options: QmeSdkOptions = {}) {
    this.apiUrl = options.apiUrl ?? process.env.QME_API_URL ?? "http://127.0.0.1:47321/api/v1";
    this.jobId = options.jobId ?? process.env.QME_JOB_ID;
    this.args = new QmeArgs(options.argv ?? process.argv.slice(2));
    this.client = new QmeClient({ apiUrl: this.apiUrl });
    this.context = {
      apiUrl: this.apiUrl,
      jobId: this.jobId,
      isQmeJob: Boolean(this.jobId),
      cwd: process.cwd(),
      originApp: process.env.QME_ORIGIN_APP
    };
  }

  progress(progressPercent: number, progressMeta?: unknown): void {
    this.protocol({ type: "job.progress", progressPercent, progressMeta });
  }

  artifact(path: string, meta?: unknown): void {
    this.protocol({ type: "job.artifact", path, meta });
  }

  output(name: string, value: unknown): void {
    this.protocol({ type: "job.output", name, value });
  }

  result(result: QmeJobResultInput): void {
    if (result.summary !== undefined) {
      this.output("summary", result.summary);
    }
    for (const [name, value] of Object.entries(result.outputs ?? {})) {
      this.output(name, value);
    }
    for (const artifact of result.artifacts ?? []) {
      if (typeof artifact === "string") {
        this.artifact(artifact);
      } else {
        this.artifact(artifact.path, artifact.meta);
      }
    }
  }

  event(type: string, data?: unknown): void {
    this.protocol({ type, data });
  }

  log(line: string, stream: "stdout" | "stderr" = "stdout"): void {
    if (stream === "stderr") {
      console.error(line);
      return;
    }
    console.log(line);
  }

  warn(message: string, data?: unknown): void {
    this.protocol({ type: "job.warning", message, data });
    this.log(data === undefined ? message : `${message} ${safeJson(data)}`, "stderr");
  }

  error(message: string, data?: unknown): void {
    this.protocol({ type: "job.error", message, data });
    this.log(data === undefined ? message : `${message} ${safeJson(data)}`, "stderr");
  }

  fail(message: string, data?: unknown): never {
    this.error(message, data);
    throw new QmeJobFailure(message, data);
  }

  async nextCommand<TPayload = unknown>(options: { timeoutMs?: number; pollMs?: number } = {}): Promise<QmeCommand<TPayload> | null> {
    const timeoutMs = options.timeoutMs ?? 0;
    const pollMs = options.pollMs ?? 250;
    const startedAt = Date.now();

    while (true) {
      const command = await this.receiveNextCommand<TPayload>();
      if (command) return command;
      if (timeoutMs <= 0 || Date.now() - startedAt >= timeoutMs) return null;
      await sleep(pollMs);
    }
  }

  async ackCommand(commandId: string, state: "completed" | "rejected" = "completed"): Promise<QmeCommand> {
    return this.request<QmeCommand>(`/commands/${encodeURIComponent(commandId)}/ack`, {
      method: "POST",
      body: JSON.stringify({ state })
    });
  }

  async handleNextCommand<TPayload = unknown>(
    options: { timeoutMs?: number; pollMs?: number } = {},
    handler: (command: QmeCommand<TPayload>) => void | Promise<void>
  ): Promise<QmeCommand<TPayload> | null> {
    const command = await this.nextCommand<TPayload>(options);
    if (!command) return null;
    try {
      await handler(command);
      await this.ackCommand(command.id, "completed");
      return command;
    } catch (error) {
      await this.ackCommand(command.id, "rejected");
      throw error;
    }
  }

  addFlowJobs(jobs: AddFlowJobInput[]): void {
    this.protocol({ type: "flow.addJobs", jobs: jobs.map((job) => normalizeFlowJobInput(job)) });
  }

  private async receiveNextCommand<TPayload>(): Promise<QmeCommand<TPayload> | null> {
    const jobId = this.requireJobId("commands.next");
    const response = await fetch(`${this.apiUrl}/jobs/${encodeURIComponent(jobId)}/commands/next`, {
      method: "POST"
    });
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error(`Qme request failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<QmeCommand<TPayload>>;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(`Qme request failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  private protocol(message: Record<string, unknown>): void {
    console.log(`QME: ${JSON.stringify(message)}`);
  }

  private requireJobId(operation: string): string {
    if (!this.jobId) {
      throw new Error(`${operation} requires QME_JOB_ID. Run this script as a Qme job or pass jobId to createQme().`);
    }
    return this.jobId;
  }
}

export interface QmeContext {
  apiUrl: string;
  jobId?: string;
  isQmeJob: boolean;
  cwd: string;
  originApp?: string;
}

export class QmeArgs {
  readonly values: string[];

  constructor(values: string[]) {
    this.values = [...values];
  }

  all(): string[] {
    return [...this.values];
  }

  first(defaultValue?: string): string {
    return this.get(0, defaultValue);
  }

  get(index: number, defaultValue?: string): string {
    const value = this.values[index];
    if (value !== undefined) return value;
    if (defaultValue !== undefined) return defaultValue;
    return "";
  }

  require(index: number, label = `argument ${index + 1}`): string {
    const value = this.values[index];
    if (value !== undefined && value.length > 0) return value;
    throw new Error(`Missing required ${label}`);
  }
}

export class QmeJobFailure extends Error {
  readonly data?: unknown;

  constructor(message: string, data?: unknown) {
    super(message);
    this.name = "QmeJobFailure";
    this.data = data;
  }
}

export function createQme(options: QmeSdkOptions = {}): QmeSdk {
  return new QmeSdk(options);
}

export function createQmeFromEnv(): QmeSdk {
  return new QmeSdk();
}

export const qme = createQmeFromEnv();

function sleep(ms: number, options: QmeSleepOptions = {}): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };

    function done() {
      options.signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, options: QmeTimeoutOptions = {}): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(options.message ?? `Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(abortError());
    };
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);

    options.signal?.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        clearTimeout(timeout);
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        cleanup();
        reject(error);
      }
    );
  });
}

async function poll<T>(check: () => T | Promise<T>, options: QmePollOptions = {}): Promise<NonNullable<T>> {
  const everyMs = options.everyMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 0;
  const startedAt = Date.now();

  while (true) {
    const value = await check();
    if (value) return value;
    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      throw new Error(options.message ?? `Timed out after ${timeoutMs}ms`);
    }
    await sleep(everyMs, options);
  }
}

function abortError(): Error {
  return new Error("Qme timer aborted");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeFlowJobInput(input: AddFlowJobInput): AddFlowJobInput & { payload: JobPayload } {
  const payload = input.payload ?? input.script;
  if (!payload) {
    throw new Error("Flow job creation requires payload or script.");
  }
  const { script: _script, ...rest } = input;
  return {
    ...rest,
    payload
  };
}
