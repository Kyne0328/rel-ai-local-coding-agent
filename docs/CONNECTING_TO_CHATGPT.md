# Connecting to ChatGPT

Rel.AI MCP exposes one 16-tool workspace surface across local MCP and the ChatGPT connector:

- `relai_repo_snapshot`
- `relai_read`
- `relai_write`
- `relai_replace`
- `relai_tidy_plan`
- `relai_tidy_run`
- `relai_run_checks`
- `relai_browser`
- `relai_diff`
- `relai_restore_changes`
- `relai_status`
- `relai_git_status`
- `relai_git_commit`
- `relai_git_push`
- `relai_git_create_pr`
- `relai_edit`

Use `relai_repo_snapshot` for repository context, `relai_read` for focused content, and `relai_edit` as the primary change tool. It supports exact replacement, complete-file content, structured patch updates, and batches, with optional validation and diff review in the same call. `relai_write` and `relai_replace` remain direct fallback tools.

Tracked-file deletion is handled through a structured `Delete File` patch sent to `relai_edit`. Session-owned untracked artifacts are removed only through `relai_tidy_plan` followed by `relai_tidy_run`.

## Starting the server

```bash
npm run oneclick                                              # local dashboard and development
npm run oneclick -- --public                                  # temporary public connector
npm run oneclick -- --public-url https://your-domain.example  # permanent public connector
```

ChatGPT requires a public HTTPS endpoint. Use `--public` for a temporary tunnel or `--public-url` for a stable endpoint. See [ONE_CLICK_SETUP.md](ONE_CLICK_SETUP.md) for tunnel options.

The packaged desktop app opens the dashboard in a secured Electron window by default. The same local `/dashboard` route remains accessible in a normal browser when needed; both hosts use the same dashboard code and server APIs. Electron uses a single-use bootstrap exchange and an HttpOnly local session cookie instead of exposing the permanent dashboard token to the embedded renderer.

Use **Tasks** for grouped ChatGPT work and **Activity log** for individual tool calls. Rel.AI keeps each task open for 60 seconds after its latest tool call, renewing the window when ChatGPT continues, so ordinary approval and reasoning gaps stay grouped. Separate MCP sessions can run as concurrent tasks. The workspace selector scopes Overview, Tasks, Workspaces, Activity, and Diagnostics to one configured repository.

## Adding the connector in ChatGPT

1. Start Rel.AI MCP and open the dashboard in the desktop app or through the local browser route.
2. Copy the MCP URL ending in `/mcp`.
3. In ChatGPT, open **Settings > Apps > Create**.
4. Add the MCP URL and select **OAuth** authentication.
5. When the Rel.AI authorization page opens, enter the dashboard token from `REL_AI_MCP_TOKEN`.

Example MCP URL:

```text
https://your-domain.example/mcp
```

ChatGPT discovers the OAuth endpoints through `/.well-known/oauth-protected-resource`. Opening `/mcp` in a browser displays only a diagnostic; the dashboard URL is not the MCP endpoint.

## Tunnel requirement

Use a stable HTTPS tunnel such as ngrok with a static domain or Cloudflare Tunnel with your own domain. Do not expose plain HTTP to the public internet.

Maintained by [@Kyne0328](https://github.com/Kyne0328).
