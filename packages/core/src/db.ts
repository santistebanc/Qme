import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "./migrations.js";
import type {
  CommandAckState,
  DedupeScope,
  FlowRecord,
  FlowState,
  JobCommandRecord,
  JobPayload,
  JobRecord,
  JobState,
  QmeEvent,
  QueueState,
  RetryPolicy
} from "./types.js";

export interface StorePaths {
  home: string;
  dbPath: string;
  discoveryPath: string;
}

export function getStorePaths(): StorePaths {
  const home = process.env.QME_HOME ?? path.join(os.homedir(), ".qme");
  return {
    home,
    dbPath: path.join(home, "qme.sqlite"),
    discoveryPath: path.join(home, "discovery.json")
  };
}

export class QmeStore {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  migrate(): void {
    runMigrations(this.db);
    this.ensureColumn("jobs", "flow_id", "text references flows(id)");
    this.ensureColumn("jobs", "dedupe_key", "text");
    this.ensureColumn("jobs", "dedupe_scope", "text");
    this.ensureColumn("jobs", "retry_policy_json", `text not null default '{"attempts":1,"backoff":"fixed","delayMs":0}'`);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((existing) => existing.name === column)) {
      this.db.exec(`alter table ${table} add column ${column} ${definition}`);
    }
  }

  ensureQueue(name: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into queues (name, state, max_concurrency, created_at, updated_at)
         values (?, 'active', 4, ?, ?)
         on conflict(name) do nothing`
      )
      .run(name, now, now);
  }

  setQueueState(name: string, state: QueueState): void {
    this.ensureQueue(name);
    this.db.prepare(`update queues set state = ?, updated_at = ? where name = ?`).run(state, new Date().toISOString(), name);
  }

  listQueues(): Array<{ name: string; state: QueueState; maxConcurrency: number; depth: number; active: number }> {
    const rows = this.db
      .prepare(
        `select q.name, q.state, q.max_concurrency as maxConcurrency,
          sum(case when j.state = 'waiting' then 1 else 0 end) as depth,
          sum(case when j.state = 'active' then 1 else 0 end) as active
        from queues q
        left join jobs j on j.queue = q.name
        group by q.name
        order by q.name`
      )
      .all() as Array<{ name: string; state: QueueState; maxConcurrency: number; depth: number | null; active: number | null }>;

    return rows.map((row) => ({
      ...row,
      depth: row.depth ?? 0,
      active: row.active ?? 0
    }));
  }

  upsertRateLimitBucket(input: { name: string; max: number; durationMs: number }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into rate_limit_buckets (name, max, duration_ms, created_at, updated_at)
         values (?, ?, ?, ?, ?)
         on conflict(name) do update set max = excluded.max, duration_ms = excluded.duration_ms, updated_at = excluded.updated_at`
      )
      .run(input.name, input.max, input.durationMs, now, now);
  }

  ensureRateLimitBucket(name: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into rate_limit_buckets (name, max, duration_ms, created_at, updated_at)
         values (?, 1, 1000, ?, ?)
         on conflict(name) do nothing`
      )
      .run(name, now, now);
  }

  listRateLimitBuckets(): Array<{ name: string; max: number; durationMs: number; windowStartedAt: string | null; used: number }> {
    return this.db
      .prepare(
        `select name, max, duration_ms as durationMs, window_started_at as windowStartedAt, used
         from rate_limit_buckets
         order by name`
      )
      .all() as Array<{ name: string; max: number; durationMs: number; windowStartedAt: string | null; used: number }>;
  }

  getMetrics(): Record<string, number> {
    const jobs = this.db
      .prepare(
        `select
           sum(case when state = 'waiting' then 1 else 0 end) as waiting,
           sum(case when state = 'active' then 1 else 0 end) as active,
           sum(case when state = 'completed' then 1 else 0 end) as completed,
           sum(case when state = 'failed' then 1 else 0 end) as failed,
           sum(case when state = 'canceled' then 1 else 0 end) as canceled,
           sum(case when state = 'interrupted' then 1 else 0 end) as interrupted
         from jobs`
      )
      .get() as Record<string, number | null>;
    const flows = this.db
      .prepare(
        `select
           sum(case when state in ('open', 'running', 'paused') then 1 else 0 end) as activeFlows,
           sum(case when state = 'completed' then 1 else 0 end) as completedFlows
         from flows`
      )
      .get() as Record<string, number | null>;
    const buckets = this.db.prepare(`select count(*) as rateLimitBuckets from rate_limit_buckets`).get() as { rateLimitBuckets: number };
    return {
      waiting: jobs.waiting ?? 0,
      active: jobs.active ?? 0,
      completed: jobs.completed ?? 0,
      failed: jobs.failed ?? 0,
      canceled: jobs.canceled ?? 0,
      interrupted: jobs.interrupted ?? 0,
      activeFlows: flows.activeFlows ?? 0,
      completedFlows: flows.completedFlows ?? 0,
      rateLimitBuckets: buckets.rateLimitBuckets
    };
  }

  markActiveJobsInterrupted(): JobRecord[] {
    const rows = this.db.prepare(`select * from jobs where state in ('active', 'canceling')`).all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];
    const now = new Date().toISOString();
    this.db
      .prepare(
        `update jobs
         set state = 'interrupted', failure_reason = 'Qme restarted before the job completed', finished_at = ?, updated_at = ?
         where state in ('active', 'canceling')`
      )
      .run(now, now);
    return rows.map((row) => this.getJob(String(row.id)));
  }

  cleanupRetention(input: { eventTtlMs: number; terminalJobTtlMs?: number }): void {
    const eventCutoff = new Date(Date.now() - input.eventTtlMs).toISOString();
    this.db.prepare(`delete from events where created_at < ?`).run(eventCutoff);
    if (input.terminalJobTtlMs) {
      const jobCutoff = new Date(Date.now() - input.terminalJobTtlMs).toISOString();
      const oldJobs = this.db
        .prepare(`select id from jobs where state in ('completed', 'failed', 'canceled', 'interrupted') and finished_at < ?`)
        .all(jobCutoff) as Array<{ id: string }>;
      for (const job of oldJobs) {
        this.db.prepare(`delete from log_chunks where job_id = ?`).run(job.id);
      }
    }
  }

  createFlow(input: {
    id: string;
    name?: string | null;
    originApp?: string | null;
    completionPolicy?: "graph" | "explicit";
    failurePolicy?: "block" | "cancel";
  }): FlowRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into flows (id, name, state, origin_app, completion_policy, failure_policy, created_at, updated_at)
         values (?, ?, 'open', ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.name ?? null, input.originApp ?? null, input.completionPolicy ?? "graph", input.failurePolicy ?? "block", now, now);
    return this.getFlow(input.id);
  }

  getFlow(id: string): FlowRecord {
    const row = this.db.prepare(`select * from flows where id = ?`).get(id);
    if (!row) throw new Error(`Flow not found: ${id}`);
    return this.mapFlow(row as Record<string, unknown>);
  }

  listFlows(): FlowRecord[] {
    const rows = this.db.prepare(`select * from flows order by created_at desc limit 200`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapFlow(row));
  }

  setFlowState(id: string, state: FlowState): FlowRecord {
    const completedAt = ["completed", "failed", "canceled", "interrupted"].includes(state) ? new Date().toISOString() : null;
    this.db
      .prepare(`update flows set state = ?, completed_at = coalesce(?, completed_at), updated_at = ? where id = ?`)
      .run(state, completedAt, new Date().toISOString(), id);
    return this.getFlow(id);
  }

  maybeCompleteFlow(flowId: string): FlowRecord {
    const flow = this.getFlow(flowId);
    if (flow.completionPolicy !== "graph" || !["open", "running"].includes(flow.state)) return flow;
    if (flow.totalJobs > 0 && flow.totalJobs === flow.completedJobs) {
      return this.setFlowState(flowId, "completed");
    }
    return flow;
  }

  createJob(input: {
    id: string;
    queue: string;
    flowId?: string | null;
    dependsOn?: string[];
    dedupeKey?: string | null;
    dedupeScope?: DedupeScope | null;
    rateLimitBuckets?: string[];
    payload: JobPayload;
    priority: number;
    delayMs: number;
    retryPolicy: RetryPolicy;
  }): JobRecord {
    this.ensureQueue(input.queue);
    const now = new Date();
    const readyAt = new Date(now.getTime() + input.delayMs).toISOString();
    const insert = this.db.transaction(() => {
      if (input.dedupeKey && input.dedupeScope) {
        const scopeValue = dedupeScopeValue(input.dedupeScope, input.queue, input.flowId ?? null);
        const existing = this.db
          .prepare(`select job_id as jobId from dedupe_records where scope = ? and scope_value = ? and dedupe_key = ?`)
          .get(input.dedupeScope, scopeValue, input.dedupeKey) as { jobId: string } | undefined;
        if (existing) return existing.jobId;
      }
      this.db
        .prepare(
          `insert into jobs
            (id, queue, flow_id, dedupe_key, dedupe_scope, state, priority, ready_at, payload_json, retry_policy_json, created_at, updated_at)
           values (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.queue,
          input.flowId ?? null,
          input.dedupeKey ?? null,
          input.dedupeScope ?? null,
          input.priority,
          readyAt,
          JSON.stringify(input.payload),
          JSON.stringify(input.retryPolicy),
          now.toISOString(),
          now.toISOString()
        );
      for (const upstream of input.dependsOn ?? []) {
        this.db
          .prepare(`insert into job_dependencies (upstream_job_id, downstream_job_id, optional) values (?, ?, 0)`)
          .run(upstream, input.id);
      }
      for (const bucket of input.rateLimitBuckets ?? []) {
        this.ensureRateLimitBucket(bucket);
        this.db
          .prepare(`insert or ignore into job_bucket_assignments (job_id, bucket_name) values (?, ?)`)
          .run(input.id, bucket);
      }
      if (input.dedupeKey && input.dedupeScope) {
        const scopeValue = dedupeScopeValue(input.dedupeScope, input.queue, input.flowId ?? null);
        this.db
          .prepare(`insert into dedupe_records (scope, scope_value, dedupe_key, job_id, created_at) values (?, ?, ?, ?, ?)`)
          .run(input.dedupeScope, scopeValue, input.dedupeKey, input.id, now.toISOString());
      }
      if (input.flowId) {
        this.db.prepare(`update flows set state = 'running', updated_at = ? where id = ? and state = 'open'`).run(now.toISOString(), input.flowId);
      }
      return input.id;
    });
    const jobId = insert();
    return this.getJob(jobId);
  }

  getJob(id: string): JobRecord {
    const row = this.db.prepare(`select * from jobs where id = ?`).get(id);
    if (!row) {
      throw new Error(`Job not found: ${id}`);
    }
    return this.mapJob(row as Record<string, unknown>);
  }

  listJobs(queue?: string): JobRecord[] {
    const rows = queue
      ? this.db.prepare(`select * from jobs where queue = ? order by created_at desc limit 200`).all(queue)
      : this.db.prepare(`select * from jobs order by created_at desc limit 200`).all();
    return rows.map((row) => this.mapJob(row as Record<string, unknown>));
  }

  listJobsByFlow(flowId: string): JobRecord[] {
    const rows = this.db.prepare(`select * from jobs where flow_id = ? order by created_at asc`).all(flowId);
    return rows.map((row) => this.mapJob(row as Record<string, unknown>));
  }

  claimNextJob(): JobRecord | null {
    const claim = this.db.transaction(() => {
      const job = this.db
        .prepare(
          `select j.*
           from jobs j
           join queues q on q.name = j.queue
           left join flows f on f.id = j.flow_id
           where j.state = 'waiting'
             and j.ready_at <= ?
             and q.state = 'active'
             and (j.flow_id is null or f.state = 'running')
             and not exists (
               select 1
               from job_dependencies dep
               join jobs upstream on upstream.id = dep.upstream_job_id
               where dep.downstream_job_id = j.id
                 and upstream.state != 'completed'
                 and dep.optional = 0
             )
             and not exists (
               select 1
               from job_bucket_assignments assignment
               join rate_limit_buckets bucket on bucket.name = assignment.bucket_name
               where assignment.job_id = j.id
                 and bucket.window_started_at is not null
                 and julianday(bucket.window_started_at) + (bucket.duration_ms / 86400000.0) > julianday(?)
                 and bucket.used >= bucket.max
             )
             and (
               select count(*) from jobs active
               where active.queue = j.queue and active.state = 'active'
             ) < q.max_concurrency
           order by j.priority asc, j.ready_at asc, j.created_at asc
           limit 1`
        )
        .get(new Date().toISOString(), new Date().toISOString()) as Record<string, unknown> | undefined;

      if (!job) return null;

      const now = new Date().toISOString();
      this.db
        .prepare(`update jobs set state = 'active', started_at = ?, updated_at = ? where id = ? and state = 'waiting'`)
        .run(now, now, job.id);
      const assignments = this.db
        .prepare(`select bucket_name as bucketName from job_bucket_assignments where job_id = ?`)
        .all(job.id) as Array<{ bucketName: string }>;
      for (const assignment of assignments) {
        this.consumeRateLimitSlot(assignment.bucketName, now);
      }

      return this.getJob(String(job.id));
    });

    return claim();
  }

  addAttempt(id: string, jobId: string, attemptNumber: number): void {
    this.db
      .prepare(
        `insert into attempts (id, job_id, attempt_number, state, started_at)
         values (?, ?, ?, 'active', ?)`
      )
      .run(id, jobId, attemptNumber, new Date().toISOString());
  }

  nextAttemptNumber(jobId: string): number {
    const row = this.db.prepare(`select coalesce(max(attempt_number), 0) + 1 as n from attempts where job_id = ?`).get(jobId) as { n: number };
    return row.n;
  }

  finishAttempt(jobId: string, state: "completed" | "failed", exitCode: number | null, failureReason: string | null): void {
    this.db
      .prepare(
        `update attempts
         set state = ?, finished_at = ?, exit_code = ?, failure_reason = ?
         where job_id = ? and state = 'active'`
      )
      .run(state, new Date().toISOString(), exitCode, failureReason, jobId);
  }

  updateJobProgress(jobId: string, progressPercent: number | null, progressMeta: unknown): JobRecord {
    this.db
      .prepare(`update jobs set progress_percent = ?, progress_meta_json = ?, updated_at = ? where id = ?`)
      .run(progressPercent, JSON.stringify(progressMeta ?? null), new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  updateJobResultMeta(jobId: string, resultMeta: unknown): JobRecord {
    this.db
      .prepare(`update jobs set result_meta_json = ?, updated_at = ? where id = ?`)
      .run(JSON.stringify(resultMeta ?? null), new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  finishJob(jobId: string, state: Extract<JobState, "completed" | "failed" | "canceled">, failureReason: string | null, resultMeta: unknown = null): JobRecord {
    this.db
      .prepare(
        `update jobs
         set state = ?, failure_reason = ?, result_meta_json = coalesce(?, result_meta_json), finished_at = ?, updated_at = ?
         where id = ?`
      )
      .run(state, failureReason, resultMeta == null ? null : JSON.stringify(resultMeta), new Date().toISOString(), new Date().toISOString(), jobId);
    const job = this.getJob(jobId);
    if (job.flowId && state === "completed") this.maybeCompleteFlow(job.flowId);
    if (job.flowId && state === "failed") {
      const flow = this.getFlow(job.flowId);
      if (flow.failurePolicy === "cancel") this.cancelFlow(job.flowId);
    }
    return this.getJob(jobId);
  }

  scheduleRetry(jobId: string, delayMs: number, failureReason: string): JobRecord {
    const readyAt = new Date(Date.now() + delayMs).toISOString();
    this.db
      .prepare(
        `update jobs
         set state = 'waiting', ready_at = ?, failure_reason = ?, updated_at = ?
         where id = ?`
      )
      .run(readyAt, failureReason, new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  cancelJob(jobId: string): JobRecord {
    const job = this.getJob(jobId);
    if (job.state === "active") {
      this.db.prepare(`update jobs set state = 'canceling', updated_at = ? where id = ?`).run(new Date().toISOString(), jobId);
    } else if (job.state === "waiting") {
      this.finishJob(jobId, "canceled", null);
    }
    return this.getJob(jobId);
  }

  cancelFlow(flowId: string): FlowRecord {
    const cancel = this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare(`update flows set state = 'canceled', completed_at = ?, updated_at = ? where id = ?`).run(now, now, flowId);
      this.db
        .prepare(
          `update jobs
           set state = 'canceled', finished_at = ?, updated_at = ?
           where flow_id = ? and state in ('waiting', 'retrying')`
        )
        .run(now, now, flowId);
      this.db.prepare(`update jobs set state = 'canceling', updated_at = ? where flow_id = ? and state = 'active'`).run(now, flowId);
    });
    cancel();
    return this.getFlow(flowId);
  }

  retryJob(jobId: string, delayMs = 0): JobRecord {
    const job = this.getJob(jobId);
    if (!["failed", "canceled", "interrupted"].includes(job.state)) {
      throw new Error(`Job ${jobId} is not retryable from state ${job.state}`);
    }
    const readyAt = new Date(Date.now() + delayMs).toISOString();
    this.db
      .prepare(
        `update jobs
         set state = 'waiting',
             ready_at = ?,
             failure_reason = null,
             finished_at = null,
             updated_at = ?
         where id = ?`
      )
      .run(readyAt, new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  setJobPriority(jobId: string, priority: number): JobRecord {
    this.db.prepare(`update jobs set priority = ?, updated_at = ? where id = ?`).run(priority, new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  appendLog(id: string, jobId: string, stream: "stdout" | "stderr", line: string): void {
    this.db
      .prepare(`insert into log_chunks (id, job_id, stream, line, created_at) values (?, ?, ?, ?, ?)`)
      .run(id, jobId, stream, line, new Date().toISOString());
  }

  getLogs(jobId: string): Array<{ stream: string; line: string; createdAt: string }> {
    const rows = this.db
      .prepare(`select stream, line, created_at as createdAt from log_chunks where job_id = ? order by created_at asc, id asc limit 10000`)
      .all(jobId) as Array<{ stream: string; line: string; createdAt: string }>;
    return rows;
  }

  appendEvent(event: QmeEvent): void {
    this.db
      .prepare(`insert into events (id, type, job_id, queue, data_json, created_at) values (?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.type, event.jobId ?? null, event.queue ?? null, JSON.stringify(event.data), event.at);
  }

  createCommand(input: { id: string; jobId: string; payload: unknown; ttlMs?: number | null }): JobCommandRecord {
    this.getJob(input.jobId);
    const now = new Date().toISOString();
    const expiresAt = input.ttlMs ? new Date(Date.now() + input.ttlMs).toISOString() : null;
    this.db
      .prepare(
        `insert into commands (id, job_id, state, payload_json, expires_at, created_at, updated_at)
         values (?, ?, 'accepted', ?, ?, ?, ?)`
      )
      .run(input.id, input.jobId, JSON.stringify(input.payload), expiresAt, now, now);
    return this.getCommand(input.id);
  }

  getCommand(id: string): JobCommandRecord {
    const row = this.db.prepare(`select * from commands where id = ?`).get(id);
    if (!row) throw new Error(`Command not found: ${id}`);
    return mapCommand(row as Record<string, unknown>);
  }

  listCommands(jobId: string): JobCommandRecord[] {
    this.expireCommands();
    const rows = this.db.prepare(`select * from commands where job_id = ? order by created_at asc`).all(jobId);
    return rows.map((row) => mapCommand(row as Record<string, unknown>));
  }

  receiveNextCommand(jobId: string): JobCommandRecord | null {
    this.expireCommands();
    const receive = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `select * from commands
           where job_id = ? and state = 'accepted'
           order by created_at asc
           limit 1`
        )
        .get(jobId) as Record<string, unknown> | undefined;
      if (!row) return null;
      this.db.prepare(`update commands set state = 'received', updated_at = ? where id = ?`).run(new Date().toISOString(), row.id);
      return this.getCommand(String(row.id));
    });
    return receive();
  }

  ackCommand(id: string, state: Extract<CommandAckState, "completed" | "rejected">): JobCommandRecord {
    this.db.prepare(`update commands set state = ?, updated_at = ? where id = ?`).run(state, new Date().toISOString(), id);
    return this.getCommand(id);
  }

  private expireCommands(): void {
    this.db
      .prepare(`update commands set state = 'expired', updated_at = ? where state in ('accepted', 'received') and expires_at is not null and expires_at <= ?`)
      .run(new Date().toISOString(), new Date().toISOString());
  }

  private consumeRateLimitSlot(bucketName: string, now: string): void {
    const bucket = this.db
      .prepare(`select window_started_at as windowStartedAt, duration_ms as durationMs from rate_limit_buckets where name = ?`)
      .get(bucketName) as { windowStartedAt: string | null; durationMs: number } | undefined;
    if (!bucket) return;

    const windowStartedAt = bucket.windowStartedAt ? new Date(bucket.windowStartedAt).getTime() : 0;
    const windowExpired = !bucket.windowStartedAt || windowStartedAt + bucket.durationMs <= new Date(now).getTime();
    if (windowExpired) {
      this.db
        .prepare(`update rate_limit_buckets set window_started_at = ?, used = 1, updated_at = ? where name = ?`)
        .run(now, now, bucketName);
      return;
    }

    this.db.prepare(`update rate_limit_buckets set used = used + 1, updated_at = ? where name = ?`).run(now, bucketName);
  }

  private mapJob(row: Record<string, unknown>): JobRecord {
    const buckets = this.db
      .prepare(`select bucket_name as bucketName from job_bucket_assignments where job_id = ? order by bucket_name`)
      .all(row.id) as Array<{ bucketName: string }>;
    return {
      id: String(row.id),
      queue: String(row.queue),
      flowId: row.flow_id == null ? null : String(row.flow_id),
      dedupeKey: row.dedupe_key == null ? null : String(row.dedupe_key),
      dedupeScope: row.dedupe_scope == null ? null : (String(row.dedupe_scope) as DedupeScope),
      rateLimitBuckets: buckets.map((bucket) => bucket.bucketName),
      state: row.state as JobState,
      priority: Number(row.priority),
      payload: JSON.parse(String(row.payload_json)) as JobPayload,
      retryPolicy: JSON.parse(String(row.retry_policy_json)) as RetryPolicy,
      progressPercent: row.progress_percent == null ? null : Number(row.progress_percent),
      progressMeta: row.progress_meta_json == null ? null : JSON.parse(String(row.progress_meta_json)),
      resultMeta: row.result_meta_json == null ? null : JSON.parse(String(row.result_meta_json)),
      failureReason: row.failure_reason == null ? null : String(row.failure_reason),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: row.started_at == null ? null : String(row.started_at),
      finishedAt: row.finished_at == null ? null : String(row.finished_at)
    };
  }

  private mapFlow(row: Record<string, unknown>): FlowRecord {
    const counts = this.db
      .prepare(
        `select
           count(*) as totalJobs,
           sum(case when state = 'completed' then 1 else 0 end) as completedJobs,
           sum(case when state = 'failed' then 1 else 0 end) as failedJobs,
           sum(case when state = 'active' then 1 else 0 end) as activeJobs,
           sum(case when state = 'waiting' then 1 else 0 end) as waitingJobs
         from jobs
         where flow_id = ?`
      )
      .get(row.id) as {
      totalJobs: number;
      completedJobs: number | null;
      failedJobs: number | null;
      activeJobs: number | null;
      waitingJobs: number | null;
    };
    return {
      id: String(row.id),
      name: row.name == null ? null : String(row.name),
      state: row.state as FlowState,
      originApp: row.origin_app == null ? null : String(row.origin_app),
      completionPolicy: row.completion_policy as "graph" | "explicit",
      failurePolicy: row.failure_policy as "block" | "cancel",
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
      totalJobs: counts.totalJobs,
      completedJobs: counts.completedJobs ?? 0,
      failedJobs: counts.failedJobs ?? 0,
      activeJobs: counts.activeJobs ?? 0,
      waitingJobs: counts.waitingJobs ?? 0
    };
  }
}

function dedupeScopeValue(scope: DedupeScope, queue: string, flowId: string | null): string {
  if (scope === "global") return "global";
  if (scope === "queue") return queue;
  return flowId ?? "no-flow";
}

function mapCommand(row: Record<string, unknown>): JobCommandRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    state: row.state as CommandAckState,
    payload: JSON.parse(String(row.payload_json)),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
