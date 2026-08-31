import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Qme } from "../src/index.js";

let tempDir = "";
let qme: Qme;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qme-core-test-"));
  qme = Qme.create({ db: path.join(tempDir, "qme.sqlite"), startWorkers: false });
});

afterEach(() => {
  qme.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Qme", () => {
  it("runs inline TypeScript handlers through the embedded worker", async () => {
    const job = await qme.add(
      "inline",
      "sum",
      ({ data, progress, output }) => {
        const input = data as { a: number; b: number };
        progress(50, { step: "adding" });
        output("sum", input.a + input.b);
        return input.a + input.b;
      },
      { data: { a: 2, b: 3 } }
    );

    await qme.workers.tick();

    const completed = qme.jobs.get(job.id);
    const result = completed.resultMeta as { outputs: Array<{ name: string; value: number; at: string }>; return: number };
    assert.equal(completed.state, "completed");
    assert.equal(completed.progressPercent, 50);
    assert.equal(result.return, 5);
    assert.deepEqual(result.outputs.map((output) => ({ name: output.name, value: output.value })), [{ name: "sum", value: 5 }]);
    assert.match(result.outputs[0]?.at ?? "", /^\d{4}-\d{2}-\d{2}T/);
  });
});
