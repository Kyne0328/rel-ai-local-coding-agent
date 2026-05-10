# Workflow reliability

The MCP has one normal workflow:

```text
1. Snapshot: relai_repo_snapshot
2. Read:     relai_read
3. Write:    relai_write with complete file content only
4. Verify:   relai_verify
5. Review:   relai_diff
6. Rollback: relai_reset
```

Removed workflows are not hidden fallbacks; they are removed from the MCP package. The server should not retry malformed unified diffs, generate patch scripts, run compressed shell commands, or switch to ad-hoc Python one-liners for repo edits.

`relai_write` supports only full-file writes with `{ workspace, path, content }`. It does not support edit arrays, find/replace payloads, unified patches, generated scripts, or Python one-liners.


## Verify command behavior

`relai_verify` is intentionally unrestricted inside configured workspaces. When `command`, `commands`, or `commandsText` is provided, Rel.AI runs exactly those shell commands. When no command is provided, it auto-detects sensible validation commands.

## Full-file write formatting guard

`relai_write` accepts only complete file content. If a multiline source file is accidentally collapsed into one long line, the write is rejected instead of damaging formatting.
