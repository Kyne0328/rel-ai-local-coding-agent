# Workflow reliability

Rel.AI MCP uses one workspace workflow. ChatGPT chooses the change tool by task shape and file size instead of separate tool tiers.

```text
1. Inspect:  relai_repo_snapshot
2. Read:     relai_read
3. Change:   relai_replace / relai_write / relai_apply_update / relai_apply_bundle / relai_clear_files
4. Validate: relai_run_checks
5. Review:   relai_diff
6. Restore:  relai_restore_changes
```

Removed fallback loops are not hidden backdoors. The server should not generate helper scripts, switch to ad-hoc one-liners for repo edits, or route around the public workspace tools.

## Tool selection

Use the smallest tool that fits the job:

| Situation | Use |
| --- | --- |
| Small localized edit inside an existing file | `relai_replace` |
| Complete replacement of a small or normal-sized file | direct `relai_write` |
| Complete replacement of a larger file | staged `relai_write` |
| Multi-file patch-shaped change | `relai_apply_update` |
| Prepared file bundle update | `relai_apply_bundle` |
| Obsolete file removal | `relai_clear_files` |
| Validation | `relai_run_checks` |
| Review | `relai_diff` |
| Restore selected changes | `relai_restore_changes` |

`relai_repo_snapshot` and `relai_read` return `writeGuidance` so ChatGPT can choose among `exact-replace`, `direct-write`, `staged-write`, `apply-update`, `apply-bundle`, and `clear-file`.

## Validation check behavior

`relai_run_checks` accepts `check`, `checks`, or `checksText`. These are the preferred public names. Compatibility aliases are still accepted internally for older callers. When no check is provided, it auto-detects sensible validation checks for the workspace.

## Exact replacement and complete-file write guards

`relai_replace` requires exact current text and optionally an `expectedSha256` from `relai_read`. Ambiguous duplicate matches are refused unless an explicit `occurrence` is provided. This keeps payloads small and deterministic for files like Dart SMS handlers that can trigger connector filtering.

`relai_write` accepts complete file content only. For larger whole-file replacements, use staged chunks (`stage: start`, `append`, then `commit`) so ChatGPT does not have to send one oversized request. If a multiline source file is accidentally collapsed into one long line, the write is rejected instead of damaging formatting.
