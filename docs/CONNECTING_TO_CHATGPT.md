# Connecting Rel.AI MCP to ChatGPT Developer Mode

Rel.AI MCP supports local stdio and remote HTTP/SSE transport. ChatGPT Developer Mode needs a reachable HTTPS endpoint, so use the HTTP server plus a tunnel or reverse proxy.

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
https://your-domain.example.com/mcp
```

Auth:

```text
Authorization: Bearer <REL_AI_MCP_TOKEN>
```

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
