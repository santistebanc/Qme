# Qme

Qme is a local web job queue hub for trusted local applications. It accepts jobs from local apps, runs script-backed workers, and reports queue/job activity in real time.

## Language

**Local Job Queue Hub**:
A local Node.js app that owns queues, job execution, and real-time job visibility for other apps on the same machine.
_Avoid_: Automation platform, CI runner, workflow engine

**Trusted Local App**:
An app on the same machine that is allowed to submit jobs without per-app authorization. Jobs are trusted code from the user's own environment.
_Avoid_: Tenant, customer app, untrusted client

**External API**:
The localhost HTTP and WebSocket interface used by trusted local apps to create jobs and subscribe to job events.
_Avoid_: Public API, remote API

**Node Client**:
The TypeScript package used by Node apps to create jobs, subscribe to job events, and control queues through Qme's External API.
_Avoid_: BullMQ client, Redis client

**SQLite Store**:
The embedded durable database Qme uses for queue state, Flow state, job attempts, dependency tracking, command queues, dedupe records, logs metadata, config, and recent Event History.
_Avoid_: Redis backend, sidecar database

**Job**:
A requested unit of script execution with queue placement, lifecycle state, logs, progress, retry metadata, and result data.
_Avoid_: Task, command

**Queue**:
A named stream of jobs with execution policy such as concurrency, rate limiting, retries, and backoff.
_Avoid_: Channel, topic

**Worker**:
A Node.js-managed executor that claims jobs from a queue and runs the requested script as a child process.
_Avoid_: Consumer, processor

**Origin App**:
The label identifying which trusted local app submitted a job.
_Avoid_: Owner, tenant, account

**BullMQ Capability**:
A queue behavior available in BullMQ that Qme may need to offer through its own API.
_Avoid_: BullMQ compatibility, BullMQ clone

**Scraping Job**:
A job that performs web data collection and may coordinate parallel or serial dependent jobs while respecting rate limits.
_Avoid_: Scraper, crawl task

**AI AFK Job**:
A long-running AI-driven job that can stream status or output to another AI job or local process and receive further instructions while running.
_Avoid_: Agent, background AI task

**Dependent Job**:
A job whose execution or result is linked to another job in a parent-child relationship.
_Avoid_: Subtask, child process

**Flow**:
A first-class orchestration run made of multiple dependent jobs. A Flow can be monitored, paused, canceled, retried, and summarized as one unit.
_Avoid_: Batch, workflow, run

**Rate-Limit Bucket**:
A named throttle shared by jobs that must respect the same external limit, such as a domain, API, account, or proxy pool.
_Avoid_: Queue rate limit, throttle

**Script Progress Protocol**:
The structured messages a child process emits, usually as JSON lines, to report progress, logs, results, and lifecycle updates to Qme.
_Avoid_: stdout parsing, console scraping

**Job Command Channel**:
The API channel used to send instructions to a running job from the Origin App, web UI, or another job.
_Avoid_: Direct job messaging, peer-to-peer commands

**Script-Owned Result**:
Data produced by a job that the script stores in its own chosen location, with Qme retaining only small metadata or artifact pointers.
_Avoid_: Qme result storage, queue-owned data

**Flow Completion Policy**:
The rule that determines when a Flow is complete, such as graph completion, final-job completion, or explicit completion by the Origin App.
_Avoid_: Done check, finish rule

**Dependency Failure Policy**:
The rule that determines what happens to downstream jobs when an upstream dependency fails after retries.
_Avoid_: Error handling, failure mode

**Dedupe Key**:
A caller-provided key that prevents duplicate work within a configured scope such as a Flow, Queue, or the whole Qme app.
_Avoid_: Unique ID, cache key

**Event History**:
The retained recent stream of job and Flow events used for live monitoring, reconnect catch-up, and debugging.
_Avoid_: Event sourcing, audit log

**Workspace Root**:
A configured directory boundary inside which scripts may run and resolve paths.
_Avoid_: Project folder, sandbox, cwd

**Script Alias**:
A registered name that resolves to a script path inside a Workspace Root.
_Avoid_: Command name, executable alias

**Environment Profile**:
A named set of environment variables that can be applied to jobs without exposing secret values in job history, logs, or events.
_Avoid_: Env preset, secret group

**Runtime Config**:
The configuration that tells Qme how to find script runtimes such as Node, Python, or shell.
_Avoid_: PATH setup, interpreter settings

**Protocol Line**:
A child-process output line with an explicit Qme prefix containing structured JSON for progress, result metadata, dependent job creation, or lifecycle updates.
_Avoid_: JSON stdout, magic log line

**Discovery File**:
A file written by the running Qme app in a standard app-data location so local clients can find the active API URL, version, and status.
_Avoid_: Lock file, pid file

**External ID**:
A caller-provided identifier used to correlate Qme jobs with records in the Origin App.
_Avoid_: Job ID, custom ID

**Attempt**:
One execution try for a Job, including its own timing, logs, exit status, and failure reason.
_Avoid_: Retry job, rerun

**Interrupted Job**:
A previously running job found after Qme restarts without a clean completion record.
_Avoid_: Crashed job, orphaned job

**Job State**:
The lifecycle state of a Job, excluding operator state such as queue or Flow pause.
_Avoid_: Status, phase

**Flow State**:
The lifecycle state of a Flow as an operator-facing orchestration object.
_Avoid_: Run status, workflow state

**Queue State**:
The execution availability of a Queue, such as active, paused, draining, or disabled.
_Avoid_: Queue status, enabled flag

**Command Ack**:
A state update describing whether a job command was accepted by Qme, received by the job, completed by the job, expired, or rejected.
_Avoid_: Command result, reply

**Operational Metrics**:
Queue, Flow, and worker measurements used to monitor local execution health and throughput.
_Avoid_: Analytics, telemetry

**Health Rail**:
A compact web UI region that shows local API, SQLite Store, worker, and queue health beside the active work view.
_Avoid_: Dashboard, status page

**Artifact Pointer**:
A small reference from Qme metadata to a file or location created by a script.
_Avoid_: Stored result, attachment

**Vertical Slice**:
The smallest working product path from Node enqueue through Qme execution to real-time UI and Node event monitoring.
_Avoid_: MVP, scaffold

**Qme Server**:
The local Node.js process that owns the SQLite Store, scheduler, workers, HTTP API, WebSocket events, and web UI.
_Avoid_: Rust backend, daemon

**Qme Web UI**:
The React/Vite interface served by the Qme Server for monitoring and controlling queues, Flows, jobs, workers, and rate limits.
_Avoid_: Desktop UI, Tauri UI
