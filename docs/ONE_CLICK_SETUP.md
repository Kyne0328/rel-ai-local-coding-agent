# One-command launch and permanent ChatGPT connector setup

This guide fixes the annoying loop where a temporary ngrok URL changes, forcing you to delete and recreate the ChatGPT app.

Rel.AI MCP can now keep a persistent local token and connection profile. You start it with one command, then point one permanent HTTPS URL at the local server.

## One-command local start

From the project folder:

```bash
npm install
npm run oneclick
```

This command:

- creates `~/.rel-ai-mcp/config.json` if it does not exist
- creates a strong bearer token in `~/.rel-ai-mcp/.env` if one does not exist
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

The ChatGPT MCP endpoint will be:

```text
https://relai.your-domain.com/mcp
```

You should only need to recreate the ChatGPT app if one of these changes:

- public URL
- bearer token
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
MCP URL: https://your-stable-domain/mcp
Authorization: Bearer <REL_AI_MCP_TOKEN>
```

The token is stored locally in:

```text
~/.rel-ai-mcp/.env
```

To rotate the token:

```bash
npm run oneclick -- --reset-token --show-token
```

After token rotation, update the ChatGPT app authentication value.

## Safer first prompt

Use this after connecting the app in ChatGPT:

```text
Use Rel.AI MCP. Show relai_version and relai_config. Do not read project files yet.
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
4. Confirm the ChatGPT MCP URL ends in `/mcp`.
5. Confirm the bearer token in ChatGPT matches `~/.rel-ai-mcp/.env`.
6. Avoid using the dashboard URL as the MCP URL. ChatGPT needs `/mcp`, not `/dashboard`.
