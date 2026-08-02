# Rel.AI Workflows

## Repository investigation

Begin work once, use its bootstrap, then search before reading large areas. Use text search when terminology is known, semantic search when it is not, and inspection for symbols, references, imports, callers, affected tests, or execution traces. Keep reads bounded and batch related paths.

## Read → edit → validate

Read the current source and applicable repository instructions. Inspect impact when changing shared APIs, registrations, dependencies, or cross-cutting behavior. Use exact replacements for localized changes, patches for multi-file changes, and full-file content only when the whole file genuinely changes. Validate after the last mutation. Review the diff before completion when the task is broad, sensitive, or user-visible.

## Managed processes

Use `relai_process` action `start` for development servers or interactive commands that must persist. Retain `processId`; use `read` with byte offsets, `write` for bounded stdin, and `stop` when no longer needed. Use `list` to recover an unknown process state. A process handle is separate from `work_id` and native MCP task IDs.

## Worktrees

Use `relai_worktree` action `create` for isolated branch work when the main checkout must remain untouched. Continue using the returned workspace alias. List before recovery or cleanup. Remove only after checking dirty state and active processes; removal preserves the branch.

## Change review and publishing

Use `relai_changes` action `diff` for status and patch review. Use `relai_publish` action `draft_pr` to prepare local pull-request text. Commit and push only when requested or clearly required, with exact scope and messages. Push remains approval-gated.

## Error recovery

Use returned error codes, recovery data, and current status. Re-read files after hash or stale-content conflicts. Stop or inspect managed processes before retrying lifecycle operations. Do not substitute reset for a focused restore. Cancel the exact work session when abandoning partial progress; start a new work session for a different objective.

## Legacy migration

The legacy profile is transitional. Replace each legacy tool with its mapped compact tool and action in `docs/TOOL_PROFILE_MIGRATION.md`. Do not enable compact and legacy simultaneously. Normal read → edit → validate and begin → finish workflows retain the same call count.
