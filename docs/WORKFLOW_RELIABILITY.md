# Workflow reliability

The MCP has a conservative workflow by default and an opt-in fast flow for Codex-style editing.

```text
1. Snapshot: relai_repo_snapshot
2. Read:     relai_read
3. Edit:     relai_replace for localized edits, relai_write for whole-file replacement, relai_clear_files for file file clearing
4. Verify:   relai_run_checks
5. Review:   relai_diff
6. Rollback: relai_restore_changes
```

Removed fallback loops are not hidden backdoors. The server should not generate helper scripts, run compressed local checks, or switch to ad-hoc Python/Dart one-liners for repo edits. In fast mode it should use first-class bulk tools instead: `relai_apply_update` for unified diffs and `relai_apply_bundle` for zip overlay.

Use the smallest tool that fits the job. `relai_replace` applies exact text replacements inside an existing file and is the preferred conservative path for large or interpolation-heavy source files. `relai_write` performs complete file replacement only; direct mode is for normal files, and staged chunks are reserved for unavoidable whole-file replacement. `relai_clear_files` removes obsolete files without local checks. In fast mode, use `relai_apply_update` or `relai_apply_bundle` instead of generated runners when a change is broad or zip-like.


## Fast flow mode

Fast mode is opt-in from Settings > General > Workflow mode. It exposes:

```text
relai_apply_update      git apply --check + git apply for unified diffs
relai_apply_bundle    extract local zip and overlay files onto the workspace
relai_package_snapshot export the current workspace to a zip on the MCP host
```

Fast mode is designed for users who commit/stash before asking for changes and want Codex-style speed. It still refuses path traversal, preserves `.git`, skips generated/cache folders, can require a clean git tree, can create a git-stash backup when dirty edits are allowed, runs verification, and returns a diff.

## Verify command behavior

`relai_run_checks` is intentionally unrestricted inside configured workspaces. When `command`, `commands`, or `commandsText` is provided, Rel.AI runs exactly those local checks. When no command is provided, it auto-detects sensible validation commands.

## Exact replacement and full-file write guards

`relai_replace` requires exact current text and optionally an `expectedSha256` from `relai_read`. Ambiguous duplicate matches are refused unless an explicit `occurrence` is provided. This keeps payloads small and deterministic for files like Dart SMS handlers that can trigger connector filtering.

`relai_write` accepts complete file content only. For unavoidable large whole-file replacements, use staged chunks (`stage: start`, `append`, then `commit`) so ChatGPT does not have to approve one oversized request and the server can refuse the risky direct path. If a multiline source file is accidentally collapsed into one long line, the write is rejected instead of damaging formatting.
