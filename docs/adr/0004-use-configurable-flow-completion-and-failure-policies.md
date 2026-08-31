# Use Configurable Flow Completion and Failure Policies

Qme Flows will have explicit completion and dependency failure policies instead of assuming one universal workflow shape. Scraping Flows may complete when their dependency graph drains, while AI AFK Flows may complete only when an Origin App or user explicitly marks them done; failed dependencies block downstream jobs by default but can be configured for all-or-nothing or optional-dependency behavior.
