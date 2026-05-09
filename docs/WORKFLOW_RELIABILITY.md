# Workflow reliability

Rel.AI MCP's ChatGPT-local workflow is intentionally structured around deterministic tools rather than ad-hoc shell mutation.

## Canonical edit path

Use this sequence for long coding sessions:

1. `relai_repo_snapshot` to inspect the workspace and recent operation journal.
2. `relai_read` to read exact files with SHA-256 hashes.
3. `relai_write` for structured edits.
4. `relai_verify` for configured or auto-detected validation.
5. `relai_diff` for review.
6. `relai_reset` only for explicit rollback.

Avoid using `relai_shell`, `relai_run_command`, or Python one-liners for file edits. Shell remains available in trusted-local mode, but structured writes are more stable and less likely to trigger ChatGPT connector command-blocking.

## Write guarantees

Text writes are now atomic and verified:

- validate the path inside the workspace
- check the previous SHA-256 when provided
- write to a temporary file
- verify the temporary file hash
- rename into place
- reread the final file
- return success only when the final SHA-256 matches the intended content

If any step fails, the tool returns an error instead of a false success.

## Operation journal

Mutating structured writes append an operation record under:

```text
<stateDir>/operation-journal/<workspace>.jsonl
```

`relai_repo_snapshot` and `relai_workspace_inspect` include recent journal entries so an interrupted ChatGPT session can resume by checking what actually landed before continuing.

## About ChatGPT command blocking

Rel.AI MCP cannot disable platform-level ChatGPT safety checks. The mitigation is to avoid routing normal repo edits through arbitrary command execution. Prefer `relai_write` and `relai_verify`; reserve shell commands for cases where a structured tool cannot express the operation.
