import { Qme } from "qme";

const cwd = new URL(".", import.meta.url).pathname;
const qme = Qme.connect();

interface JobStatus {
  id: string;
  state: string;
  priority: number;
  progressPercent: number | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob(id: string, predicate: (job: JobStatus) => boolean, timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await qme.jobs.get<JobStatus>(id);
    if (predicate(job)) return job;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for job ${id}`);
}

await qme.queues.pause("control");
const pausedJob = await qme.jobs.create<JobStatus>("control", {
  script: qme.scripts.node(`${cwd}scrape-job.ts`, { cwd, originApp: "verify-controls" })
});

await sleep(1200);
let pausedStatus = await qme.jobs.get<JobStatus>(pausedJob.id);
console.log("paused-state", pausedStatus.state);
if (pausedStatus.state !== "waiting") {
  throw new Error("Paused queue allowed a job to start");
}

const priorityStatus = await qme.jobs.setPriority<JobStatus>(pausedJob.id, 5);
console.log("priority", priorityStatus.priority);
if (priorityStatus.priority !== 5) {
  throw new Error("Priority did not update");
}

await qme.queues.resume("control");
await sleep(4200);
pausedStatus = await qme.jobs.get<JobStatus>(pausedJob.id);
console.log("resumed-state", pausedStatus.state, pausedStatus.progressPercent);
if (pausedStatus.state !== "completed") {
  throw new Error("Resumed job did not complete");
}

const flakyJob = await qme.jobs.create<JobStatus>("retry", {
  script: qme.scripts.node(`${cwd}flaky-job.ts`, { cwd, originApp: "verify-controls" }),
  retry: qme.retry.fixed({ attempts: 2, delayMs: 200 })
});
const flakyStatus = await waitForJob(flakyJob.id, (job) => job.state === "completed", 8_000);
console.log("flaky-state", flakyStatus.state, flakyStatus.progressPercent);
if (flakyStatus.state !== "completed" || flakyStatus.progressPercent !== 100) {
  throw new Error("Flaky retry did not complete");
}

const longJob = await qme.jobs.create<JobStatus>("cancel", {
  script: qme.scripts.node(`${cwd}long-job.ts`, { cwd, originApp: "verify-controls" })
});
await sleep(1200);
await qme.jobs.cancel(longJob.id);
await sleep(1200);
const longStatus = await qme.jobs.get<JobStatus>(longJob.id);
console.log("cancel-state", longStatus.state);
if (longStatus.state !== "canceled") {
  throw new Error("Active job was not canceled");
}

console.log("verification-ok");
