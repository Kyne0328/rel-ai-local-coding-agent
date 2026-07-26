# Workflow reliability

Rel.AI MCP exposes 20 callable tools, all active. The six compatibility tools were removed in tool-surface version 10. The sequence is flexible: use only the stages the task requires.

```text
1. Identify: relai_start_task once per independent task
2. Inspect:  relai_repo_snapshot when an overview is useful
3. Locate:   relai_search when raw text or source context is needed
4. Trace:    relai_code_inspect for symbols, callers, impact, and affected tests
5. Read:     relai_read for relevant files or line ranges
6. Develop:  relai_exec for one-shot project commands when needed
7. Change:   relai_edit
8. Validate + complete atomically: relai_run_checks with complete:true and summary
9. Alternative post-validation review: relai_run_checks -> relai_status / relai_diff -> relai_complete_task
10. Recover: relai_restore_paths / relai_reset_workspace / relai_tidy_plan + relai_tidy_run
11. Publish: relai_git_commit -> relai_git_push
12. Prepare review text when useful: relai_git_draft_pr
```

The initial snapshot is a bounded repository map, not an access boundary. Search and direct reads can continue anywhere inside the configured workspace. When `projectInstructions` is present, apply its sources in order: `REL_AI.md` overrides `.relai/instructions.md`. Read the named file directly if the combined 64 KiB payload is truncated. The server does not execute instruction content, generate helper scripts, expose hidden tool tiers, or route around the registered workspace tools.

## Tool selection

| Situation | Use |
| --- | --- |
| Start an independent logical task | `relai_start_task`; reuse its `task_id` on subsequent calls |
| Repository overview | `relai_repo_snapshot` |
| Repository-specific architecture and workflow rules | `projectInstructions` from the snapshot; direct `relai_read` when truncated |
| Locate code with surrounding source | `relai_search`; adaptive auto mode is the default. Use `compact` for path/line-only output or `context` for fixed caller-controlled limits. |
| Symbol definitions, references, calls, reverse-import impact, and affected tests | `relai_code_inspect` |
| Focused file content | `relai_read` |
| Small localized edit | `relai_edit` with `oldText` and `newText` |
| Complete file replacement | `relai_edit` with `content` |
| Multi-file patch or tracked-file deletion | `relai_edit` with `updateText` |
| Several edits in one request | `relai_edit` with `edits` |
| Exact replacement | `relai_edit` with `oldText`/`newText`, optional `occurrence`, or `replacements:[...]` |
| Session-owned untracked cleanup | `relai_tidy_plan` then `relai_tidy_run` |
| Dependency installation, migrations, compilers, and repository utilities | `relai_exec` |
| Final validation and explicit atomic completion | `relai_run_checks` with `complete:true` and `summary` |
| Completion after post-validation read-only review | `relai_complete_task` |
| Local HTTP route validation | `relai_http_probe` |
| Declared UI/browser script validation | `relai_ui_check` |
| Workspace, branch, ownership, and untracked state | `relai_status` with `workspace` |
| File-level review | `relai_diff` |
| Restore listed tracked paths only | `relai_restore_paths` |
| Reset all tracked workspace changes | `relai_reset_workspace` with `confirmation:"RESET"` |
| Reset tracked changes and remove all untracked files | `relai_reset_workspace` with `removeUntracked:true` and `confirmation:"RESET_AND_CLEAN"` |
| Prepare local pull-request text | `relai_git_draft_pr` |

`relai_search` defaults to adaptive auto mode. It uses focused limits for up to 20 matches, moderate limits for 21–100 matches, and smaller broad-search limits above 100. Auto mode prioritizes files using query-to-path relevance and bounded match density. Explicit compact mode preserves the original path/line response; explicit context mode applies caller-controlled limits. Context results merge overlaps by default, include SHA-256 file hashes, and report separate match and context truncation so a broad text search cannot silently imply that every match received source context.

`relai_repo_snapshot` and `relai_read` return write guidance for exact replacement, direct complete-file writes, staged complete-file writes, patch-shaped updates, and bounded workspace tidy operations.

## Validation behavior

`relai_run_checks` exposes `level` presets:

| Level | Meaning |
| --- | --- |
| `quick` | Syntax and lightweight checks. |
| `standard` | Normal project validation. This is the default. |
| `release` | Broad release validation. |

When no explicit check is supplied through an internal or local call path, Rel.AI detects configured workspace checks. `relai_edit` accepts the same level when `runChecks: true` is used.

Completion is never inferred from validation alone. Passing `complete:true` with a non-empty `summary` is the explicit signal to close the task in the same final validation call. If read-only review must happen afterward, run checks without completion and then call `relai_complete_task`. `relai_exec` is a development command runner, not a validation record; a command such as `npm test` cannot complete a task.

`relai_http_probe` accepts only local route paths beginning with `/`. `relai_ui_check` accepts only an exact script name declared in the workspace `package.json`.

`relai_restore_paths` is path-scoped and tracked-file-only. It never removes untracked files. `relai_reset_workspace` is repository-wide and requires `confirmation:"RESET"`; setting `removeUntracked:true` requires `confirmation:"RESET_AND_CLEAN"`.

`relai_status` owns both workspace configuration/session state and repository state. When a workspace is supplied, branch, ahead/behind, ownership-split changes, and untracked-file state are returned under `workspace.repository`.

`relai_git_draft_pr` only prepares local title/body text from a Git diff. It never calls a hosting provider or changes a remote pull request.

Persistent process management, managed worktrees, and persistent task plans are deferred. They are not part of the current tool surface or completion workflow.

## Edit safeguards

`relai_edit` exact replacements require current text. An optional `expectedSha256` from `relai_read` makes stale edits fail closed. Duplicate matches require `occurrence` or a larger unique block; `replacements:[...]` applies several deterministic changes to one file.

`relai_edit` accepts complete-file `content` and preserves `expectedSha256` through direct and staged writes. Large content stages automatically. Explicit stage start/append/commit accepts `content` for file replacement or `updateText` for patch streaming.

Patch-shaped `relai_edit` calls can enforce a clean worktree, create a tracked-change backup, and reject updates above the configured maximum size.

## Deletion safeguards

Tracked files are deleted through structured patch operations:

```text
*** Begin Patch
*** Delete File: path/to/file
*** End Patch
```

Untracked files are not accepted as arbitrary deletion arguments. `relai_tidy_plan` selects current-session candidates, and `relai_tidy_run` verifies the plan ID, expiry, workspace, ownership, file shape, and content hash before deletion.
