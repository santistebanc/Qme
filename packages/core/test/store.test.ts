import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { QmeStore, type JobPayload, type RetryPolicy } from "../src/index.js";

const payload: JobPayload = {
  type: "node",
  script: "examples/node-scraper/src/quick-job.ts",
  originApp: "store-tests"
};
const retryPolicy: RetryPolicy = { attempts: 1, backoff: "fixed", delayMs: 0 };

let tempDir = "";
let store: QmeStore;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qme-store-test-"));
  store = new QmeStore(path.join(tempDir, "qme.sqlite"));
});

afterEach(() => {
  store.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("QmeStore", () => {
  it("records applied schema migrations", () => {
    const rows = store.db.prepare("select version, name from schema_migrations order by version").all() as Array<{
      version: number;
      name: string;
    }>;

    assert.deepEqual(rows, [{ version: 1, name: "initial_queue_store" }]);
  });

  it("deduplicates jobs within the selected scope", () => {
    const first = createJob("job_one", { dedupeKey: "same-url", dedupeScope: "queue" });
    const second = createJob("job_two", { dedupeKey: "same-url", dedupeScope: "queue" });

    assert.equal(second.id, first.id);
    assert.equal(store.listJobs("scrape").length, 1);
  });

  it("claims ready jobs by dependency and priority rules", () => {
    createJob("slow_priority", { priority: 50 });
    createJob("fast_priority", { priority: 5 });
    createJob("dependent", { priority: 1, dependsOn: ["slow_priority"] });

    assert.equal(store.claimNextJob()?.id, "fast_priority");
    assert.equal(store.claimNextJob()?.id, "slow_priority");
    assert.equal(store.claimNextJob(), null);

    store.finishJob("slow_priority", "completed", null);
    assert.equal(store.claimNextJob()?.id, "dependent");
  });

  it("does not claim jobs from paused queues", () => {
    createJob("paused_job");
    store.setQueueState("scrape", "paused");

    assert.equal(store.claimNextJob(), null);

    store.setQueueState("scrape", "active");
    assert.equal(store.claimNextJob()?.id, "paused_job");
  });

  it("gates claims with rate limit buckets", () => {
    store.upsertRateLimitBucket({ name: "domain:example.com", max: 1, durationMs: 60_000 });
    createJob("first", { rateLimitBuckets: ["domain:example.com"] });
    createJob("second", { rateLimitBuckets: ["domain:example.com"] });

    assert.equal(store.claimNextJob()?.id, "first");
    assert.equal(store.claimNextJob(), null);
  });
});

function createJob(
  id: string,
  overrides: Partial<{
    dependsOn: string[];
    dedupeKey: string;
    dedupeScope: "flow" | "queue" | "global";
    priority: number;
    rateLimitBuckets: string[];
  }> = {}
) {
  return store.createJob({
    id,
    queue: "scrape",
    dependsOn: overrides.dependsOn,
    dedupeKey: overrides.dedupeKey,
    dedupeScope: overrides.dedupeScope,
    rateLimitBuckets: overrides.rateLimitBuckets,
    payload,
    priority: overrides.priority ?? 100,
    delayMs: 0,
    retryPolicy
  });
}
