# Retain Operational History Without Event Sourcing

Qme will retain current state, structured logs, and recent Event History for monitoring, reconnect catch-up, and debugging, but it will not treat the event stream as the source of truth. This keeps the local queue easier to reason about while preserving the real-time visibility needed by Node apps and the web UI.
