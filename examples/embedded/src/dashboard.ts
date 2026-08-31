import os from "node:os";
import path from "node:path";
import { Qme, createApp } from "qme";

const port = Number(process.env.QME_PORT ?? 47322);
const qme = new Qme({
  db: path.join(os.tmpdir(), "qme-embedded-dashboard.sqlite"),
  workspaceRoots: [process.cwd()],
  apiUrl: `http://127.0.0.1:${port}/api/v1`,
  startWorkers: false
});

const app = await createApp({
  qme,
  paths: qme.paths,
  port,
  workspaceRoot: process.cwd()
});

await app.listen({ host: "127.0.0.1", port });

const job = await qme.add(
  "embedded",
  "collect-result",
  ({ progress, result }) => {
    progress(100, { step: "done" });
    result({
      summary: { rows: 2, artifact: "outputs/embedded/pages.jsonl" },
      artifacts: [{ path: "outputs/embedded/pages.jsonl", meta: { format: "jsonl", rows: 2 } }]
    });
  },
  { originApp: "qme-embedded-dashboard" }
);

await qme.workers.tick();

console.log(`Embedded Qme dashboard listening on http://127.0.0.1:${port}`);
console.log(`Seed job: ${job.id}`);

process.on("SIGINT", async () => {
  await app.close();
  qme.stop();
  process.exit(0);
});
