#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Qme } from "@qme/core";
import { createApp } from "./api.js";

const port = Number(process.env.QME_PORT ?? 47321);
const workspaceRoot = path.resolve(process.env.QME_WORKSPACE_ROOT ?? process.cwd());

const qme = Qme.create({
  home: process.env.QME_HOME,
  workspaceRoots: [workspaceRoot],
  apiUrl: `http://127.0.0.1:${port}/api/v1`,
  pollMs: 500
});
const paths = qme.paths;

const app = await createApp({ qme, paths, port, workspaceRoot });
await app.listen({ host: "127.0.0.1", port });

fs.mkdirSync(paths.home, { recursive: true });
fs.writeFileSync(
  paths.discoveryPath,
  JSON.stringify(
    {
      name: "Qme",
      version: 1,
      apiUrl: `http://127.0.0.1:${port}/api/v1`,
      eventsUrl: `ws://127.0.0.1:${port}/api/v1/events`,
      pid: process.pid,
      startedAt: new Date().toISOString()
    },
    null,
    2
  )
);

const retentionTimer = setInterval(() => {
  qme.store.cleanupRetention({ eventTtlMs: Number(process.env.QME_EVENT_TTL_MS ?? 86_400_000) });
}, 60_000);
retentionTimer.unref();
console.log(`Qme listening on http://127.0.0.1:${port}`);
console.log(`Workspace root: ${workspaceRoot}`);
console.log(`SQLite store: ${paths.dbPath}`);

process.on("SIGINT", async () => {
  clearInterval(retentionTimer);
  qme.workers.stop();
  await app.close();
  qme.store.db.close();
  process.exit(0);
});
