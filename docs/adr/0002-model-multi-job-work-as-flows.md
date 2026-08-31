# Model Multi-Job Work as Flows

Qme will model scraping runs and AI AFK orchestration as first-class Flows rather than only loose dependency IDs between jobs. This gives the web UI and Node client a single object to monitor, pause, cancel, retry, and summarize while still allowing the underlying dependency graph to support DAG-shaped work.
