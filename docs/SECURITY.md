# Security

Rel.AI MCP exposes one local repo bridge workflow to ChatGPT:

```text
relai_repo_snapshot -> relai_read -> relai_write -> relai_verify -> relai_diff -> relai_reset
```

There are no MCP patch-script, standalone shell, task-runner, worktree, multi-agent, approval-gate, Docker, or PR/CI repair workflows. Local full-file writes go through `relai_write`; validation goes through `relai_verify`; review goes through `relai_diff`; rollback goes through `relai_reset`.

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect and modify.
