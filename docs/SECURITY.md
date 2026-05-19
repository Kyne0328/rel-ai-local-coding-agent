# Security

Rel.AI MCP exposes a local repo bridge to ChatGPT with two workflow modes: conservative and fast.

```text
conservative: relai_repo_snapshot -> relai_read -> relai_replace/relai_write/relai_clear_files -> relai_run_checks -> relai_diff -> relai_restore_changes
fast:   relai_apply_update / relai_apply_bundle / relai_package_snapshot are also available
```

There are no generated helper-script, standalone local fallback, task-runner, multi-agent, approval-gate, Docker, or PR/CI repair workflows. Local exact replacements go through `relai_replace`; full-file writes go through `relai_write`; file clearing go through `relai_clear_files`; validation goes through `relai_run_checks`; review goes through `relai_diff`; rollback goes through `relai_restore_changes`. Fast mode intentionally adds `relai_apply_update` and `relai_apply_bundle` for fast live workspace mutation, guarded by workspace path checks, `.git` preservation, optional clean-git requirements, backup behavior, verification, and diff output.

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect and modify.
