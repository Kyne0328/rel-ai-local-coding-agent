---
name: rel-ai-workflow
description: Use Rel.AI for production repository work that requires local inspection, bounded reads or searches, guarded edits, commands, validation, change review, worktrees, managed processes, or Git publishing. Trigger when a compatible Rel.AI MCP connector is available and the task affects a configured local codebase.
---

# Rel.AI Workflow

Use Rel.AI when the requested work requires access to a configured local repository or a bounded local development process.

## Standard workflow

1. Call `relai_work` with `action: "begin"` once for each independent objective. Retain the returned `work_id`.
2. Use the bootstrap first. Add `relai_snapshot`, `relai_search`, `relai_inspect`, or `relai_read` only when the needed evidence is missing.
3. Inspect affected files and impact before editing. Preserve existing user changes.
4. Apply repository changes through `relai_edit`. Use `relai_exec` only for bounded one-shot commands.
5. Run relevant checks through `relai_validate` with `action: "checks"`. Never claim unexecuted validation.
6. Review with `relai_changes` action `diff` when risk or scope warrants it.
7. Complete atomically with validation `complete: true` and a summary, or call `relai_work` action `finish` after a final read-only review.

## Tool selection

- Work lifecycle and status: `relai_work`
- Repository overview: `relai_snapshot`
- Bounded content: `relai_read`
- Text or semantic discovery: `relai_search`
- Symbols, references, dependencies, impact, and traces: `relai_inspect`
- File mutations: `relai_edit`
- One-shot commands: `relai_exec`
- Persistent or interactive commands: `relai_process`
- Isolated branches: `relai_worktree`
- Checks, diagnostics, and HTTP probes: `relai_validate`
- Diff, restore, reset, and tidy: `relai_changes`
- Commit, push, and pull-request drafting: `relai_publish`

## Definition of done

The requested behavior is implemented, relevant validation has actually passed, changed files are known, safeguards were not bypassed, and the work session is explicitly completed or cancelled.

Load [references/workflows.md](references/workflows.md) for managed processes, worktrees, recovery, publishing, or legacy migration. Load [references/safety.md](references/safety.md) before destructive, approval-gated, sensitive, or externally visible actions.
