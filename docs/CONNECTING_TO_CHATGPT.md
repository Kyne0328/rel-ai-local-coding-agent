# Connecting Rel.AI MCP to ChatGPT Developer Mode

Rel.AI MCP v0.3 supports three transports:

```text
stdio
streamable HTTP-style JSON-RPC: POST /mcp
SSE compatibility: GET /sse + POST /messages?sessionId=...
```

For ChatGPT Developer Mode, use a remote HTTPS endpoint. The most practical local setup is:

```text
ChatGPT
-> HTTPS tunnel
-> http://127.0.0.1:3333/mcp
-> rel-ai-mcp
-> your local workspace
```

## 1. Start the HTTP server

```bash
REL_AI_MCP_TOKEN="paste-long-random-token" \
REL_AI_MCP_CONFIG="$HOME/.rel-ai-mcp/config.json" \
npm run start:http -- --host 127.0.0.1 --port 3333
```

Health check:

```bash
curl http://127.0.0.1:3333/health
```

Tool list check:

```bash
curl -H "Authorization: Bearer $REL_AI_MCP_TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://127.0.0.1:3333/mcp
```

## 2. Put it behind HTTPS

Use one of:

- Cloudflare Tunnel
- Tailscale Funnel
- ngrok
- a private VPS reverse proxy
- a deployed Node host if your workspace files exist there

The public URL should point to:

```text
https://your-tunnel-or-domain.example.com/mcp
```

## 3. Create the connector in ChatGPT

In ChatGPT Business Developer Mode:

```text
Settings / Workspace Settings
-> Apps & Connectors
-> Create custom connector
-> MCP server URL: https://your-domain.example.com/mcp
-> Auth: Bearer token
-> Token: REL_AI_MCP_TOKEN value
-> Save as draft
-> Test in a chat
```

## 4. First safe prompt

```text
Use Rel.AI MCP. Show relai_version, then list configured workspaces with relai_config. Do not read or modify any project files yet.
```

## 5. First read-only project prompt

```text
Use Rel.AI MCP on workspace myapp. Start a task session named "inspect project". Show the workspace profile and filtered tree. Do not modify files.
```

## 6. First write test on a disposable repo

```text
Use Rel.AI MCP on workspace sandbox.
Start a task session.
Create branch relai/smoke-test.
Append one sentence to README.md using relai_write_file.
Run the unit test command.
Show git diff.
Stop before commit.
```

## 7. Full Codex-like prompt

```text
Use Rel.AI MCP on workspace myapp.
Start a task session for this bug.
Inspect profile/tree, read the smallest files needed, create a feature branch, patch the bug, run unit/lint/typecheck, patch again if tests fail, show final diff, commit, push, and create a draft PR.
Never touch secrets, protected branches, or unrequested files.
```
