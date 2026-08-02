# Rel.AI Workflows

## Repository investigation

Begin work once, use its bootstrap, then search before reading large areas. Use text search when terminology is known, semantic search when it is not, and inspection for symbols, references, imports, callers, affected tests, or execution traces. Keep reads bounded and batch related paths.

## Read -> edit -> validate

Read the current source and applicable repository instructions. Inspect impact when changing shared APIs, registrations, dependencies, or cross-cutting behavior. Use exact replacements for localized changes, patches for multi-file changes, and full-file content only when the whole file genuinely changes. Validate after the last mutation. Review the diff before completion when the task is broad, sensitive, or user-visible.

## Managed processes

Use `relai_process` action `start` only for a program that must persist or accept later input. Supply:

- `kind: "service"` for a development server or local service;
- `kind: "watcher"` for a file or build watcher;
- `kind: "interactive"` for a program that expects stdin;
- `purpose` describing why persistence is required.

Tests, builds, linters, source checks, package gates, and release validation are one-shot work and must use `relai_exec` or `relai_validate`.

Retain `processId`. Read logs with byte offsets. After the first read, pass the returned `metadataRevision` to receive delta output without unchanged metadata. Process listing returns active records by default; use `includeTerminal: true` only when recent history is needed. Stop the process when it is no longer required. A process handle is separate from `work_id` and native MCP Task IDs.

## Worktrees

Use `relai_worktree` action `create` for isolated branch work when the main checkout must remain untouched. Continue using the returned workspace alias. List before recovery or cleanup. Remove only after checking dirty state and active processes; removal preserves the branch.

## Change review and publishing

Use `relai_changes` action `diff` for status and patch review. Use `relai_publish` action `draft_pr` to prepare local pull-request text. Commit and push only when requested or clearly required, with exact scope and messages. Push remains approval-gated.

## Error recovery

Use returned error codes, recovery data, and current status. Re-read files after hash or stale-content conflicts. Stop or inspect managed processes before retrying lifecycle operations. Do not substitute reset for a focused restore. Cancel the exact work session when abandoning partial progress; start a new work session for a different objective.

## Public tool surface

Rel.AI always exposes the complete 12-tool capability surface. There is no profile switch or reduced mode. Old direct tool names remain rejected. Exact action contracts and action-level execution metadata are available through `relai://server/tool-surface`.
