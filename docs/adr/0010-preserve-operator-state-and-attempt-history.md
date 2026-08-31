# Preserve Operator State and Attempt History

Qme will persist intentional operator state such as paused queues and Flows, and manual retries will reuse the same Job ID with a new Attempt record. Jobs found running after an app crash will become Interrupted Jobs and follow a configured restart policy, defaulting to manual retry for safety.
