import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Qme, StorePaths } from "@qme/core";

const jobPayloadSchema = z.object({
  type: z.enum(["node", "python", "shell"]),
  script: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  originApp: z.string().optional()
});

const createJobSchema = z.object({
  flowId: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  dedupeKey: z.string().optional(),
  dedupeScope: z.enum(["flow", "queue", "global"]).optional(),
  rateLimitBuckets: z.array(z.string()).default([]),
  payload: jobPayloadSchema,
  priority: z.number().int().default(100),
  delayMs: z.number().int().min(0).default(0),
  retry: z
    .object({
      attempts: z.number().int().min(1).default(1),
      backoff: z.enum(["fixed", "exponential"]).default("fixed"),
      delayMs: z.number().int().min(0).default(0)
    })
    .default({ attempts: 1, backoff: "fixed", delayMs: 0 })
});

const flowJobSchema = createJobSchema.extend({
  queue: z.string().min(1).default("default")
});

const createFlowSchema = z.object({
  name: z.string().optional(),
  originApp: z.string().optional(),
  completionPolicy: z.enum(["graph", "explicit"]).default("graph"),
  failurePolicy: z.enum(["block", "cancel"]).default("block"),
  jobs: z.array(flowJobSchema).default([])
});

const rateLimitBucketSchema = z.object({
  max: z.number().int().min(1),
  durationMs: z.number().int().min(1)
});

export async function createApp(input: { qme: Qme; paths: StorePaths; port: number; workspaceRoot: string }) {
  const app = Fastify({ logger: true });
  await app.register(websocket);
  const { qme } = input;

  app.get("/api/v1/health", async () => ({
    ok: true,
    version: 1,
    store: input.paths.dbPath,
    discovery: input.paths.discoveryPath,
    workspaceRoot: input.workspaceRoot
  }));

  app.get("/api/v1/queues", async () => qme.queues.list());

  app.get("/api/v1/metrics", async () => qme.store.getMetrics());

  app.get("/api/v1/rate-limit-buckets", async () => qme.rateLimitBuckets.list());

  app.put("/api/v1/rate-limit-buckets/:name", async (request) => {
    const params = z.object({ name: z.string().min(1) }).parse(request.params);
    const body = rateLimitBucketSchema.parse(request.body);
    return qme.rateLimitBuckets.upsert(params.name, body);
  });

  app.get("/api/v1/flows", async () => qme.flows.list());

  app.post("/api/v1/flows", async (request, reply) => {
    const body = createFlowSchema.parse(request.body ?? {});
    return reply.code(201).send(qme.flows.create(body));
  });

  app.get("/api/v1/flows/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      return qme.flows.get(params.id);
    } catch {
      return reply.code(404).send({ error: "Flow not found" });
    }
  });

  app.get("/api/v1/flows/:id/jobs", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      qme.flows.get(params.id);
      return qme.flows.jobs(params.id);
    } catch {
      return reply.code(404).send({ error: "Flow not found" });
    }
  });

  app.post("/api/v1/flows/:id/pause", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      return qme.flows.pause(params.id);
    } catch {
      return reply.code(404).send({ error: "Flow not found" });
    }
  });

  app.post("/api/v1/flows/:id/resume", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      return qme.flows.resume(params.id);
    } catch {
      return reply.code(404).send({ error: "Flow not found" });
    }
  });

  app.post("/api/v1/flows/:id/cancel", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      return qme.flows.cancel(params.id);
    } catch {
      return reply.code(404).send({ error: "Flow not found" });
    }
  });

  app.post("/api/v1/queues/:queue/jobs", async (request, reply) => {
    const params = z.object({ queue: z.string().min(1) }).parse(request.params);
    const body = createJobSchema.parse(request.body);
    return reply.code(201).send(qme.jobs.create(params.queue, body));
  });

  app.get("/api/v1/queues/:queue/jobs", async (request) => {
    const params = z.object({ queue: z.string().min(1) }).parse(request.params);
    return qme.jobs.list(params.queue);
  });

  app.post("/api/v1/queues/:queue/pause", async (request) => {
    const params = z.object({ queue: z.string().min(1) }).parse(request.params);
    return qme.queues.pause(params.queue);
  });

  app.post("/api/v1/queues/:queue/resume", async (request) => {
    const params = z.object({ queue: z.string().min(1) }).parse(request.params);
    return qme.queues.resume(params.queue);
  });

  app.get("/api/v1/jobs", async () => qme.jobs.list());

  app.get("/api/v1/jobs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      return qme.jobs.get(params.id);
    } catch {
      return reply.code(404).send({ error: "Job not found" });
    }
  });

  app.get("/api/v1/jobs/:id/script", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      const job = qme.jobs.get(params.id);
      return readScriptSource(job.payload.script, job.payload.cwd, input.workspaceRoot);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Script not found" });
    }
  });

  app.get("/api/v1/scripts/source", async (request, reply) => {
    const query = z.object({ script: z.string().min(1), cwd: z.string().optional() }).parse(request.query);
    try {
      return readScriptSource(query.script, query.cwd, input.workspaceRoot);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Script not found" });
    }
  });

  app.get("/api/v1/jobs/:id/logs", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return qme.jobs.logs(params.id);
  });

  app.get("/api/v1/jobs/:id/commands", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      return qme.jobs.commands(params.id);
    } catch {
      return reply.code(404).send({ error: "Job not found" });
    }
  });

  app.post("/api/v1/jobs/:id/commands", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ payload: z.unknown(), ttlMs: z.number().int().min(1).optional() }).parse(request.body);
    try {
      return reply.code(201).send(qme.commands.send(params.id, body.payload, { ttlMs: body.ttlMs }));
    } catch {
      return reply.code(404).send({ error: "Job not found" });
    }
  });

  app.post("/api/v1/jobs/:id/commands/next", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      const command = qme.commands.next(params.id);
      if (!command) return reply.code(204).send();
      return command;
    } catch {
      return reply.code(404).send({ error: "Job not found" });
    }
  });

  app.post("/api/v1/commands/:id/ack", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ state: z.enum(["completed", "rejected"]) }).parse(request.body);
    try {
      return qme.commands.ack(params.id, body.state);
    } catch {
      return reply.code(404).send({ error: "Command not found" });
    }
  });

  app.post("/api/v1/jobs/:id/cancel", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      return qme.jobs.cancel(params.id);
    } catch {
      return reply.code(404).send({ error: "Job not found" });
    }
  });

  app.post("/api/v1/jobs/:id/retry", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ delayMs: z.number().int().min(0).default(0) }).parse(request.body ?? {});
    try {
      return qme.jobs.retry(params.id, { delayMs: body.delayMs });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Job cannot be retried" });
    }
  });

  app.post("/api/v1/jobs/:id/priority", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ priority: z.number().int() }).parse(request.body);
    try {
      return qme.jobs.setPriority(params.id, body.priority);
    } catch {
      return reply.code(404).send({ error: "Job not found" });
    }
  });

  app.get("/api/v1/events", { websocket: true }, (socket) => {
    qme.events.addClient(socket);
  });

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/web/dist");
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      name: "Qme",
      ui: "Run npm run dev -w @qme/web for the Vite UI, or npm run build -w @qme/web and restart Qme."
    }));
  }

  return app;
}

function readScriptSource(script: string, cwd: string | undefined, workspaceRoot: string) {
  const resolved = resolveScriptPath(script, cwd, workspaceRoot);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`Script is not a file: ${resolved}`);
  if (stat.size > 512_000) throw new Error(`Script is too large to preview: ${resolved}`);
  return {
    path: resolved,
    language: languageFromPath(resolved),
    code: fs.readFileSync(resolved, "utf8")
  };
}

function resolveScriptPath(script: string, cwd: string | undefined, workspaceRoot: string): string {
  const root = path.resolve(workspaceRoot);
  const base = path.resolve(cwd ?? root);
  const resolved = path.resolve(path.isAbsolute(script) ? script : path.join(base, script));
  if (!(resolved === root || resolved.startsWith(root + path.sep))) {
    throw new Error(`Script is outside the configured workspace root: ${script}`);
  }
  return resolved;
}

function languageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".py") return "python";
  if ([".sh", ".bash", ".zsh"].includes(ext)) return "bash";
  if (ext === ".json") return "json";
  return "text";
}
