---
name: rel-ai-workflow
description: Use Rel.AI for production work in a configured local repository: inspect code, make guarded edits, run bounded commands, validate behavior, review changes, manage explicit persistent programs, or publish Git work. Trigger only when the request requires repository access or local execution through Rel.AI.
---

# Rel.AI Workflow

This is the routing and work-session ownership skill. Specialized Rel.AI skills may refine a procedure, but they must reuse this skill's active `work_id` and must not open another work session for the same objective.

## Standard workflow

1. Call `relai_work` with `action: "begin"` exactly once for each independent objective. Retain the returned `work_id`.
2. Use the bootstrap before requesting more repository context.
3. Inspect affected files and impact before editing. Preserve existing user changes.
4. Apply repository changes through `relai_edit`.
5. Use `relai_exec` for bounded one-shot commands and `relai_validate` for checks, diagnostics, or HTTP probes.
6. Use `relai_process` only for a service, watcher, or interactive program. Process start requires an explicit `kind` and `purpose`. Tests, builds, linters, source checks, and release gates are one-shot commands, not managed processes.
7. Review material changes with `relai_changes` action `diff`.
8. Complete only after actual validation, using validation `complete: true` or `relai_work` action `finish`. Cancel abandoned work explicitly.

## Tool profiles

- `compact`: the default complete 12-tool workflow surface.
- `core`: seven high-frequency repository tools for token-sensitive workflows. Persistent processes, snapshots, recovery, worktrees, and publishing are unavailable.

These are the only supported profiles. Removed direct-operation profiles and aliases fail closed; use the consolidated tools and actions.

Use the `relai://server/tool-surface` resource when exact action fields, execution classes, or native Task eligibility are needed. Do not copy complete tool schemas into skill instructions.

## Coordination

- `rel-ai-investigation` handles evidence gathering and read-only audits.
- `rel-ai-debugging` handles reproducible defects and failure isolation.
- `rel-ai-verification` handles completion evidence and release readiness.
- `rel-ai-dev-process` handles persistent services, watchers, and interactive programs.
- Safety and server-enforced approval rules override every workflow skill.
- Tools enforce policy and bounds; skills only orchestrate the workflow.

## Definition of done

The requested behavior is implemented, relevant validation has actually passed, changed files are known, safeguards were not bypassed, and the work session is explicitly completed or cancelled.

Load [references/workflows.md](references/workflows.md) for process, worktree, recovery, publishing, or migration details. Load [references/safety.md](references/safety.md) before destructive, approval-gated, sensitive, or externally visible actions.
