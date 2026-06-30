# Connecting to ChatGPT

Rel.AI MCP exposes a small local-repo bridge to ChatGPT. On the public connector surface, ChatGPT sees these 18 workspace tools:

- `relai_repo_snapshot`
- `relai_read`
- `relai_status`
- `relai_diff`
- `relai_edit`
- `relai_write`
- `relai_replace`
- `relai_tidy_plan`
- `relai_tidy_run`
- `relai_apply_bundle`
- `relai_package_snapshot`
- `relai_run_checks`
- `relai_browser`
- `relai_restore_changes`
- `relai_git_status`
- `relai_git_commit`
- `relai_git_push`
- `relai_git_create_pr`

Use `relai_repo_snapshot` to inspect a configured workspace, `relai_read` to load exact files, and `relai_edit` for changes — it routes exact replacements, full-file writes, unified-diff updates, and batches automatically, with optional `runChecks`/`returnDiff` in the same call. `relai_write` and `relai_replace` remain as direct fallbacks. Use `relai_tidy_plan` then `relai_tidy_run` for cleanup, `relai_run_checks` for validation, `relai_diff` for review, and the `relai_git_*` tools for commit/push/PR flows.

Internal helper tools (`relai_apply_update`, `relai_feature_probe`, `relai_git_fetch`, merge planning/abort, `relai_remove_file`, `relai_refactor_audit`, `relai_set_policy`, `relai_session_summary`) are intentionally not part of the public connector surface — fewer tools means less connector-classifier scrutiny. They remain callable on local stdio sessions.

## Starting the server

Three commands cover every case:

```bash
npm run oneclick                                              # local dashboard / dev (no public URL)
npm run oneclick -- --public                                  # temporary ChatGPT connector (auto tunnel)
npm run oneclick -- --public-url https://your-domain.example  # permanent ChatGPT connector
```

For ChatGPT you need a public HTTPS endpoint, so use `--public` (temporary) or `--public-url` (permanent). See [`docs/ONE_CLICK_SETUP.md`](ONE_CLICK_SETUP.md) for provider-specific tunnel options.

## Adding the connector in ChatGPT

Add the connector with **Authentication: OAuth**. ChatGPT opens a sign-in page served by your local server — enter your Rel.AI **dashboard token** (`REL_AI_MCP_TOKEN`) to approve the connection. There is no secret in the URL.

The MCP URL looks like:

```text
https://your-domain.example/mcp
```

ChatGPT discovers the OAuth endpoints automatically (`/.well-known/oauth-protected-resource`). OAuth requires the server to be reachable over HTTPS, so use a stable public URL/tunnel.

Opening plain `/mcp` in a browser only shows a diagnostic. Use the printed `COPY THIS FOR CHATGPT` URL or the dashboard connector card.

The dashboard URL (`/dashboard`) is not the MCP URL. ChatGPT needs the `/mcp` path, not the dashboard path.

## Tunnel requirement

Use a stable HTTPS tunnel (such as ngrok with a static domain, or a Cloudflare Tunnel with your own domain). Do not expose plain HTTP to the internet. ChatGPT requires HTTPS for connectors.

See [`docs/ONE_CLICK_SETUP.md`](ONE_CLICK_SETUP.md) for tunnel setup options.

Maintained by [@Kyne0328](https://github.com/Kyne0328).
