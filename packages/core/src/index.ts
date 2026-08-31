import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { getStorePaths, QmeStore, type StorePaths } from "./db.js";
import { EventBus } from "./events.js";
import type { BackoffKind, DedupeScope, FlowRecord, JobPayload, JobRecord, RetryPolicy } from "./types.js";
import { WorkerPool, type QmeJobHandler, type QmeHandlerRegistry } from "./worker.js";

export type { StorePaths } from "./db.js";
export { QmeStore, getStorePaths } from "./db.js";
export { EventBus } from "./events.js";
export type {
  BackoffKind,
  CommandAckState,
  DedupeScope,
  FlowRecord,
  FlowState,
  JobCommandRecord,
  JobPayload,
  JobRecord,
  JobState,
  JobType,
  QmeEvent,
  QueueState,
  RateLimitBucketRecord,
  RetryPolicy
} from "./types.js";
export { WorkerPool };
export type { HandlerJobContext, QmeJobHandler } from "./worker.js";

export interface QmeOptions {
  db?: string | { path: string };
  home?: string;
  scriptsDir?: string;
  workspaceRoots?: string[];
  apiUrl?: string;
  pollMs?: number;
  startWorkers?: boolean;
}

export interface JobOptions {
  flowId?: string | null;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  originApp?: string;
  priority?: number;
  delayMs?: number;
  retry?: Partial<RetryPolicy>;
  dependsOn?: string[];
  dedupeKey?: string;
  dedupeScope?: DedupeScope;
  rateLimitBuckets?: string[];
}

export interface HandlerJobOptions<TData = unknown> extends JobOptions {
  name?: string;
  data?: TData;
}

export interface FlowJobInput extends JobOptions {
  queue?: string;
  payload: JobPayload;
}

export interface FlowOptions {
  name?: string;
  originApp?: string;
  completionPolicy?: "graph" | "explicit";
  failurePolicy?: "block" | "cancel";
  jobs?: FlowJobInput[];
}

export class Qme {
  readonly paths: StorePaths;
  readonly store: QmeStore;
  readonly events: EventBus;
  readonly workers: WorkerPool;
  readonly workspaceRoots: string[];
  readonly apiUrl: string;
  private readonly handlers: QmeHandlerRegistry = new Map();

  static create(options: QmeOptions = {}): Qme {
    return new Qme(options);
  }

  constructor(options: QmeOptions = {}) {
    this.paths = resolvePaths(options);
    const workspaceRoot = path.resolve(options.workspaceRoots?.[0] ?? options.scriptsDir ?? process.cwd());
    this.workspaceRoots = (options.workspaceRoots?.length ? options.workspaceRoots : [workspaceRoot]).map((root) => path.resolve(root));
    this.apiUrl = options.apiUrl ?? "http://127.0.0.1:47321/api/v1";
    this.store = new QmeStore(this.paths.dbPath);
    this.events = new EventBus(this.store);
    this.store.markActiveJobsInterrupted();
    this.workers = new WorkerPool(this.store, this.events, {
      workspaceRoots: this.workspaceRoots,
      apiUrl: this.apiUrl,
      pollMs: options.pollMs ?? 500,
      handlers: this.handlers
    });
    if (options.startWorkers ?? true) this.start();
  }

  start(): this {
    this.workers.start();
    return this;
  }

  stop(): void {
    this.workers.stop();
    this.store.db.close();
  }

  register<TData = unknown, TResult = unknown>(name: string, handler: QmeJobHandler<TData, TResult>): this {
    this.handlers.set(name, handler as QmeJobHandler);
    return this;
  }

  async add<TData = unknown>(queue: string, name: string, handler: QmeJobHandler<TData>, options: HandlerJobOptions<TData> = {}): Promise<JobRecord> {
    this.register(options.name ?? name, handler);
    return this.jobs.create(queue, {
      ...options,
      payload: {
        type: "handler",
        script: options.name ?? name,
        data: options.data,
        originApp: options.originApp
      }
    });
  }

  readonly scripts = {
    node: (script: string, options: JobOptions = {}): JobPayload => ({ type: "node", script, ...scriptPayloadOptions(options) }),
    python: (script: string, options: JobOptions = {}): JobPayload => ({ type: "python", script, ...scriptPayloadOptions(options) }),
    shell: (script: string, options: JobOptions = {}): JobPayload => ({ type: "shell", script, ...scriptPayloadOptions(options) })
  };

  readonly retry = {
    fixed: (options: { attempts?: number; delayMs?: number; delay?: number } = {}): Partial<RetryPolicy> => ({
      attempts: options.attempts,
      backoff: "fixed",
      delayMs: options.delayMs ?? options.delay
    }),
    exponential: (options: { attempts?: number; delayMs?: number; delay?: number } = {}): Partial<RetryPolicy> => ({
      attempts: options.attempts,
      backoff: "exponential",
      delayMs: options.delayMs ?? options.delay
    })
  };

  readonly jobs = {
    create: (queue: string, input: JobOptions & { payload: JobPayload }) => {
      const job = this.store.createJob({
        id: `job_${nanoid()}`,
        queue,
        flowId: input.flowId ?? null,
        dependsOn: input.dependsOn,
        dedupeKey: input.dedupeKey,
        dedupeScope: input.dedupeScope,
        rateLimitBuckets: input.rateLimitBuckets,
        payload: input.payload,
        priority: input.priority ?? 100,
        delayMs: input.delayMs ?? 0,
        retryPolicy: normalizeRetry(input.retry)
      });
      this.events.emit({ type: "job.created", jobId: job.id, queue: job.queue, data: { job } });
      return job;
    },
    list: (queue?: string) => this.store.listJobs(queue),
    get: (id: string) => this.store.getJob(id),
    logs: (id: string) => this.store.getLogs(id),
    commands: (id: string) => this.store.listCommands(id),
    cancel: (id: string) => {
      const job = this.store.cancelJob(id);
      this.workers.cancel(job.id);
      this.events.emit({ type: "job.cancel_requested", jobId: job.id, queue: job.queue, data: { job } });
      return job;
    },
    retry: (id: string, options: { delayMs?: number } = {}) => {
      const job = this.store.retryJob(id, options.delayMs ?? 0);
      this.events.emit({ type: "job.retry_requested", jobId: job.id, queue: job.queue, data: { job } });
      return job;
    },
    setPriority: (id: string, priority: number) => {
      const job = this.store.setJobPriority(id, priority);
      this.events.emit({ type: "job.priority_changed", jobId: job.id, queue: job.queue, data: { job } });
      return job;
    }
  };

  readonly queues = {
    list: () => this.store.listQueues(),
    pause: (queue: string) => {
      this.store.setQueueState(queue, "paused");
      this.events.emit({ type: "queue.paused", queue, data: { queue } });
      return this.store.listQueues().find((item) => item.name === queue);
    },
    resume: (queue: string) => {
      this.store.setQueueState(queue, "active");
      this.events.emit({ type: "queue.resumed", queue, data: { queue } });
      return this.store.listQueues().find((item) => item.name === queue);
    }
  };

  readonly flows = {
    create: (input: FlowOptions = {}) => {
      const flow = this.store.createFlow({
        id: `flow_${nanoid()}`,
        name: input.name,
        originApp: input.originApp,
        completionPolicy: input.completionPolicy,
        failurePolicy: input.failurePolicy
      });
      const jobs = (input.jobs ?? []).map((jobInput) =>
        this.store.createJob({
          id: `job_${nanoid()}`,
          queue: jobInput.queue ?? "default",
          flowId: flow.id,
          dependsOn: jobInput.dependsOn,
          dedupeKey: jobInput.dedupeKey,
          dedupeScope: jobInput.dedupeScope,
          rateLimitBuckets: jobInput.rateLimitBuckets,
          payload: jobInput.payload,
          priority: jobInput.priority ?? 100,
          delayMs: jobInput.delayMs ?? 0,
          retryPolicy: normalizeRetry(jobInput.retry)
        })
      );
      const nextFlow = this.store.getFlow(flow.id);
      this.events.emit({ type: "flow.created", data: { flow: nextFlow, jobs } });
      return { flow: nextFlow, jobs };
    },
    list: () => this.store.listFlows(),
    get: (id: string) => this.store.getFlow(id),
    jobs: (id: string) => this.store.listJobsByFlow(id),
    pause: (id: string) => this.setFlowState(id, "paused", "flow.paused"),
    resume: (id: string) => this.setFlowState(id, "running", "flow.resumed"),
    cancel: (id: string) => {
      const activeJobs = this.store.listJobsByFlow(id).filter((job) => job.state === "active" || job.state === "canceling");
      const flow = this.store.cancelFlow(id);
      for (const job of activeJobs) this.workers.cancel(job.id);
      this.events.emit({ type: "flow.canceled", data: { flow } });
      return flow;
    }
  };

  readonly rateLimitBuckets = {
    list: () => this.store.listRateLimitBuckets(),
    upsert: (name: string, input: { max: number; durationMs: number }) => {
      this.store.upsertRateLimitBucket({ name, max: input.max, durationMs: input.durationMs });
      this.events.emit({ type: "rate_limit_bucket.updated", data: { name, ...input } });
      return this.store.listRateLimitBuckets().find((bucket) => bucket.name === name);
    }
  };

  readonly commands = {
    send: (jobId: string, payload: unknown, options: { ttlMs?: number } = {}) => {
      const command = this.store.createCommand({ id: `cmd_${nanoid()}`, jobId, payload, ttlMs: options.ttlMs });
      const job = this.store.getJob(jobId);
      this.events.emit({ type: "command.accepted", jobId: job.id, queue: job.queue, data: { command } });
      return command;
    },
    next: (jobId: string) => {
      const command = this.store.receiveNextCommand(jobId);
      if (!command) return null;
      const job = this.store.getJob(jobId);
      this.events.emit({ type: "command.received", jobId: job.id, queue: job.queue, data: { command } });
      return command;
    },
    ack: (id: string, state: "completed" | "rejected") => {
      const command = this.store.ackCommand(id, state);
      const job = this.store.getJob(command.jobId);
      this.events.emit({ type: `command.${state}`, jobId: job.id, queue: job.queue, data: { command } });
      return command;
    }
  };

  readonly rateLimits = this.rateLimitBuckets;

  private setFlowState(id: string, state: FlowRecord["state"], eventType: string): FlowRecord {
    const flow = this.store.setFlowState(id, state);
    this.events.emit({ type: eventType, data: { flow } });
    return flow;
  }
}

function resolvePaths(options: QmeOptions): StorePaths {
  if (options.db) {
    const dbPath = typeof options.db === "string" ? options.db : options.db.path;
    const home = options.home ?? path.dirname(path.resolve(dbPath));
    return {
      home,
      dbPath: path.resolve(dbPath),
      discoveryPath: path.join(home, "discovery.json")
    };
  }
  if (options.home) {
    const home = path.resolve(options.home);
    return {
      home,
      dbPath: path.join(home, "qme.sqlite"),
      discoveryPath: path.join(home, "discovery.json")
    };
  }
  if (process.env.QME_HOME) return getStorePaths();
  const home = path.join(os.homedir(), ".qme");
  return {
    home,
    dbPath: path.join(home, "qme.sqlite"),
    discoveryPath: path.join(home, "discovery.json")
  };
}

function normalizeRetry(input: Partial<RetryPolicy> | undefined): RetryPolicy {
  return {
    attempts: input?.attempts ?? 1,
    backoff: input?.backoff ?? "fixed",
    delayMs: input?.delayMs ?? 0
  };
}

function scriptPayloadOptions(options: JobOptions): Pick<JobPayload, "args" | "env" | "cwd" | "originApp"> {
  return {
    args: options.args,
    env: options.env,
    cwd: options.cwd,
    originApp: options.originApp
  };
}
