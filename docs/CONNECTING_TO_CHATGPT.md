# Connecting Rel.AI MCP to ChatGPT Developer Mode

Rel.AI MCP supports local stdio and remote HTTP/SSE transport. ChatGPT Developer Mode needs a reachable HTTPS endpoint, so use the HTTP server plus a tunnel or reverse proxy.

For the simpler permanent setup, start with [ONE_CLICK_SETUP.md](ONE_CLICK_SETUP.md). The short version is:

```bash
npm run oneclick -- --public-url https://relai.your-domain.com
```

That command keeps a persistent local/API token and prints the stable MCP URL to use in ChatGPT. ChatGPT should use `No Authentication`.

## Start local HTTP server

```bash
REL_AI_MCP_TOKEN="paste-strong-token" \
REL_AI_MCP_CONFIG="$HOME/.rel-ai-mcp/config.json" \
npm run start:http -- --host 127.0.0.1 --port 3333
```

Check locally:

```bash
curl http://127.0.0.1:3333/health
curl -H "Authorization: Bearer $REL_AI_MCP_TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://127.0.0.1:3333/mcp
```

## Expose through HTTPS

Use one of:

- Cloudflare Tunnel
- Tailscale Funnel
- a private VPS reverse proxy
- another HTTPS tunnel you trust

Target:

```text
http://127.0.0.1:3333
```

Recommended endpoint for ChatGPT:

```text
https://your-domain.example.com/mcp/<secret>
```

Auth in ChatGPT:

```text
No Authentication
```

Use the exact `ChatGPT MCP URL` printed by `npm run oneclick -- --public-url ...`. The secret is embedded in the path. In ChatGPT, set authentication to `No Authentication`. The regular `/mcp` endpoint remains available only for non-ChatGPT bearer-token clients.

## First safe test in ChatGPT

```text
Use Rel.AI MCP. Show relai_version, then show relai_config. Do not read files yet.
```

Then test read-only workspace access:

```text
Use Rel.AI MCP on workspace myapp. Show the workspace profile and the first 200 tree entries. Do not modify files.
```

Then test the Codex-like worktree flow on a disposable repo:

```text
Use Rel.AI MCP on workspace sandbox.
Start a task session named "MCP smoke".
Create a task worktree from main.
Read README.md.
Add one harmless line using a patch.
Run the unit test command.
Show git diff and stop before committing.
```

## Recommended production profile

Use this for normal coding:

```json
{
  "permissionProfile": "pr",
  "allowGitHubCli": true,
  "allowDocker": false,
  "allowArbitraryCommands": false,
  "allowDestructiveTools": false
}
```

Temporarily switch to `admin` only for cleanup tools:

```bash
node bin/relai-mcp-config.js set permissionProfile admin
```

Then switch back:

```bash
node bin/relai-mcp-config.js set permissionProfile pr
```

## v0.6 recommended first prompt

After connecting the remote MCP server, start with a read/plan-only task:

```text
Use Rel.AI MCP on workspace myapp. Run relai_task_run in plan_only mode for this task: "Find where authentication refresh is handled and propose the smallest safe fix." Do not edit files yet.
```

Then move to implementation only after reviewing the plan and context:

```text
Use the existing Rel.AI MCP task session. Read the relevant files, propose a unified diff, then call relai_task_run in implement_and_test mode with that patch and the unit test key.
```

For PR workflows, keep approval gates enabled and ask for a session export before cleanup.

## v0.7 multi-agent smoke prompt

After the basic read/write smoke passes, test the multi-agent layer on a disposable repo:

```text
Use Rel.AI MCP on workspace sandbox.
Split the task "add a small helper and validate it" into planner, implementer, tester, and reviewer subtasks.
Run the planner subtask in plan-only mode.
Run the implementer subtask only after the planner completes.
Run conflict check across the parent task.
Run reviewer diff analysis and stop before merge-back.
```

For merge-back, prefer dry-run first:

```text
Use relai_subtask_merge_back with dryRun=true for the implementer subtask. Do not perform a real merge unless I approve it.
```

## v0.8 Windows and line-ending notes

v0.8 includes `.gitattributes` and `.editorconfig` to reduce warnings such as:

```text
warning: in the working copy of 'package.json', LF will be replaced by CRLF the next time Git touches it
```

For repositories you want Rel.AI MCP to work on, add a similar `.gitattributes` file:

```gitattributes
* text=auto
*.js text eol=lf
*.mjs text eol=lf
*.json text eol=lf
*.md text eol=lf
*.sh text eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
```

If you see Windows ESM errors like `ERR_UNSUPPORTED_ESM_URL_SCHEME` with protocol `c:`, the fix is to convert absolute paths before dynamic import:

```js
import { pathToFileURL } from "node:url";
await import(pathToFileURL(absolutePath).href);
```

The v0.8 smoke tests use this pattern.


## v0.9 production UX notes

- Use the dashboard only over localhost, a trusted tunnel, or HTTPS with a strong local/API bearer token.
- `/events` streams dashboard snapshots over SSE and should not be exposed publicly without local/API authentication.
- `relai_cleanup_run`, `relai_doctor_fix`, `relai_state_import`, and original Rel.AI config import are admin-level operations.
- Prefer `relai_cleanup_preview` before deleting generated state files.
- Keep state exports private; they can contain task summaries, diffs, audit entries, and local path metadata.

## v0.10 release-readiness checks

Before exposing the connector, run these MCP tools or dashboard APIs:

- `relai_release_readiness` to score config, approval gates, token setup, state directories, command availability, and workspaces.
- `relai_connector_check` with your printed public `/mcp/<secret>` endpoint to validate URL settings and optionally probe `/health`.
- `relai_workspace_preflight` for each workspace before running real coding tasks.

HTTP equivalents when the server is running:

```text
GET /api/readiness
GET /api/release-manifest
GET /api/workspace/preflight?workspace=myapp
```

For ChatGPT, use `/mcp/<secret>` with `No Authentication`. Keep bearer auth only for non-ChatGPT local/API endpoints exposed through a tunnel.

## Connector-discovery sanity check

If ChatGPT replies that it searched a `rel-ai-mcp` source and found zero results, it probably did not call the MCP tools. Ask it to call the tool names explicitly:

```text
Use Rel.AI MCP tools directly. Call relai_workspace_list, then call relai_workspace_inspect for workspace myapp with maxEntries 200. Do not use file search.
```

If the workspace alias is wrong or missing, `relai_workspace_inspect` returns a non-throwing diagnostic with available aliases and a setup command.

The server also exposes read-only MCP resources for discovery:

- `relai://server/help`
- `relai://server/workspaces`
- `relai://workspace/<alias>/inspect`
- `relai://workspace/<alias>/profile`
- `relai://workspace/<alias>/tree`
