# Rel.AI MCP

Rel.AI MCP is a Codex-like coding runner for ChatGPT. It exposes safe repo/workspace tools over MCP so ChatGPT can inspect a project, apply patches, run allowlisted tests, inspect failures, patch again, commit, push, and create a draft PR.

This repo is the MCP replacement for the original Rel.AI browser-extension flow.

```text
ChatGPT
-> MCP tool: inspect workspace
-> MCP tool: read/search files
-> MCP tool: create feature branch
-> MCP tool: apply validated patch
-> MCP tool: run allowlisted tests
-> MCP tool: inspect output and patch again
-> MCP tool: commit, push, and create a draft PR
```

## Version

Current version: `0.2.0`

## What v0.2 adds

- Local stdio MCP server.
- Remote HTTP JSON-RPC endpoint: `POST /mcp`.
- SSE compatibility endpoint: `GET /sse` plus `POST /messages?sessionId=...`.
- Bearer-token authentication for remote transport.
- Health endpoint: `GET /health`.
- HTTP smoke test.
- No external npm dependencies.

## What is intentionally not included

- No arbitrary shell-command tool.
- No full-disk access.
- No delete-file tool.
- No deploy tool.
- No force-push tool.
- No auto-merge tool.
- No secret-file reads.
- No direct commits to protected branches.

## Requirements

- Node.js 18+
- Git available on `PATH`
- Optional: GitHub CLI `gh`, only if you enable PR creation

## Install

```bash
npm install
npm run check
npm run test:smoke
npm run test:http
```

There are no runtime npm dependencies yet. `npm install` is mainly useful if you want a lockfile.

## Initialize config

```bash
npm run init-config
```

Default config path:

```text
~/.rel-ai-mcp/config.json
```

Add a workspace:

```bash
npm run workspace:add -- myapp /absolute/path/to/project
```

Add allowlisted test commands:

```bash
npm run testcmd:add -- myapp unit "npm test"
npm run testcmd:add -- myapp lint "npm run lint"
npm run testcmd:add -- myapp typecheck "npm run typecheck"
```

Example config:

```json
{
  "version": 1,
  "allowGitHubCli": false,
  "workspaces": {
    "myapp": {
      "path": "/absolute/path/to/myapp",
      "protectedBranches": ["main", "master"],
      "testCommands": {
        "unit": "npm test",
        "lint": "npm run lint"
      }
    }
  }
}
```

## Run as local stdio MCP server

Use this for local MCP clients that support stdio:

```bash
node /absolute/path/to/rel-ai-mcp/bin/rel-ai-mcp.js
```

Example local MCP config:

```json
{
  "mcpServers": {
    "rel-ai-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/rel-ai-mcp/bin/rel-ai-mcp.js"],
      "env": {
        "REL_AI_MCP_CONFIG": "/absolute/path/to/config.json"
      }
    }
  }
}
```

## Run as remote HTTP/SSE MCP server

Use this for ChatGPT Developer Mode or any MCP client that needs a remote endpoint.

Generate a strong token:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start the server:

```bash
REL_AI_MCP_TOKEN="paste-token-here" \
REL_AI_MCP_CONFIG="$HOME/.rel-ai-mcp/config.json" \
npm run start:http -- --host 127.0.0.1 --port 3333
```

Endpoints:

```text
GET  /health
POST /mcp
GET  /sse
POST /messages?sessionId=...
```

Remote requests must include:

```text
Authorization: Bearer <REL_AI_MCP_TOKEN>
```

For local-only testing without auth:

```bash
REL_AI_MCP_ALLOW_NO_AUTH=1 npm run start:http -- --host 127.0.0.1 --port 3333
```

Do not expose an unauthenticated server through a tunnel.

## Expose to ChatGPT Developer Mode

ChatGPT needs a reachable HTTPS URL. For local testing, put the HTTP server behind a tunnel:

```text
ChatGPT
-> HTTPS tunnel
-> http://127.0.0.1:3333
-> rel-ai-mcp
-> your configured workspace
```

Examples:

- Cloudflare Tunnel
- Tailscale Funnel
- a private VPS reverse proxy
- Railway/Fly.io/Render if your workspaces are available there

Use `POST /mcp` as the primary endpoint when the connector asks for a streamable HTTP MCP endpoint. Use `GET /sse` only for clients that specifically expect SSE.

See [`docs/CONNECTING_TO_CHATGPT.md`](docs/CONNECTING_TO_CHATGPT.md).

## Available tools

### `relai_config`

Returns config path, limits, configured workspace aliases, and test command keys.

### `relai_workspace_tree`

Returns a safe filtered workspace tree.

```json
{ "workspace": "myapp", "maxEntries": 1500 }
```

### `relai_read_files`

Reads specific text files.

```json
{ "workspace": "myapp", "paths": ["package.json", "src/index.ts"] }
```

### `relai_search`

Literal text search across safe text files.

```json
{ "workspace": "myapp", "query": "refreshToken", "maxMatches": 50 }
```

### `relai_apply_patch`

Checks or applies a unified diff.

```json
{ "workspace": "myapp", "diff": "diff --git ...", "dryRun": true }
```

Use `dryRun: true` before real application.

### `relai_run_test`

Runs a locally configured test command.

```json
{ "workspace": "myapp", "testCommandKey": "unit" }
```

### `relai_git_status`

Returns branch and short status.

```json
{ "workspace": "myapp" }
```

### `relai_git_diff`

Returns unstaged or staged diff.

```json
{ "workspace": "myapp", "staged": false }
```

### `relai_create_branch`

Creates and switches to a feature branch.

```json
{ "workspace": "myapp", "branchName": "relai/fix-auth-refresh" }
```

### `relai_commit_all`

Stages and commits all changes. Refuses protected branches.

```json
{ "workspace": "myapp", "message": "Fix auth refresh handling" }
```

### `relai_push_branch`

Pushes current or named feature branch.

```json
{ "workspace": "myapp", "remote": "origin" }
```

### `relai_create_pr`

Creates a draft PR through GitHub CLI. Disabled unless `allowGitHubCli` is `true`.

```json
{
  "workspace": "myapp",
  "title": "Fix auth refresh handling",
  "body": "Summary and validation notes.",
  "base": "main",
  "draft": true
}
```

## Recommended agent loop

```text
1. relai_git_status
2. relai_workspace_tree
3. relai_search / relai_read_files
4. relai_create_branch
5. relai_apply_patch with dryRun true
6. relai_apply_patch with dryRun false
7. relai_run_test
8. relai_read_files / relai_apply_patch again if tests fail
9. relai_git_diff
10. relai_commit_all
11. relai_push_branch
12. relai_create_pr or use ChatGPT's GitHub connector to open the PR
```

## Smoke tests

```bash
npm run check
npm run test:smoke
npm run test:http
```

`test:smoke` verifies stdio MCP. `test:http` verifies HTTP auth, initialize, tools/list, and tool calling.

## Next version ideas

- Audit log under `.relai-mcp/`.
- Optional direct file write tool with strict previews.
- GitHub API integration without requiring `gh`.
- OpenCode fallback integration.
- Test-failure extraction/summarization.
- Workspace-level tool permission toggles.
- Docker sandbox mode for untrusted repos.
