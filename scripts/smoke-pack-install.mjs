import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qme-pack-smoke-"));
const packDir = path.join(tempDir, "packs");
const appDir = path.join(tempDir, "app");

fs.mkdirSync(packDir);
fs.mkdirSync(appDir);

const workspaces = ["@qme/client", "@qme/core", "@qme/sdk", "@qme/server", "qme"];

try {
  for (const workspace of workspaces) {
    execFileSync("npm", ["pack", "-w", workspace, "--pack-destination", packDir], {
      cwd: repoRoot,
      stdio: "pipe"
    });
  }

  const tarballs = fs
    .readdirSync(packDir)
    .filter((file) => file.endsWith(".tgz"))
    .sort()
    .map((file) => path.join(packDir, file));

  assert.equal(tarballs.length, workspaces.length);

  execFileSync("npm", ["init", "-y"], { cwd: appDir, stdio: "pipe" });
  execFileSync("npm", ["install", "--foreground-scripts", ...tarballs], {
    cwd: appDir,
    stdio: "pipe"
  });

  const smokeTest = `
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Qme, createApp } from "qme";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qme-installed-"));
const qme = new Qme({
  db: path.join(tempDir, "qme.sqlite"),
  startWorkers: false
});

try {
  assert.equal(typeof Qme.connect, "function");
  assert.equal(typeof Qme.fromEnv, "function");
  assert.equal(typeof createApp, "function");

  const job = await qme.add(
    "pack",
    "hello",
    ({ data, result }) => {
      result({ summary: data });
      return { ok: true };
    },
    { data: { message: "installed package works" } }
  );

  await qme.workers.tick();
  const completed = qme.jobs.get(job.id);

  assert.equal(completed.state, "completed");
  assert.deepEqual(completed.resultMeta.return, { ok: true });
  assert.equal(completed.resultMeta.outputs[0].name, "summary");
  assert.deepEqual(completed.resultMeta.outputs[0].value, { message: "installed package works" });
} finally {
  qme.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
`;

  fs.writeFileSync(path.join(appDir, "smoke.mjs"), smokeTest);
  execFileSync("node", ["smoke.mjs"], { cwd: appDir, stdio: "pipe" });
  console.log("Packed qme install smoke test passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
