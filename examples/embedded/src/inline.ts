import os from "node:os";
import path from "node:path";
import { Qme } from "qme";

const qme = new Qme({
  db: path.join(os.tmpdir(), "qme-embedded-example.sqlite"),
  startWorkers: false
});

const job = await qme.add(
  "math",
  "sum",
  ({ data, progress, output }) => {
    const input = data as { a: number; b: number };
    progress(50, { step: "adding" });
    const sum = input.a + input.b;
    output("sum", sum);
    return { sum };
  },
  {
    data: { a: 2, b: 3 },
    retry: qme.retry.fixed({ attempts: 2, delayMs: 250 })
  }
);

await qme.workers.tick();

console.log(qme.jobs.get(job.id));
qme.stop();
