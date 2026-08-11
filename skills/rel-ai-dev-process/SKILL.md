---
name: rel-ai-dev-process
description: Use when repository work needs a persistent development server, file watcher, long-lived preview, or interactive CLI.
---

# Rel.AI Development Process

Reuse the active `work_id` opened by `rel-ai-workflow`. Do not call `relai_work` with `action: "begin"` when the same objective already has a work session.
Use runtime workflow guidance before starting another process. If `relai_process` returns `reused: true`, keep the reused same-task process and continue from its readiness/log state; do not start a duplicate process. `workflow.recommendedActions` calibrates whether more process evidence is useful or control should return to debugging/verification.

Use this process flow: `start with explicit purpose -> determine readiness -> inspect incremental output -> interact only if required -> reuse process -> stop when no longer needed`.

1. Confirm the command is genuinely persistent or interactive. One-shot commands belong in `relai_exec` or `relai_validate`.
2. Start it with `relai_process` action `start`, an explicit `kind` (`service`, `watcher`, or `interactive`), and a concrete `purpose` explaining why persistence is needed.
3. Determine readiness from startup output or a bounded HTTP probe before treating the process as usable.
4. Read logs incrementally with stdout/stderr offsets. Reuse `metadataRevision` after the first read so unchanged process metadata is not returned repeatedly.
5. Reuse the same live process while it still serves the objective. Write stdin only when an interactive program actually expects it.
6. When the runtime has produced enough evidence, return control to `rel-ai-debugging` for defect work or `rel-ai-verification` for proof instead of keeping process management as the active concern.
7. Stop the process explicitly when it is no longer needed.
8. Use `relai_exec` or `relai_validate` instead for one-shot tests, builds, checks, migrations that terminate, or release gates.
