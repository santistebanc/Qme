# Restrict Execution to Configured Workspace Roots

Qme will trust local job submitters but still require every script path and working directory to resolve inside a configured Workspace Root. This keeps the solo local workflow frictionless while preserving a clear execution boundary for mistakes, future UI controls, and possible later authorization.
