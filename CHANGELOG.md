# Changelog

All notable changes to Qme will be recorded in this file.

Qme follows semver for the public `qme` package. Until `1.0.0`, minor versions
may still refine API shape, but release notes should call out any migration work.

## 0.1.0 - Unreleased

- Added the TypeScript-first `Qme` public API for embedded runtimes, trusted
  local clients, and script job contexts.
- Added SQLite-backed jobs, queues, flows, retry policies, rate limit buckets,
  dedupe keys, command channels, logs, progress, outputs, and artifact pointers.
- Added the local dashboard and static GitHub Pages demo.
- Added bundled examples for quick jobs, scraping, retries, cancellation,
  command handling, rate limits, dependency flows, dynamic flows, and embedded
  handlers.
- Added package tarball smoke testing so release builds are checked from a
  fresh installed app.
