# Workflow reliability

Rel.AI MCP uses one 19-tool surface. The sequence is flexible: use only the stages the task requires.

```text
1. Inspect:  relai_repo_snapshot when an overview is useful
2. Locate:   relai_search when the code location is unknown
3. Read:     relai_read for relevant files or line ranges
4. Develop:  relai_exec for one-shot project commands when needed
5. Change:   relai_edit / relai_write / relai_replace
6. Validate: relai_run_checks
7. Review:   relai_diff / relai_git_status
8. Cleanup:  relai_restore_changes / relai_tidy_plan + relai_tidy_run
9. Publish:  relai_git_commit -> relai_git_push -> relai_git_create_pr
10. Complete: relai_complete_task
```

The initial snapshot is a bounded repository map, not an access boundary. Search and direct reads can continue anywhere inside the configured workspace. When `projectInstructions` is present, apply its sources in order: `REL_AI.md` overrides `.relai/instructions.md`. Read the named file directly if the combined 64 KiB payload is truncated. The server does not execute instruction content, generate helper scripts, expose hidden tool tiers, or route around the registered workspace tools.

## Tool selection

| Situation | Use |
| --- | --- |
| Repository overview | `relai_repo_snapshot` |
| Repository-specific architecture and workflow rules | `projectInstructions` from the snapshot; direct `relai_read` when truncated |
| Locate code with surrounding source | `relai_search`; adaptive auto mode is the default. Use `compact` for path/line-only output or `context` for fixed caller-controlled limits. |
| Focused file content | `relai_read` |
| Small localized edit | `relai_edit` with `oldText` and `newText` |
| Complete file replacement | `relai_edit` with `content` |
| Multi-file patch or tracked-file deletion | `relai_edit` with `updateText` |
| Several edits in one request | `relai_edit` with `edits` |
| Direct complete-file fallback | `relai_write` |
| Direct exact-replacement fallback | `relai_replace` |
| Session-owned untracked cleanup | `relai_tidy_plan` then `relai_tidy_run` |
| Dependency installation, migrations, compilers, and repository utilities | `relai_exec` |
| Validation | `relai_run_checks` |
| Browser or route validation | `relai_browser` |
| Review | `relai_diff` or `relai_git_status` |
| Restore selected changes | `relai_restore_changes` |

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

`relai_exec` is a development command runner, not a validation record. A command such as `npm test` can help diagnose a project, but completion still requires a later successful `relai_run_checks` after the final mutation.

Persistent process management, managed worktrees, and persistent task plans are deferred. They are not part of the current tool surface or completion workflow.

## Edit safeguards

`relai_replace` requires exact current text. An optional `expectedSha256` from `relai_read` makes stale edits fail closed. Duplicate matches require an explicit occurrence or a larger unique text block.

`relai_write` accepts complete-file content. Staged mode exists only for transports that cannot send a complete large payload in one request.

Patch-shaped `relai_edit` calls can enforce a clean worktree, create a tracked-change backup, and reject updates above the configured maximum size.

## Deletion safeguards

Tracked files are deleted through structured patch operations:

```text
*** Begin Patch
*** Delete File: path/to/file
*** End Patch
```

Untracked files are not accepted as arbitrary deletion arguments. `relai_tidy_plan` selects current-session candidates, and `relai_tidy_run` verifies the plan ID, expiry, workspace, ownership, file shape, and content hash before deletion.
