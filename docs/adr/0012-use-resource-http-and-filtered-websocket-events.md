# Use Resource HTTP and Filtered WebSocket Events

Qme will expose a resource-oriented `/api/v1` HTTP API for commands and a WebSocket event protocol with dotted event names and subscription filters. Convenience event URLs can wrap the same backend, while slow subscribers use bounded buffers and reconnect through retained Event History.
