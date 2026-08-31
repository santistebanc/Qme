import { Qme } from "qme";

const qme = Qme.fromEnv();
const cwd = new URL(".", import.meta.url).pathname;

qme.job.log("Creating dependency flow");

const flow = await qme.flows.create<{ flow: { id: string } }>({
  name: "example-dependency-flow",
  originApp: "qme-web-examples"
});

const first = await qme.jobs.create<{ id: string }>("flow", {
  flowId: flow.flow.id,
  script: qme.scripts.node("quick-job.ts", { args: ["flow-first"], cwd, originApp: "qme-web-examples" })
});

const second = await qme.jobs.create<{ id: string }>("flow", {
  flowId: flow.flow.id,
  dependsOn: [first.id],
  script: qme.scripts.node("quick-job.ts", { args: ["flow-second"], cwd, originApp: "qme-web-examples" })
});

qme.job.output("created", { flowId: flow.flow.id, jobs: [first.id, second.id] });
qme.job.log(`Created dependency flow ${flow.flow.id}`);
