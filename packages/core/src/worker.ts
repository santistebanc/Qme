import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { nanoid } from "nanoid";
import type { QmeStore } from "./db.js";
import type { EventBus } from "./events.js";
import type { JobPayload, JobRecord } from "./types.js";

export interface HandlerJobContext<TData = unknown> {
  job: JobRecord;
  data: TData;
  progress: (progressPercent: number, progressMeta?: unknown) => void;
  output: (name: string, value: unknown) => void;
  artifact: (path: string, meta?: unknown) => void;
  log: (line: string, stream?: "stdout" | "stderr") => void;
  signal: AbortSignal;
}

export type QmeJobHandler<TData = unknown, TResult = unknown> = (context: HandlerJobContext<TData>) => TResult | Promise<TResult>;
export type QmeHandlerRegistry = Map<string, QmeJobHandler>;

export interface WorkerOptions {
  workspaceRoots: string[];
  apiUrl: string;
  pollMs: number;
  handlers?: QmeHandlerRegistry;
}

export class WorkerPool {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly runningHandlers = new Map<string, AbortController>();
  private readonly cancelTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: QmeStore,
    private readonly events: EventBus,
    private readonly options: WorkerOptions
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error("Worker tick failed", error);
      });
    }, this.options.pollMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const child of this.running.values()) {
      child.kill();
    }
  }

  cancel(jobId: string, killAfterMs = 5_000): boolean {
    const child = this.running.get(jobId);
    const handler = this.runningHandlers.get(jobId);
    if (handler) {
      handler.abort();
      return true;
    }
    if (!child) return false;

    child.kill();
    const timer = setTimeout(() => {
      if (this.running.has(jobId)) child.kill("SIGKILL");
    }, killAfterMs);
    timer.unref();
    this.cancelTimers.set(jobId, timer);
    return true;
  }

  async tick(): Promise<void> {
    let claimed: JobRecord | null = null;
    while ((claimed = this.store.claimNextJob())) {
      void this.runJob(claimed);
    }
  }

  private async runJob(job: JobRecord): Promise<void> {
    const attemptNumber = this.store.nextAttemptNumber(job.id);
    this.store.addAttempt(`att_${nanoid()}`, job.id, attemptNumber);
    this.events.emit({ type: "job.started", jobId: job.id, queue: job.queue, data: { job, attemptNumber } });

    if (job.payload.type === "handler") {
      await this.runHandlerJob(job, attemptNumber);
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      const command = resolveCommand(job.payload, this.options.workspaceRoots);
      child = spawn(command.file, command.args, {
        cwd: command.cwd,
        env: { ...process.env, ...job.payload.env, QME_JOB_ID: job.id, QME_QUEUE: job.queue, QME_API_URL: this.options.apiUrl },
        shell: job.payload.type === "shell"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.finishAttempt(job.id, "failed", null, message);
      const failed = this.store.finishJob(job.id, "failed", message);
      this.events.emit({ type: "job.failed", jobId: job.id, queue: job.queue, data: { job: failed, failureReason: message } });
      return;
    }

    let handledExit = false;
    const cleanup = () => {
      this.running.delete(job.id);
      const cancelTimer = this.cancelTimers.get(job.id);
      if (cancelTimer) clearTimeout(cancelTimer);
      this.cancelTimers.delete(job.id);
    };
    const failJob = (message: string, exitCode: number | null = null) => {
      cleanup();
      this.store.finishAttempt(job.id, "failed", exitCode, message);
      const latest = this.store.getJob(job.id);
      if (attemptNumber < latest.retryPolicy.attempts) {
        const delayMs = computeBackoffMs(latest.retryPolicy, attemptNumber);
        const retrying = this.store.scheduleRetry(job.id, delayMs, message);
        this.events.emit({
          type: "job.retry_scheduled",
          jobId: job.id,
          queue: job.queue,
          data: { job: retrying, attemptNumber, nextAttempt: attemptNumber + 1, delayMs, failureReason: message }
        });
        return;
      }
      const failed = this.store.finishJob(job.id, "failed", message);
      this.events.emit({ type: "job.failed", jobId: job.id, queue: job.queue, data: { job: failed, failureReason: message } });
    };

    this.running.set(job.id, child);
    child.on("error", (error) => {
      if (handledExit) return;
      handledExit = true;
      failJob(error.message);
    });
    streamLines(child.stdout, (line) => this.handleLine(job, "stdout", line));
    streamLines(child.stderr, (line) => this.handleLine(job, "stderr", line));

    child.on("exit", (code, signal) => {
      if (handledExit) return;
      handledExit = true;
      cleanup();
      const latest = this.store.getJob(job.id);
      if (latest.state === "canceling") {
        this.store.finishAttempt(job.id, "failed", code, "Canceled");
        const canceled = this.store.finishJob(job.id, "canceled", null);
        this.events.emit({ type: "job.canceled", jobId: job.id, queue: job.queue, data: { job: canceled } });
        return;
      }

      if (code === 0) {
        this.store.finishAttempt(job.id, "completed", code, null);
        const completed = this.store.finishJob(job.id, "completed", null);
        this.events.emit({ type: "job.completed", jobId: job.id, queue: job.queue, data: { job: completed } });
      } else {
        failJob(signal ? `Exited by signal ${signal}` : `Exited with code ${code}`, code);
      }
    });
  }

  private async runHandlerJob(job: JobRecord, attemptNumber: number): Promise<void> {
    const handler = this.options.handlers?.get(job.payload.script);
    const failJob = (message: string) => {
      this.store.finishAttempt(job.id, "failed", null, message);
      const latest = this.store.getJob(job.id);
      if (latest.state === "canceling") {
        const canceled = this.store.finishJob(job.id, "canceled", null);
        this.events.emit({ type: "job.canceled", jobId: job.id, queue: job.queue, data: { job: canceled } });
        return;
      }
      if (attemptNumber < latest.retryPolicy.attempts) {
        const delayMs = computeBackoffMs(latest.retryPolicy, attemptNumber);
        const retrying = this.store.scheduleRetry(job.id, delayMs, message);
        this.events.emit({
          type: "job.retry_scheduled",
          jobId: job.id,
          queue: job.queue,
          data: { job: retrying, attemptNumber, nextAttempt: attemptNumber + 1, delayMs, failureReason: message }
        });
        return;
      }
      const failed = this.store.finishJob(job.id, "failed", message);
      this.events.emit({ type: "job.failed", jobId: job.id, queue: job.queue, data: { job: failed, failureReason: message } });
    };

    if (!handler) {
      failJob(`No Qme handler registered for ${job.payload.script}`);
      return;
    }

    const controller = new AbortController();
    this.runningHandlers.set(job.id, controller);
    try {
      const result = await handler({
        job,
        data: job.payload.data,
        progress: (progressPercent, progressMeta) => {
          const updated = this.store.updateJobProgress(job.id, progressPercent, progressMeta ?? null);
          this.events.emit({ type: "job.progress", jobId: job.id, queue: job.queue, data: { job: updated } });
        },
        output: (name, value) => {
          const output = { name, value, at: new Date().toISOString() };
          const updated = this.store.updateJobResultMeta(job.id, appendResultItem(this.store.getJob(job.id).resultMeta, "outputs", output));
          this.events.emit({ type: "job.output", jobId: job.id, queue: job.queue, data: { job: updated, output } });
        },
        artifact: (artifactPath, meta) => {
          const artifact = { path: artifactPath, meta: meta ?? null, at: new Date().toISOString() };
          const updated = this.store.updateJobResultMeta(job.id, appendResultItem(this.store.getJob(job.id).resultMeta, "artifacts", artifact));
          this.events.emit({ type: "job.artifact", jobId: job.id, queue: job.queue, data: { job: updated, artifact } });
        },
        log: (line, stream = "stdout") => this.handleLine(job, stream, line),
        signal: controller.signal
      });
      this.runningHandlers.delete(job.id);
      if (this.store.getJob(job.id).state === "canceling") {
        this.store.finishAttempt(job.id, "failed", null, "Canceled");
        const canceled = this.store.finishJob(job.id, "canceled", null);
        this.events.emit({ type: "job.canceled", jobId: job.id, queue: job.queue, data: { job: canceled } });
        return;
      }
      this.store.finishAttempt(job.id, "completed", 0, null);
      const resultMeta = result === undefined ? null : { ...(this.store.getJob(job.id).resultMeta as Record<string, unknown> | null), return: result };
      const completed = this.store.finishJob(job.id, "completed", null, resultMeta);
      this.events.emit({ type: "job.completed", jobId: job.id, queue: job.queue, data: { job: completed } });
    } catch (error) {
      this.runningHandlers.delete(job.id);
      failJob(error instanceof Error ? error.message : String(error));
    }
  }

  private handleLine(job: JobRecord, stream: "stdout" | "stderr", line: string): void {
    if (line.startsWith("QME:")) {
      this.handleProtocolLine(job, line.slice(4).trim());
      return;
    }

    this.store.appendLog(`log_${nanoid()}`, job.id, stream, line);
    this.events.emit({ type: "job.log", jobId: job.id, queue: job.queue, data: { stream, line } });
  }

  private handleProtocolLine(job: JobRecord, raw: string): void {
    try {
      const message = JSON.parse(raw) as {
        type?: string;
        progressPercent?: number;
        progressMeta?: unknown;
        jobs?: Array<{
          queue?: string;
          payload: JobPayload;
          dependsOn?: string[];
          priority?: number;
          delayMs?: number;
          retry?: { attempts?: number; backoff?: "fixed" | "exponential"; delayMs?: number };
          dedupeKey?: string;
          dedupeScope?: "flow" | "queue" | "global";
          rateLimitBuckets?: string[];
        }>;
        path?: string;
        name?: string;
        value?: unknown;
        meta?: unknown;
      };
      if (message.type === "job.progress") {
        const updated = this.store.updateJobProgress(job.id, message.progressPercent ?? null, message.progressMeta ?? null);
        this.events.emit({ type: "job.progress", jobId: job.id, queue: job.queue, data: { job: updated } });
        return;
      }
      if (message.type === "job.artifact") {
        if (typeof message.path !== "string") {
          throw new Error("job.artifact requires a string path");
        }
        const artifact = { path: message.path, meta: message.meta ?? null, at: new Date().toISOString() };
        const updated = this.store.updateJobResultMeta(job.id, appendResultItem(this.store.getJob(job.id).resultMeta, "artifacts", artifact));
        this.events.emit({ type: "job.artifact", jobId: job.id, queue: job.queue, data: { job: updated, artifact } });
        return;
      }
      if (message.type === "job.output") {
        if (typeof message.name !== "string") {
          throw new Error("job.output requires a string name");
        }
        const output = { name: message.name, value: message.value ?? null, at: new Date().toISOString() };
        const updated = this.store.updateJobResultMeta(job.id, appendResultItem(this.store.getJob(job.id).resultMeta, "outputs", output));
        this.events.emit({ type: "job.output", jobId: job.id, queue: job.queue, data: { job: updated, output } });
        return;
      }
      if (message.type === "flow.addJobs") {
        if (!job.flowId) {
          throw new Error("flow.addJobs requires the running job to belong to a Flow");
        }
        const jobs = (message.jobs ?? []).map((input) =>
          this.store.createJob({
            id: `job_${nanoid()}`,
            queue: input.queue ?? job.queue,
            flowId: job.flowId,
            dependsOn: input.dependsOn ?? [],
            dedupeKey: input.dedupeKey,
            dedupeScope: input.dedupeScope,
            rateLimitBuckets: input.rateLimitBuckets,
            payload: input.payload,
            priority: input.priority ?? 100,
            delayMs: input.delayMs ?? 0,
            retryPolicy: {
              attempts: input.retry?.attempts ?? 1,
              backoff: input.retry?.backoff ?? "fixed",
              delayMs: input.retry?.delayMs ?? 0
            }
          })
        );
        this.events.emit({ type: "flow.jobs_added", jobId: job.id, queue: job.queue, data: { flowId: job.flowId, jobs } });
        return;
      }
      this.events.emit({ type: message.type ?? "job.protocol", jobId: job.id, queue: job.queue, data: message });
    } catch (error) {
      const line = `Invalid QME protocol line: ${raw}`;
      this.store.appendLog(`log_${nanoid()}`, job.id, "stderr", line);
      this.events.emit({ type: "job.log", jobId: job.id, queue: job.queue, data: { stream: "stderr", line } });
    }
  }
}

function appendResultItem(current: unknown, key: "artifacts" | "outputs", item: unknown): Record<string, unknown> {
  const result = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  const existing = Array.isArray(result[key]) ? result[key] : [];
  result[key] = [...existing, item];
  return result;
}

function computeBackoffMs(policy: { backoff: "fixed" | "exponential"; delayMs: number }, attemptsUsed: number): number {
  if (policy.delayMs <= 0) return 0;
  if (policy.backoff === "fixed") return policy.delayMs;
  return policy.delayMs * 2 ** Math.max(0, attemptsUsed - 1);
}

function resolveCommand(payload: JobPayload, workspaceRoots: string[]): { file: string; args: string[]; cwd: string } {
  const cwd = resolveInsideWorkspace(payload.cwd ?? process.cwd(), workspaceRoots);
  const script = resolveInsideWorkspace(path.isAbsolute(payload.script) ? payload.script : path.join(cwd, payload.script), workspaceRoots);
  const args = payload.args ?? [];

  if (payload.type === "node") {
    return { file: process.execPath, args: [script, ...args], cwd };
  }

  if (payload.type === "python") {
    return { file: process.env.PYTHON ?? "python", args: [script, ...args], cwd };
  }

  return { file: script, args, cwd };
}

function resolveInsideWorkspace(candidate: string, roots: string[]): string {
  const resolved = path.resolve(candidate);
  const allowed = roots.map((root) => path.resolve(root));
  if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    throw new Error(`Path is outside configured workspace roots: ${candidate}`);
  }
  return resolved;
}

function streamLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  const rl = readline.createInterface({ input: stream });
  rl.on("line", onLine);
}
