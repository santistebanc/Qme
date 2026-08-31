import { Qme } from "qme";

const qme = Qme.fromEnv();
const target = qme.args.first("https://example.com");

qme.job.log(`Starting scrape for ${target}`);

for (let i = 1; i <= 5; i += 1) {
  await qme.sleep(600);
  qme.job.log(`Fetched page chunk ${i}`);
  qme.job.progress(i * 20, { target, chunksDone: i, chunksTotal: 5 });
}

qme.job.output("summary", { target, chunks: 5 });
qme.job.artifact("outputs/example.jsonl", { format: "jsonl", target });
qme.job.log("Scrape complete");
