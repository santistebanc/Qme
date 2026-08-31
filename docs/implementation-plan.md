# Qme Implementation Plan

Qme is a TypeScript-first local web job queue hub. It runs as a local Node.js server, stores queue state in SQLite, serves a React/Vite web UI, and exposes HTTP plus WebSocket APIs for trusted local Node apps.

## Goals

- Run trusted local script jobs from Node, Python, or shell.
- Support scraping-oriented orchestration with Flows, DAG dependencies, retries, priorities, rate-limit buckets, cancellation, pause/resume, and real-time monitoring.
- Support AI AFK jobs that stream events and receive command-channel instructions.
- Keep all v1 code understandable and debuggable for a TypeScript/Node developer.

## Non-Goals

- No Tauri or Rust backend in v1.
- No Redis sidecar or BullMQ Redis/keyspace compatibility.
- No remote access, cloud sync, multi-user auth, or distributed workers.
- No bundled Node/Python runtimes in v1.
- No large scraped-result storage inside Qme; scripts own their output.

## Repository Shape

```text
apps/
  web/
    React + Vite Qme Web UI
packages/
  server/
    Node.js Qme Server, SQLite Store, scheduler, workers, API, WebSocket events
  client/
    @qme/client TypeScript client
examples/
  node-scraper/
    Example producer, flow creator, event subscriber, and script jobs
docs/
  adr/
  implementation-plan.md
CONTEXT.md
```

## Runtime Architecture

The `qme start` CLI launches the Qme Server on `127.0.0.1` using a configured or fallback port. The server opens the SQLite Store in the OS app-data directory, runs migrations, writes a Discovery File, starts scheduler and worker loops, serves `/api/v1`, exposes WebSocket events, and serves the built web UI.

Node apps use `@qme/client` to discover the server, enqueue jobs, create Flows, subscribe to events, and send controls such as pause, cancel, retry, deprioritize, and job commands.

## Storage

Use SQLite as the only v1 store, with WAL mode and busy timeouts.

Core tables:

- `queues`: name, state, concurrency, retry defaults, timeout defaults, retention settings.
- `flows`: id, state, origin app, completion policy, failure policy, progress summary.
- `jobs`: id, queue, flow id, state, priority, ready time, external id, dedupe key, payload, progress.
- `job_dependencies`: upstream job id, downstream job id, optional flag.
- `attempts`: job id, attempt number, timings, exit code, failure reason.
- `rate_limit_buckets`: name, policy, current window state.
- `job_bucket_assignments`: job id, bucket name.
- `commands`: id, job id, payload, expiry, ack state.
- `events`: recent event history with TTL.
- `log_chunks`: bounded indexed stdout/stderr chunks.
- `config`: app, workspace, runtime, and environment profile metadata.

Workers claim jobs using short SQLite transactions that respect queue/Flow state, dependencies, priority, ready time, concurrency, rate-limit buckets, and timeouts.

## API Sketch

HTTP uses `/api/v1`.

- `POST /queues/:name/jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `POST /jobs/:id/retry`
- `POST /jobs/:id/priority`
- `POST /jobs/:id/commands`
- `POST /flows`
- `GET /flows/:id`
- `POST /flows/:id/pause`
- `POST /flows/:id/resume`
- `POST /flows/:id/cancel`
- `POST /queues/:name/pause`
- `POST /queues/:name/resume`
- `GET /metrics`

WebSockets:

- `GET /api/v1/events`
- Subscription filters: all, queue, Flow, job, Origin App.
- Event names use dotted names such as `job.progress`, `job.completed`, `flow.paused`, `queue.depth_changed`, and `command.acked`.

## Script Protocol

Normal stdout/stderr are logs. Structured Protocol Lines start with `QME:`.

```text
QME: {"type":"job.progress","progressPercent":42,"progressMeta":{"done":42,"total":100}}
QME: {"type":"job.artifact","path":"outputs/items.jsonl"}
QME: {"type":"flow.addJobs","jobs":[...]}
QME: {"type":"command.received","commandId":"cmd_123"}
```

## UI

The Qme Web UI is a dense but friendly operational dashboard. Main navigation:

- Flows
- Queues
- Jobs
- Workers
- Rate Limits
- Settings

Open on active Flows, with a compact Health Rail showing API, SQLite Store, workers, queue depth, rate-limit waits, and stalled/interrupted work. Flow detail starts with a table/tree grouped by dependency depth and state rather than a large graph.

## Milestones

1. Done: Scaffold monorepo, TypeScript config, npm workspaces, and package build/typecheck scripts.
2. Done: Build Qme Server with SQLite storage, lightweight migrations, discovery file, and `/health`.
3. Done: Implement queues, jobs, attempts, worker claiming, child-process execution, logs, and `QME:` progress parsing.
4. Done: Implement WebSocket events and `@qme/client` enqueue/status/subscribe APIs.
5. Done: Build minimal web UI for queues, jobs, logs, progress, Flows, rate buckets, and health.
6. Done: Add Flows, DAG dependencies, dynamic job creation, and Flow controls.
7. Done: Add rate-limit buckets, priorities, pause/resume, cancel/kill, retry/backoff, and dedupe.
8. Done: Add command channel for AI AFK jobs.
9. Done: Add metrics, retention cleanup, interrupted-job recovery, and Node scraper verification examples.

## Remaining Hardening

- Done: Replace lightweight inline migrations with versioned SQLite migrations before serious data accumulates.
- Done: Add automated store tests for migration bookkeeping, dedupe, dependency blocking, queue pause, priority, and rate-limit gating.
- Add richer Flow detail UI, including dependency tree grouping and command composer.
- Add configurable workspace roots, runtime config, and environment profiles.
- Add retention controls in settings.
- Rename `/root/code/BullQ` to `/root/code/Qme` after the active workspace releases the folder lock.

## Folder Rename Note

The current workspace folder is still `/root/code/BullQ` because the active Codex workspace holds the directory open. Rename it to `/root/code/Qme` after closing this workspace or when no process has the directory locked.
