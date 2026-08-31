import { Qme } from "qme";

const qme = Qme.fromEnv();
const cwd = new URL(".", import.meta.url).pathname;

qme.job.log("dynamic parent started");
qme.currentFlow.addChild({
  queue: "dynamic",
  script: qme.scripts.node(`${cwd}quick-job.ts`, { args: ["dynamic-child"], cwd, originApp: "verify-orchestration" }),
  priority: 50
});
qme.job.log("dynamic parent done");
