# Use SQLite as the Only v1 Queue Store

Status: accepted

Qme will use SQLite as the only durable queue/state store in v1 instead of bundling Redis or another Redis-compatible sidecar. Because Qme does not promise BullMQ Redis keyspace compatibility and exposes its own HTTP, WebSocket, and TypeScript client API, SQLite can hold queue state, Flow graphs, attempts, command queues, dedupe records, logs metadata, config, and recent Event History with less packaging complexity and better cross-platform portability.
