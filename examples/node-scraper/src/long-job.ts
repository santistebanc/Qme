import { Qme } from "qme";

const qme = Qme.fromEnv();
qme.job.log("Long job started");

for (let i = 1; i <= 30; i += 1) {
  await qme.sleep(qme.seconds(1));
  qme.job.log(`Still running ${i}`);
  qme.job.progress(i, { tick: i });
}
