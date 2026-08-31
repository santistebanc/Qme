import { Qme } from "qme";

const qme = Qme.fromEnv();
const cwd = new URL(".", import.meta.url).pathname;

qme.job.log("Creating rate-limited job pair");

await qme.rateLimitBuckets.upsert("domain:example.com", { max: 1, durationMs: 1500 });

const first = await qme.jobs.create<{ id: string }>("limited", {
  rateLimits: ["domain:example.com"],
  script: qme.scripts.node("quick-job.ts", { args: ["limited-1"], cwd, originApp: "qme-web-examples" })
});

const second = await qme.jobs.create<{ id: string }>("limited", {
  rateLimits: ["domain:example.com"],
  script: qme.scripts.node("quick-job.ts", { args: ["limited-2"], cwd, originApp: "qme-web-examples" })
});

qme.job.output("created", { bucket: "domain:example.com", jobs: [first.id, second.id] });
qme.job.log("Created rate-limited pair");
