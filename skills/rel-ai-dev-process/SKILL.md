---
name: rel-ai-dev-process
description: Start, inspect, interact with, and stop a persistent local service, watcher, or interactive program in a configured repository. Trigger for development servers, file watchers, long-lived preview processes, or interactive CLIs. Do not trigger for tests, builds, linters, source checks, release gates, or other commands expected to terminate with one result.
---

# Rel.AI Development Process

Reuse the active `work_id` opened by `rel-ai-workflow`. Do not call `relai_work` with `action: "begin"` when the same objective already has a work session.

1. Confirm the command is genuinely persistent or interactive.
2. Start it with `relai_process` action `start`, an explicit `kind` (`service`, `watcher`, or `interactive`), and a concrete `purpose`.
3. Use readiness output or a bounded HTTP probe to verify startup.
4. Read logs incrementally with stdout and stderr offsets. Reuse `metadataRevision` to omit unchanged process metadata.
5. Write stdin only for an interactive program that expects it.
6. Stop the process explicitly when it is no longer needed.
7. Use `relai_exec` or `relai_validate` instead for one-shot tests, builds, checks, or release gates.
