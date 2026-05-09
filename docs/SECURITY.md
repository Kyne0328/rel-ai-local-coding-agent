# Security model

Rel.AI MCP is intentionally powerful local developer tooling. In the current ChatGPT local repo bridge model, connecting a workspace is a trust decision: ChatGPT may read safe text files, write deterministic edits, run shell commands, run verification commands, show diffs, and reset changes inside configured workspaces.

## Current product model

The normal public surface is the 8-tool local repo bridge:

- `relai_repo_snapshot`
- `relai_read`
- `relai_write`
- `relai_shell`
- `relai_verify`
- `relai_browser`
- `relai_diff`
- `relai_reset`

Legacy workflow, task-session, worktree, approval, PR, scheduler, and multi-agent tools may still exist in code for compatibility/debug use. They are not the normal ChatGPT product flow and should not be suggested by workspace inspection or default smoke tests.

## Trust boundary

Trusted local mode means ChatGPT has full local power inside configured workspaces. Treat a configured workspace like giving a coding assistant access to that repo on your machine.

Rel.AI still enforces important local boundaries:

- Workspaces are explicit aliases in `~/.rel-ai-mcp/config.json`.
- Paths are resolved relative to configured workspace roots.
- Path traversal outside the workspace is rejected.
- Secret-looking paths are blocked by the safety layer.
- Binary-looking files are skipped by read helpers.
- Text writes are size-limited and use deterministic operations.
- Git diff review and reset tooling are available after edits.

These boundaries reduce accidental scope creep; they do not make an untrusted workspace or untrusted prompt safe.

## Commands and shell access

`relai_shell` and `relai_verify` run local commands in the configured workspace. In trusted local mode, arbitrary local shell execution is part of the product design so ChatGPT can behave like a local coding assistant.

Use this only for repositories you trust ChatGPT to inspect and modify. Do not expose the HTTP server publicly without a strong secret URL and transport protections.

## Connector and HTTP transport

For ChatGPT Developer Mode, use the generated `/mcp/<secret>` URL and choose **No Authentication** in ChatGPT. The secret is embedded in the path.

Keep the dashboard and API on localhost, a trusted tunnel, or HTTPS. Do not expose a plain unauthenticated HTTP/SSE server through a public tunnel.

## Legacy guarded mode

Older documentation and code may mention permission profiles, approval gates, worktrees, PR workflows, and multi-agent orchestration. Those are legacy/debug capabilities. If you deliberately switch into a guarded or debug workflow, keep gates enabled for high-risk operations such as push, PR creation, merge, reset, destructive cleanup, and worktree removal.

In the default public bridge flow, the safer operating pattern is:

```text
relai_repo_snapshot
-> relai_read
-> relai_write
-> relai_verify or relai_shell
-> relai_diff
-> relai_reset if needed
```

## Recommended operating practices

- Add only the workspace aliases you actually want ChatGPT to access.
- Review `relai_diff` before committing important changes.
- Keep secrets out of repositories and out of prompts.
- Prefer `relai_write` over hand-written unified diffs for deterministic edits.
- Use `relai_reset` or Git to roll back unwanted local changes.
- Run `npm test` before release; it includes the public bridge workflow smoke test.
