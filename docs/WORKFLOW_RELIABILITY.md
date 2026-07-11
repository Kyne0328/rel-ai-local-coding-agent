# Workflow reliability

Rel.AI MCP uses one workspace workflow and one 16-tool surface.

```text
1. Inspect:  relai_repo_snapshot
2. Read:     relai_read
3. Change:   relai_edit / relai_write / relai_replace
4. Validate: relai_run_checks
5. Review:   relai_diff / relai_git_status
6. Cleanup:  relai_restore_changes / relai_tidy_plan + relai_tidy_run
7. Publish:  relai_git_commit -> relai_git_push -> relai_git_create_pr
```

The server does not generate helper scripts, expose hidden tool tiers, or route around the registered workspace tools.

## Tool selection

| Situation | Use |
| --- | --- |
| Repository overview | `relai_repo_snapshot` |
| Focused file content | `relai_read` |
| Small localized edit | `relai_edit` with `oldText` and `newText` |
| Complete file replacement | `relai_edit` with `content` |
| Multi-file patch or tracked-file deletion | `relai_edit` with `updateText` |
| Several edits in one request | `relai_edit` with `edits` |
| Direct complete-file fallback | `relai_write` |
| Direct exact-replacement fallback | `relai_replace` |
| Session-owned untracked cleanup | `relai_tidy_plan` then `relai_tidy_run` |
| Validation | `relai_run_checks` |
| Browser or route validation | `relai_browser` |
| Review | `relai_diff` or `relai_git_status` |
| Restore selected changes | `relai_restore_changes` |

`relai_repo_snapshot` and `relai_read` return write guidance for exact replacement, direct complete-file writes, staged complete-file writes, patch-shaped updates, and bounded workspace tidy operations.

## Validation behavior

`relai_run_checks` exposes `level` presets:

| Level | Meaning |
| --- | --- |
| `quick` | Syntax and lightweight checks. |
| `standard` | Normal project validation. This is the default. |
| `release` | Broad release validation. |

When no explicit check is supplied through an internal or local call path, Rel.AI detects configured workspace checks. `relai_edit` accepts the same level when `runChecks: true` is used.

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
