import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Qme } from "qme";

const qme = Qme.fromEnv();
const target = qme.args.first("https://example.com");
const runId = qme.jobId ?? `manual-${Date.now()}`;
const outputPath = path.join("outputs", runId, "pages.jsonl");
const rows: Array<{ target: string; chunk: number; title: string; scrapedAt: string }> = [];

qme.job.log(`Starting scrape for ${target}`);

for (let i = 1; i <= 5; i += 1) {
  await qme.sleep(600);
  rows.push({
    target,
    chunk: i,
    title: `Example page chunk ${i}`,
    scrapedAt: new Date().toISOString()
  });
  qme.job.log(`Fetched page chunk ${i}`);
  qme.job.progress(i * 20, { target, chunksDone: i, chunksTotal: 5 });
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

qme.job.result({
  summary: { target, rows: rows.length, artifact: outputPath },
  artifacts: [{ path: outputPath, meta: { format: "jsonl", rows: rows.length, target } }]
});
qme.job.log("Scrape complete");
