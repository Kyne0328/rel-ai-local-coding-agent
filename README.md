# Rel.AI MCP

Maintained by [@Kyne0328](https://github.com/Kyne0328).

Rel.AI MCP is a local ChatGPT repository bridge. It intentionally exposes one reliable workflow for configured local workspaces:

```text
relai_repo_snapshot -> relai_read -> relai_write -> relai_verify -> relai_diff -> relai_reset
```

## MCP tools

| Tool | Purpose |
| --- | --- |
| `relai_repo_snapshot` | Return a filtered project snapshot, manifests, discovered commands, and context hints. |
| `relai_read` | Read focused files or directory summaries. |
| `relai_write` | Replace one complete file with corrected full-file content. This is the only normal edit path. |
| `relai_verify` | Run detected or requested verification commands. |
| `relai_browser` | Run a browser/UI check or fetch a route. |
| `relai_diff` | Review git status and diff. |
| `relai_reset` | Roll back requested local changes. |

Removed workflows are not part of the MCP anymore: unified patch application, generated patch scripts, ad-hoc shell tools, task runners, isolated worktree orchestration, multi-agent schedulers, approval-gated legacy flows, Docker runners, and PR/CI repair loops.


## One-click server and public tunnel

Local only:

```bash
npm run oneclick
```

Start the server and try to create a public HTTPS tunnel automatically:

```bash
npm run oneclick -- --public
```

Provider shortcut after `--public` is also supported:

```bash
npm run oneclick -- --public ngrok
npm run oneclick -- --public cloudflare
npm run oneclick -- --public localtunnel
```

Provider-specific tunnel startup:

```bash
npm run oneclick -- --tunnel cloudflare
npm run oneclick -- --tunnel ngrok
npm run oneclick -- --tunnel localtunnel
```

For other providers, use a custom command that prints its public `https://` URL:

```bash
npm run oneclick -- --tunnel custom --tunnel-command "your-tunnel http://127.0.0.1:3333"
```

Use `--public-url https://your-stable-domain` for a permanent ChatGPT connector. `--public`/quick tunnels are convenient but may rotate URLs.

## Dashboard

The dashboard manages local bridge configuration, workspace settings, fast-task mode, workspace deletion, and connection details. It does not expose alternate edit workflows.

## Fast task mode

Each workspace can define fast-task behavior:

```json
{
  "fastTask": {
    "enabled": true,
    "preferChangedFiles": true,
    "skipIndexForSmallTasks": true,
    "maxIndexFiles": 750,
    "includeRoots": [],
    "excludePaths": [".git", "node_modules", "build", "dist", "coverage"]
  }
}
```

Use `.relaiignore` in a repo to add repo-specific AI-context exclusions.


## Optional ChatGPT app-request auto-approve Chrome extension

Rel.AI MCP includes an optional Chrome extension for ChatGPT web that can auto-click Rel.AI MCP app-request approvals. It is off by default and requires a double opt-in: the dashboard setting plus the extension popup toggle. This can authorize local repo reads, full-file writes, verification commands, browser checks, diffs, or resets without a manual click, so use it only on your own trusted machine and disable it after the task. The older userscript workflow has been removed. See `docs/AUTO_APPROVE_EXTENSION.md`.


## Verify command behavior

`relai_verify` is intentionally unrestricted inside configured workspaces. When `command`, `commands`, or `commandsText` is provided, Rel.AI runs exactly those shell commands. When no command is provided, it auto-detects sensible validation commands.

## Full-file write formatting guard

`relai_write` accepts complete file content only. For large files, use staged full-file write chunks with the same `relai_write` tool (`stage: start`, `append`, then `commit`) so ChatGPT does not have to approve one oversized request. If a multiline source file is accidentally collapsed into one long line, the write is rejected instead of damaging formatting.
