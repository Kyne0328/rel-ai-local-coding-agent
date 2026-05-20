# Security

Rel.AI MCP exposes one peer-level workspace-tool surface to ChatGPT. Tool choice is based on task shape and file size.

```text
inspect:  relai_repo_snapshot -> relai_read
change:   relai_replace / relai_write / relai_apply_update / relai_apply_bundle / relai_clear_files
validate: relai_run_checks
review:   relai_diff
restore:  relai_restore_changes
```

There are no generated helper-script, standalone local fallback, task-runner, multi-agent, approval-gate, Docker, or PR/CI repair workflows. Exact replacements go through `relai_replace`; complete-file writes go through `relai_write`; prepared text updates go through `relai_apply_update`; prepared file bundles go through `relai_apply_bundle`; file clearing goes through `relai_clear_files`; validation goes through `relai_run_checks`; review goes through `relai_diff`; restore goes through `relai_restore_changes`.

Prepared update and bundle tools remain guarded by workspace path checks, `.git` preservation, optional clean-git requirements, backup behavior, validation, and diff output.

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect and modify.
