# Use Explicit Protocol Lines for Script Events

Qme will treat normal child-process stdout and stderr as logs, and only parse structured script events from explicitly prefixed Protocol Lines. This lets existing scripts print freely while giving Node, Python, and shell jobs a language-neutral way to report progress, create dependent jobs, emit result metadata, and receive orchestration support.
