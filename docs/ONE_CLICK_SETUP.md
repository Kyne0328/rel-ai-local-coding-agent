# One-command launch and permanent ChatGPT connector setup

This guide fixes the annoying loop where a temporary ngrok URL changes, forcing you to delete and recreate the ChatGPT app.

Rel.AI MCP can now keep a persistent local/API token and connection profile. You start it with one command, then point one permanent HTTPS URL at the local server.

## One-command local start

From the project folder:

```bash
npm install
npm run oneclick
```

This command:

- creates `~/.rel-ai-mcp/config.json` if it does not exist
- creates a strong local/API bearer token in `~/.rel-ai-mcp/.env` if one does not exist
- stores connection details in `~/.rel-ai-mcp/connection.json`
- starts the MCP HTTP server on `http://127.0.0.1:3333`
- prints the local dashboard URL and ChatGPT MCP endpoint

To print the saved connector settings again:

```bash
npm run connector:print
```

On macOS/Linux you can also run:

```bash
./scripts/relai-start.sh
```

On Windows:

```cmd
scripts\relai-start.cmd
```

## Permanent URL rule

ChatGPT Developer Mode needs a reachable HTTPS endpoint. A random temporary tunnel URL is not permanent. If the URL changes, ChatGPT sees it as a different connector target.

Use one stable public URL and keep routing it to:

```text
http://127.0.0.1:3333
```

Then launch Rel.AI MCP with that same public URL:

```bash
npm run oneclick -- --public-url https://relai.your-domain.com
```

The ChatGPT MCP endpoint will be printed as `COPY THIS FOR CHATGPT` and will look like:

```text
https://relai.your-domain.com/mcp/<secret>
```

You should only need to recreate the ChatGPT app if one of these changes:

- public URL
- ChatGPT MCP URL secret
- ChatGPT app settings

## Recommended permanent tunnel options

### Option A: Cloudflare Tunnel with a domain

Best for a stable public connector URL.

```bash
cloudflared tunnel login
cloudflared tunnel create rel-ai-mcp
cloudflared tunnel route dns rel-ai-mcp relai.your-domain.com
```

Create a Cloudflare config similar to:

```yaml
tunnel: rel-ai-mcp
credentials-file: /Users/you/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: relai.your-domain.com
    service: http://127.0.0.1:3333
  - service: http_status:404
```

A template is included at:

```text
examples/cloudflared-config.example.yml
```

Run the tunnel:

```bash
cloudflared tunnel run rel-ai-mcp
```

Then start Rel.AI MCP:

```bash
npm run oneclick -- --public-url https://relai.your-domain.com
```

For a more permanent machine setup, install `cloudflared` as a service using the Cloudflare instructions for your operating system.

### Option B: Tailscale Funnel

Use this if your Tailscale setup supports Funnel and gives you a stable public HTTPS hostname.

```bash
tailscale funnel 3333
npm run oneclick -- --public-url https://your-machine.your-tailnet.ts.net
```

### Option C: ngrok static or reserved domain

Use this if your ngrok account supports a static domain.

```bash
ngrok http --domain=your-static-domain.ngrok.app 3333
npm run oneclick -- --public-url https://your-static-domain.ngrok.app
```

Do not use random temporary ngrok URLs for a permanent ChatGPT app. They solve testing, not long-term setup.

## ChatGPT app setup

After `npm run oneclick -- --public-url ...`, use the printed values:

```text
MCP URL: https://your-stable-domain/mcp/<secret>
Authentication: No Authentication
```

The ChatGPT URL secret is stored locally in:

```text
~/.rel-ai-mcp/chatgpt-secret
```

To rotate the ChatGPT MCP URL secret:

```bash
npm run oneclick -- --reset-chatgpt-secret --show-token
```

After secret rotation, update the ChatGPT app URL and keep ChatGPT authentication set to `No Authentication`. The local/API bearer token is still stored in `~/.rel-ai-mcp/.env`, but it is not the ChatGPT app authentication mode.

## Safer first prompt

Use this after connecting the app in ChatGPT:

```text
Use Rel.AI MCP. Call relai_repo_snapshot for the configured workspace. Do not modify files yet.
```

Then test a workspace read:

```text
Use Rel.AI MCP on workspace myapp. Show the workspace profile and the first 100 tree entries. Do not modify files.
```

## Troubleshooting

If ChatGPT cannot connect:

1. Open the local dashboard printed by `npm run oneclick`.
2. Check `http://127.0.0.1:3333/health` locally.
3. Check that your tunnel points to `http://127.0.0.1:3333`.
4. Confirm the ChatGPT MCP URL looks like `/mcp/<secret>`, not plain `/mcp`.
5. Confirm the ChatGPT app authentication is exactly `No Authentication`.
6. Avoid using the dashboard URL as the MCP URL. ChatGPT needs `/mcp/<secret>`, not `/dashboard`.
7. Do not judge the connector by opening plain `/mcp` in a browser. MCP uses `POST`; browser `GET` is only a diagnostic.

## If ChatGPT says it cannot find the workspace/tools

That usually means ChatGPT searched connector files instead of calling the MCP tools, or the workspace alias is not configured.

Use this exact diagnostic prompt:

```text
Use the Rel.AI MCP connector tools directly.
Call relai_repo_snapshot with workspace "jjclover" and maxEntries 200.
Do not use file search. Do not modify files.
If ChatGPT still shows removed tools such as relai_workspace_list, relai_read_files, relai_run_command, or relai_apply_patch, restart/reconnect the MCP server and refresh the connector.
```

Expected result:

- `relai_repo_snapshot` returns the project profile, filtered tree, discovered commands, and workspace context.
- If `jjclover` is not configured, the response shows a workspace resolution error; add the alias locally and restart the MCP server.

Add a missing workspace alias with:

```bash
npm run workspace:add -- jjclover /absolute/path/to/jjclover
```

Restart `npm run oneclick` after editing workspace config.

Rel.AI MCP now also exposes MCP resources:

```text
relai://server/help
relai://server/workspaces
relai://workspace/<alias>/inspect
relai://workspace/<alias>/profile
relai://workspace/<alias>/tree
```

These resources make the connector easier for ChatGPT to discover, but tools are still the preferred path for app actions.
