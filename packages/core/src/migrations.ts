import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_queue_store",
    sql: `
      create table if not exists queues (
        name text primary key,
        state text not null default 'active',
        max_concurrency integer not null default 4,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists jobs (
        id text primary key,
        queue text not null references queues(name),
        flow_id text references flows(id),
        dedupe_key text,
        dedupe_scope text,
        state text not null,
        priority integer not null default 100,
        ready_at text not null,
        payload_json text not null,
        retry_policy_json text not null default '{"attempts":1,"backoff":"fixed","delayMs":0}',
        progress_percent real,
        progress_meta_json text,
        result_meta_json text,
        failure_reason text,
        created_at text not null,
        updated_at text not null,
        started_at text,
        finished_at text
      );

      create index if not exists jobs_ready_idx
        on jobs(queue, state, ready_at, priority, created_at);

      create table if not exists flows (
        id text primary key,
        name text,
        state text not null,
        origin_app text,
        completion_policy text not null,
        failure_policy text not null,
        created_at text not null,
        updated_at text not null,
        completed_at text
      );

      create table if not exists job_dependencies (
        upstream_job_id text not null references jobs(id),
        downstream_job_id text not null references jobs(id),
        optional integer not null default 0,
        primary key (upstream_job_id, downstream_job_id)
      );

      create index if not exists job_dependencies_downstream_idx
        on job_dependencies(downstream_job_id);

      create table if not exists rate_limit_buckets (
        name text primary key,
        max integer not null,
        duration_ms integer not null,
        window_started_at text,
        used integer not null default 0,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists job_bucket_assignments (
        job_id text not null references jobs(id),
        bucket_name text not null references rate_limit_buckets(name),
        primary key (job_id, bucket_name)
      );

      create table if not exists dedupe_records (
        scope text not null,
        scope_value text not null,
        dedupe_key text not null,
        job_id text not null references jobs(id),
        created_at text not null,
        primary key (scope, scope_value, dedupe_key)
      );

      create table if not exists commands (
        id text primary key,
        job_id text not null references jobs(id),
        state text not null,
        payload_json text not null,
        expires_at text,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists commands_job_idx on commands(job_id, state, created_at);

      create table if not exists attempts (
        id text primary key,
        job_id text not null references jobs(id),
        attempt_number integer not null,
        state text not null,
        started_at text not null,
        finished_at text,
        exit_code integer,
        failure_reason text
      );

      create table if not exists log_chunks (
        id text primary key,
        job_id text not null references jobs(id),
        stream text not null,
        line text not null,
        created_at text not null
      );

      create index if not exists log_chunks_job_idx on log_chunks(job_id, created_at);

      create table if not exists events (
        id text primary key,
        type text not null,
        job_id text,
        queue text,
        data_json text not null,
        created_at text not null
      );

      create index if not exists events_created_idx on events(created_at);
    `
  }
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
  `);

  const applied = db
    .prepare("select version from schema_migrations")
    .all() as Array<{ version: number }>;
  const appliedVersions = new Set(applied.map((row) => row.version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("insert into schema_migrations (version, name, applied_at) values (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    })();
  }
}
