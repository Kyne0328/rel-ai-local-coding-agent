# Rel.AI MCP

Rel.AI MCP is a local repo bridge for ChatGPT. It makes a configured local repository feel like an uploaded zip, but with local shell execution, persistent workspace access, verification commands, diffs, and reset support.

The current product model is intentionally simple: ChatGPT connects to your local server and uses a small set of bridge tools to inspect, edit, verify, and review your real local projects.

## What ChatGPT can do

Rel.AI exposes eight public bridge tools:

| Tool | Purpose |
| --- | --- |
| `relai_repo_snapshot` | Summarize a workspace like a zip upload: tree, manifests, scripts, git status, and detected commands. |
| `relai_read` | Batch-read safe text files from a configured workspace. |
| `relai_write` | Apply deterministic structured edits without fragile hand-written diffs. |
| `relai_shell` | Run local shell commands inside a configured workspace. |
| `relai_verify` | Run detected validation commands such as `npm run check`, `flutter analyze`, or `flutter test`. |
| `relai_browser` | Browser/UI check bridge for dashboard and app validation workflows. |
| `relai_diff` | Show the resulting git diff for review. |
| `relai_reset` | Roll back workspace changes when needed. |

Some older tool names are kept as hidden compatibility aliases so cached ChatGPT connector calls do not dead-end, but they are not advertised as the public interface.

## Why this exists

Uploading a repo zip to ChatGPT is often reliable because ChatGPT can inspect and modify files directly. Rel.AI keeps that workflow but removes repeated zipping:

```text
ChatGPT inspects the local repo
ChatGPT reads relevant files
ChatGPT writes deterministic edits
ChatGPT runs local checks
ChatGPT shows the final diff
```

Your code stays on your machine. Rel.AI runs on localhost or behind your own tunnel.

## Quick start

Requires Node.js 18 or newer.

```bash
npm install
npm run oneclick
```

The launcher prints:

- a local dashboard URL
- a ChatGPT MCP URL using `/mcp/<secret>`
- the connector token/secret information needed for setup

For ChatGPT Developer Mode, use the printed MCP URL and choose **No Authentication**. The secret is already in the path.

## Dashboard

The dashboard is for managing the local bridge:

- **Home**: current status and recent activity
- **Workspaces**: add, rename, inspect, preflight, and save detected validation commands
- **Activity**: audit log of bridge calls
- **Tools**: the eight public ChatGPT tools and descriptions
- **Settings**: local bridge settings, connector instructions, and diagnostics

Workspaces can be added directly from the dashboard. Detected commands such as `dart:analyze`, `flutter:test`, and `npm:check` can be saved as validation commands.

## Configuration shape

A minimal config looks like this:

```json
{
  "toolMode": "chatgpt_local_repo",
  "trustedLocalAgent": true,
  "dashboardEnabled": true,
  "maxOutputBytes": 2097152,
  "workspaces": {
    "myapp": {
      "path": "C:\\Dev\\myapp",
      "protectedBranches": ["main", "master"]
    }
  }
}
```

Trusted local mode is a single trust decision. It enables local read/write/shell/reset behavior inside configured workspaces so ChatGPT can work like a local coding assistant. Workspace path boundaries are still enforced.

## Validation commands

Rel.AI detects common project commands from manifests:

- `package.json` scripts, for example `npm:check`
- Flutter/Dart projects, for example `flutter:analyze`, `flutter:test`, `dart:analyze`
- Go, Rust, Makefile, and Python conventions

Use the dashboard **Save detected tests** button to persist detected validation commands, or let `relai_verify` run detected commands automatically.

## Useful commands

```bash
npm run oneclick        # launch local server and print connector URLs
npm run start:http      # start HTTP/dashboard server directly
npm run connector:print # print saved connector settings
npm run check           # syntax-check server/dashboard code
npm run test:smoke      # verify the public 8-tool bridge
npm run test:compat     # verify hidden legacy compatibility aliases
```

## Project structure

```text
bin/        CLI entrypoints
src/        MCP server, local repo bridge, dashboard, config, shell, git, and compatibility helpers
public/     dashboard entrypoint and CSS
test/       smoke and compatibility tests
examples/   example config and connector files
```

## Notes

Rel.AI is local developer tooling. Review diffs before committing important changes, keep workspaces scoped to repositories you trust ChatGPT to edit, and use `relai_reset` or git to roll back unwanted changes.
