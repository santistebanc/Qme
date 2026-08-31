import { Qme } from "qme";

const cwd = new URL(".", import.meta.url).pathname;
const qme = Qme.connect();

interface JobStatus {
  id: string;
  state: string;
  progressPercent: number | null;
  startedAt: string | null;
}

interface FlowStatus {
  id: string;
  state: string;
  totalJobs: number;
  completedJobs: number;
}

interface CommandStatus {
  id: string;
  state: string;
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

async function waitForFlow(id: string, predicate: (flow: FlowStatus) => boolean, timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const flow = await qme.flows.get<FlowStatus>(id);
    if (predicate(flow)) return flow;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for flow ${id}`);
}

const flowResult = await qme.flows.create<{ flow: FlowStatus }>({
  name: "verify-flow",
  originApp: "verify-orchestration"
});
const flowId = flowResult.flow.id;
const first = await qme.jobs.create<JobStatus>("flow", {
  flowId,
  script: qme.scripts.node(`${cwd}quick-job.ts`, { args: ["first"], cwd, originApp: "verify-orchestration" })
});
const second = await qme.jobs.create<JobStatus>("flow", {
  flowId,
  dependsOn: [first.id],
  script: qme.scripts.node(`${cwd}quick-job.ts`, { args: ["second"], cwd, originApp: "verify-orchestration" })
});
const firstDone = await waitForJob(first.id, (job) => job.state === "completed");
const secondDone = await waitForJob(second.id, (job) => job.state === "completed");
const flowDone = await waitForFlow(flowId, (flow) => flow.state === "completed");
console.log("flow-states", firstDone.state, secondDone.state, flowDone.state);
if (firstDone.state !== "completed" || secondDone.state !== "completed" || flowDone.state !== "completed") {
  throw new Error("Flow dependency chain did not complete");
}

await qme.rateLimitBuckets.upsert("domain:example.com", { max: 1, durationMs: 1500 });
const limitedOne = await qme.jobs.create<JobStatus>("limited", {
  rateLimits: ["domain:example.com"],
  script: qme.scripts.node(`${cwd}quick-job.ts`, { args: ["limited-1"], cwd, originApp: "verify-orchestration" })
});
const limitedTwo = await qme.jobs.create<JobStatus>("limited", {
  rateLimits: ["domain:example.com"],
  script: qme.scripts.node(`${cwd}quick-job.ts`, { args: ["limited-2"], cwd, originApp: "verify-orchestration" })
});
const limitedOneDone = await waitForJob(limitedOne.id, (job) => job.state === "completed", 10_000);
const limitedTwoDone = await waitForJob(limitedTwo.id, (job) => job.state === "completed", 10_000);
const spacing = new Date(limitedTwoDone.startedAt ?? 0).getTime() - new Date(limitedOneDone.startedAt ?? 0).getTime();
console.log("rate-spacing-ms", spacing);
if (limitedOneDone.state !== "completed" || limitedTwoDone.state !== "completed" || spacing < 1200) {
  throw new Error("Rate-limit bucket did not space jobs");
}

const dedupeA = await qme.jobs.create<JobStatus>("dedupe", {
  dedupeKey: "same-url",
  dedupeScope: "queue",
  script: qme.scripts.node(`${cwd}quick-job.ts`, { args: ["dedupe"], cwd, originApp: "verify-orchestration" })
});
const dedupeB = await qme.jobs.create<JobStatus>("dedupe", {
  dedupeKey: "same-url",
  dedupeScope: "queue",
  script: qme.scripts.node(`${cwd}quick-job.ts`, { args: ["dedupe"], cwd, originApp: "verify-orchestration" })
});
console.log("dedupe-ids", dedupeA.id, dedupeB.id);
if (dedupeA.id !== dedupeB.id) throw new Error("Dedupe did not return the existing job");

const dynamicFlow = await qme.flows.create<{ flow: FlowStatus }>({
  name: "dynamic-flow",
  originApp: "verify-orchestration"
});
const dynamicParent = await qme.jobs.create<JobStatus>("dynamic", {
  flowId: dynamicFlow.flow.id,
  script: qme.scripts.node(`${cwd}dynamic-parent-job.ts`, { cwd, originApp: "verify-orchestration" })
});
await waitForJob(dynamicParent.id, (job) => job.state === "completed");
const dynamicFlowDone = await waitForFlow(dynamicFlow.flow.id, (flow) => flow.totalJobs === 2 && flow.completedJobs === 2);
console.log("dynamic-flow", dynamicFlowDone.totalJobs, dynamicFlowDone.completedJobs);

const commandJob = await qme.jobs.create<JobStatus>("commands", {
  script: qme.scripts.node(`${cwd}command-job.ts`, { cwd, originApp: "verify-orchestration" })
});
await sleep(600);
await qme.commands.send(commandJob.id, { instruction: "continue" }, { ttlMs: 5000 });
const commandJobDone = await waitForJob(commandJob.id, (job) => job.state === "completed", 8_000);
const commands = await qme.commands.list<CommandStatus[]>(commandJob.id);
console.log("command-state", commandJobDone.state, commands.at(-1)?.state);
if (commandJobDone.state !== "completed" || !commands.some((item) => item.state === "completed")) {
  throw new Error("Command job did not receive and complete command");
}

console.log("orchestration-verification-ok");
