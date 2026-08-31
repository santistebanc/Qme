# Use a Monorepo With Desktop, Client, and Examples

Status: superseded by ADR-0017

Qme will use a workspace-style repository with the Tauri desktop app, the TypeScript Node Client, and runnable examples in separate packages. This keeps the local desktop product and producer-facing API versioned together while making the Node integration a first-class deliverable instead of an afterthought.
