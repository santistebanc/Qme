import { Qme } from "qme";

const qme = Qme.fromEnv();
const label = qme.args.first("quick");

qme.job.log(`quick-job ${label} started`);
qme.job.progress(50, { label });
await qme.sleep(300);
qme.job.log(`quick-job ${label} done`);
qme.job.progress(100, { label });
qme.job.output("summary", { label, message: "Quick job completed" });
