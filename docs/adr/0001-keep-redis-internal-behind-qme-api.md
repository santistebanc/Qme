# Keep Redis Internal Behind the Qme API

Status: superseded by ADR-0016

Qme will not promise BullMQ Redis keyspace or wire compatibility. This decision originally kept Redis as an internal embedded queue backend, but that storage choice was later superseded by SQLite-only storage; the lasting decision is that Node apps use a Qme TypeScript client over the localhost HTTP and WebSocket API instead of depending on BullMQ's private Redis contract.
