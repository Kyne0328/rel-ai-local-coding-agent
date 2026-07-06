# Workflow reliability

Rel.AI MCP uses one workspace workflow. ChatGPT chooses the change tool by task shape and file size instead of separate tool tiers.

```text
1. Inspect:  relai_repo_snapshot
2. Read:     relai_read
3. Change:   relai_edit (exact replace / full-file / patch / batch) / relai_apply_bundle
4. Validate: relai_run_checks
5. Review:   relai_diff
6. Cleanup:  relai_restore_changes / relai_tidy_plan + relai_tidy_run
```

Removed fallback loops are not hidden backdoors. The server should not generate helper scripts, switch to ad-hoc one-liners for repo edits, or route around the public workspace tools.

## Tool selection

Use the smallest tool that fits the job:

| Situation | Use |
| --- | --- |
| Small localized edit inside an existing file | `relai_edit` with `oldText`/`newText` |
| Complete replacement of a file (any size) | `relai_edit` with `content` |
| Multi-file patch-shaped change | `relai_edit` with `updateText` |
| Several edits in one approval | `relai_edit` with `edits: [...]` |
| Prepared file bundle update | `relai_apply_bundle` |
| Session-owned untracked cleanup | `relai_tidy_plan` then `relai_tidy_run` |
| Validation | `relai_run_checks` (level `quick` / `standard` / `release`) |
| Review | `relai_diff` |
| Restore selected changes | `relai_restore_changes` |

`relai_repo_snapshot` and `relai_read` return `writeGuidance` so ChatGPT can choose among `exact-replace`, `direct-write`, `staged-write`, `apply-update`, `apply-bundle`, and `workspace-tidy`.

## Validation check behavior

`relai_run_checks` accepts `check`, `checks`, or `checksText`. These are the preferred public names. Compatibility aliases are still accepted internally for older callers. When no check is provided, it auto-detects sensible validation checks for the workspace.

Validation depth is selected with a simple public `level` preset:

| `level` | Meaning |
| --- | --- |
| `quick` | Syntax / lightweight checks for a fast inner loop. |
| `standard` | Normal project validation. This is the default. |
| `release` | Full release gate (runs the broadest detected test/build set). |

`relai_edit` accepts the same `level` when called with `runChecks: true`, so an edit can validate at any depth in one approval. An internal `validationLevel` describing the change surface is telemetry separate from this public preset; it is stripped from ChatGPT connector results and kept only on the full stdio surface.

## Exact replacement and complete-file write guards

`relai_replace` requires exact current text and optionally an `expectedSha256` from `relai_read`. Ambiguous duplicate matches are refused unless an explicit `occurrence` is provided. This keeps payloads small and deterministic for files like Dart SMS handlers that can trigger connector filtering.

`relai_write` accepts complete file content only. For larger whole-file replacements, use staged chunks (`stage: start`, `append`, then `commit`) so ChatGPT does not have to send one oversized request. If a multiline source file is accidentally collapsed into one long line, the write is rejected instead of damaging formatting.
