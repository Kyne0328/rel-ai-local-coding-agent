# Security

Rel.AI MCP exposes a local repo bridge to ChatGPT with two workflow modes: conservative and aggressive.

```text
conservative: relai_repo_snapshot -> relai_read -> relai_replace/relai_write/relai_delete -> relai_verify -> relai_diff -> relai_reset
aggressive:   relai_apply_patch / relai_apply_archive / relai_snapshot_archive are also available
```

There are no generated helper-script, standalone shell fallback, task-runner, multi-agent, approval-gate, Docker, or PR/CI repair workflows. Local exact replacements go through `relai_replace`; full-file writes go through `relai_write`; deletions go through `relai_delete`; validation goes through `relai_verify`; review goes through `relai_diff`; rollback goes through `relai_reset`. Aggressive mode intentionally adds `relai_apply_patch` and `relai_apply_archive` for fast live workspace mutation, guarded by workspace path checks, `.git` preservation, optional clean-git requirements, backup behavior, verification, and diff output.

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect and modify.
