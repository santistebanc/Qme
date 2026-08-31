import { Qme } from "qme";

const cwd = new URL(".", import.meta.url).pathname;
const qme = Qme.connect();

const job = await qme.jobs.create<{ id: string }>("recovery", {
  script: qme.scripts.node(`${cwd}long-job.ts`, { cwd, originApp: "verify-recovery" })
});

console.log(job.id);
