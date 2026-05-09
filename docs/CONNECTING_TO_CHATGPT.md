# Connecting Rel.AI MCP to ChatGPT

Rel.AI MCP currently presents ChatGPT with a trusted local repo bridge. The public ChatGPT workflow uses 8 tools:

- `relai_repo_snapshot`
- `relai_read`
- `relai_write`
- `relai_shell`
- `relai_verify`
- `relai_browser`
- `relai_diff`
- `relai_reset`

Older task-session, worktree, approval, PR, scheduler, and multi-agent tools are legacy/debug compatibility tools. They may remain callable for cached connector schemas, but they are not the normal product flow.

## Start the local server

```bash
npm install
npm run oneclick
```

The launcher prints:

- a local dashboard URL
- a ChatGPT MCP URL using `/mcp/<secret>`
- connector setup details

## Add the connector in ChatGPT

Use the printed `/mcp/<secret>` endpoint. In ChatGPT, choose **No Authentication**. The secret is already part of the URL.

Do not use a plain `/mcp` URL unless you are testing locally and understand the authentication behavior.

## First test prompt

```text
Use Rel.AI MCP tools directly. Call relai_repo_snapshot for workspace myapp. Do not modify files.
```

Then test reading:

```text
Use Rel.AI MCP on workspace myapp. Read README.md with relai_read. Do not modify files.
```

Then test a full disposable workflow:

```text
Use Rel.AI MCP on workspace sandbox.
Call relai_repo_snapshot.
Read README.md.
Use relai_write with dryRun=true to add one harmless line.
Use relai_write to apply it.
Run relai_verify.
Show relai_diff.
Use relai_reset on README.md.
```

## Recommended ChatGPT workflow

For normal coding requests, ask ChatGPT to use this order:

```text
inspect -> read -> write -> verify -> diff
```

Concrete tools:

```text
relai_repo_snapshot -> relai_read -> relai_write -> relai_verify -> relai_diff
```

Use `relai_shell` only when a specific command is needed. Use `relai_reset` to roll back local edits.

## Workspace inspection suggestions

`relai_workspace_inspect` should suggest only public bridge tools:

```text
relai_repo_snapshot
relai_read
relai_write
relai_verify
relai_diff
relai_reset
```

If it suggests legacy names such as `relai_task_start`, `relai_write_file`, or `relai_context_pack`, the connector or server is stale and should be updated/restarted.

## Validation before release

Run:

```bash
npm run check
npm run test:public-workflow
npm test
```

`npm test` includes syntax checks, smoke tests, hidden compatibility checks, loose patch checks, and the public bridge workflow smoke test.

## Security reminder

Trusted local mode is a single trust decision. ChatGPT may read, write, run shell commands, verify, diff, and reset within configured workspaces. Add only repositories you are comfortable letting ChatGPT operate on, and review diffs before committing.
