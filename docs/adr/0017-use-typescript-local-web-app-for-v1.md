# Use a TypeScript Local Web App for v1

Status: accepted

Qme will be a TypeScript-first local web app in v1 rather than a Tauri and Rust desktop app. The Qme Server will own SQLite, scheduling, workers, HTTP, WebSocket events, and serving the React web UI, because the project's primary operator knows TypeScript best and needs the queue engine to be easy to debug and evolve.

Desktop packaging, tray behavior, native notifications, and autostart can be added later through a wrapper if the local web app proves useful.
