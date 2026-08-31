import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Qme } from "../src/index.js";

let tempDir = "";
let qme: Qme;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qme-public-test-"));
  qme = new Qme({ db: path.join(tempDir, "qme.sqlite"), startWorkers: false });
});

afterEach(() => {
  qme.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("qme public package", () => {
  it("owns an embedded runtime and reports structured results", async () => {
    const job = await qme.add(
      "scraping",
      "scrape-page",
      ({ data, progress, result }) => {
        const input = data as { url: string };
        const artifact = "outputs/job/pages.jsonl";
        progress(100, { url: input.url });
        result({
          summary: { url: input.url, rows: 2, artifact },
          outputs: { firstTitle: "Example page" },
          artifacts: [{ path: artifact, meta: { format: "jsonl", rows: 2 } }]
        });
        return { ok: true };
      },
      {
        data: { url: "https://example.com" },
        retry: qme.retry.exponential({ attempts: 2, delayMs: 250 })
      }
    );

    await qme.workers.tick();

    const completed = qme.jobs.get(job.id);
    const resultMeta = completed.resultMeta as {
      outputs: Array<{ name: string; value: unknown; at: string }>;
      artifacts: Array<{ path: string; meta: unknown; at: string }>;
      return: { ok: boolean };
    };

    assert.equal(completed.state, "completed");
    assert.equal(completed.progressPercent, 100);
    assert.deepEqual(resultMeta.return, { ok: true });
    assert.deepEqual(
      resultMeta.outputs.map((output) => ({ name: output.name, value: output.value })),
      [
        { name: "summary", value: { url: "https://example.com", rows: 2, artifact: "outputs/job/pages.jsonl" } },
        { name: "firstTitle", value: "Example page" }
      ]
    );
    assert.deepEqual(resultMeta.artifacts.map((artifact) => ({ path: artifact.path, meta: artifact.meta })), [
      { path: "outputs/job/pages.jsonl", meta: { format: "jsonl", rows: 2 } }
    ]);
  });

  it("exposes client and script modes from the same Qme import", () => {
    const client = Qme.connect({ apiUrl: "http://127.0.0.1:47321/api/v1" });
    const script = Qme.fromEnv({
      apiUrl: "http://127.0.0.1:47321/api/v1",
      jobId: "job_test",
      argv: ["https://example.com"]
    });

    assert.equal(client.apiUrl, "http://127.0.0.1:47321/api/v1");
    assert.equal(script.context.isQmeJob, true);
    assert.equal(script.args.require(0, "url"), "https://example.com");
  });
});
