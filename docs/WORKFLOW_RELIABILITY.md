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
