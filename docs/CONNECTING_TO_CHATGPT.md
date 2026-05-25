# Connecting to ChatGPT

Rel.AI MCP exposes a small local-repo bridge to ChatGPT. In normal mode, ChatGPT sees one reliable workflow:

- `relai_repo_snapshot`
- `relai_read`
- `relai_write`
- `relai_replace`
- `relai_clear_files`
- `relai_run_checks`
- `relai_browser`
- `relai_diff`
- `relai_restore_changes`

Use `relai_repo_snapshot` to inspect a configured workspace, `relai_read` to load exact files, `relai_replace` for localized exact edits, `relai_write` for complete file replacement, `relai_clear_files` for obsolete files, `relai_run_checks` to run validation, and `relai_diff` to review the result.

Legacy update, local, command-runner, task-runner, and multi-agent tools are debug/internal tools. They are hidden from normal ChatGPT mode so the connector does not fall back into unreliable generated scripts, Python one-liners, or malformed unified diffs.

## Adding the connector in ChatGPT

Add the connector with **No Authentication**. The MCP URL already contains a secret path segment — no separate auth header is needed.

The MCP URL looks like:

```text
https://your-domain.example/mcp/<secret>
```

Treat `<secret>` like a password: do not share it, and rotate it if exposed. Use `npm run oneclick -- --reset-chatgpt-secret` to rotate.

The dashboard URL (`/dashboard`) is not the MCP URL. ChatGPT needs the `/mcp/<secret>` path, not the dashboard path.

## Tunnel requirement

Use a stable HTTPS tunnel (such as ngrok with a static domain, or a Cloudflare Tunnel with your own domain). Do not expose plain HTTP to the internet. ChatGPT requires HTTPS for connectors.

See [`docs/ONE_CLICK_SETUP.md`](ONE_CLICK_SETUP.md) for tunnel setup options.

Maintained by [@Kyne0328](https://github.com/Kyne0328).
