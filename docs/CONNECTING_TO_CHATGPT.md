# Connecting to ChatGPT

Rel.AI MCP exposes a small local-repo bridge to ChatGPT. On the public connector surface, ChatGPT sees these 24 workspace tools:

- `relai_repo_snapshot`
- `relai_read`
- `relai_write`
- `relai_replace`
- `relai_clear_files`
- `relai_apply_update`
- `relai_apply_bundle`
- `relai_package_snapshot`
- `relai_run_checks`
- `relai_browser`
- `relai_diff`
- `relai_restore_changes`
- `relai_status`
- `relai_feature_probe`
- `relai_git_status`
- `relai_git_fetch`
- `relai_git_commit`
- `relai_git_push`
- `relai_git_merge_branch`
- `relai_git_merge_remote_branches_plan`
- `relai_git_abort_merge`
- `relai_git_create_pr`
- `relai_remove_file`
- `relai_refactor_audit`

Use `relai_repo_snapshot` to inspect a configured workspace, `relai_read` to load exact files, `relai_replace` for localized exact edits, `relai_write` for complete file replacement, `relai_clear_files` or `relai_remove_file` for cleanup, `relai_run_checks` to run validation, `relai_diff` to review the result, `relai_git_*` tools for explicit branch workflows, and `relai_refactor_audit` for semantic residue scans after larger refactors.

Internal helper tools such as `relai_edit`, `relai_set_policy`, and `relai_session_summary` are intentionally not part of the public connector surface. Older update/local/task-runner families are also hidden so the connector does not fall back into unreliable generated scripts, Python one-liners, or malformed unified diffs.

## Adding the connector in ChatGPT

Add the connector with **No Authentication**. The MCP URL already contains a secret path segment — no separate auth header is needed.

The MCP URL looks like:

```text
https://your-domain.example/mcp/<secret>
```

Treat `<secret>` like a password: do not share it, and rotate it if exposed. Use `npm run oneclick -- --reset-chatgpt-secret` to rotate.

Opening plain `/mcp` in a browser only shows a redacted diagnostic. Use the printed `COPY THIS FOR CHATGPT` URL or the dashboard connector card for the full `/mcp/<secret>` URL.

The dashboard URL (`/dashboard`) is not the MCP URL. ChatGPT needs the `/mcp/<secret>` path, not the dashboard path.

## Tunnel requirement

Use a stable HTTPS tunnel (such as ngrok with a static domain, or a Cloudflare Tunnel with your own domain). Do not expose plain HTTP to the internet. ChatGPT requires HTTPS for connectors.

See [`docs/ONE_CLICK_SETUP.md`](ONE_CLICK_SETUP.md) for tunnel setup options.

Maintained by [@Kyne0328](https://github.com/Kyne0328).
