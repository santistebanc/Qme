import fs from "node:fs";
import path from "node:path";
import { Qme } from "qme";

const qme = Qme.fromEnv();
const marker = path.join(process.cwd(), ".flaky-once");

if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, "failed");
  qme.job.progress(25, { stage: "first attempt" });
  qme.job.fail("Failing once to verify retry/backoff");
}

fs.rmSync(marker);
qme.job.log("Recovered on retry");
qme.job.progress(100, { stage: "retry succeeded" });
