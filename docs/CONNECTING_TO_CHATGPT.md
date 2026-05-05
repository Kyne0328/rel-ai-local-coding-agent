# Connecting Rel.AI MCP to ChatGPT Developer Mode

Rel.AI MCP v0.2 exposes both:

```text
POST /mcp
GET  /sse
POST /messages?sessionId=...
```

Use `POST /mcp` as the primary endpoint for streamable HTTP clients. Use `/sse` only for clients that specifically request SSE.

## 1. Start local server

Generate a token:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start Rel.AI MCP:

```bash
REL_AI_MCP_TOKEN="paste-token-here" \
REL_AI_MCP_CONFIG="$HOME/.rel-ai-mcp/config.json" \
npm run start:http -- --host 127.0.0.1 --port 3333
```

Verify locally:

```bash
curl http://127.0.0.1:3333/health
```

Verify authenticated MCP:

```bash
curl -s http://127.0.0.1:3333/mcp \
  -H "authorization: Bearer paste-token-here" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## 2. Put it behind HTTPS

ChatGPT needs a reachable HTTPS endpoint. For a local machine, use a tunnel or reverse proxy:

```text
ChatGPT -> HTTPS tunnel -> 127.0.0.1:3333 -> rel-ai-mcp
```

Common options:

- Cloudflare Tunnel
- Tailscale Funnel
- ngrok for quick testing
- a VPS reverse proxy

Do not expose the server without `REL_AI_MCP_TOKEN`.

## 3. Create the connector

In ChatGPT Business Developer Mode, create a custom connector using your HTTPS endpoint.

Suggested settings:

```text
Name: Rel.AI MCP
Description: Safe local coding runner for workspace reads, patches, tests, git, and PR creation.
MCP endpoint: https://your-domain.example.com/mcp
Authentication: Bearer token
Token: the value of REL_AI_MCP_TOKEN
```

If the UI specifically asks for an SSE URL, use:

```text
https://your-domain.example.com/sse
```

## 4. First test prompt

Use a read-only prompt first:

```text
Use Rel.AI MCP. List my configured workspaces, then show the file tree for workspace myapp. Do not modify files.
```

Then use a disposable repo for the first write test:

```text
Use Rel.AI MCP on workspace sandbox. Create a new feature branch, add a short line to README.md, show the diff, run the unit test, and stop before committing.
```

## 5. Safe production workflow

Use this pattern for real work:

```text
1. Inspect status/tree/files.
2. Create a feature branch.
3. Dry-run patch.
4. Apply patch.
5. Run tests.
6. Patch again if needed.
7. Show final diff.
8. Commit.
9. Push branch.
10. Create draft PR.
```

Never give the server direct deployment or force-push tools.
