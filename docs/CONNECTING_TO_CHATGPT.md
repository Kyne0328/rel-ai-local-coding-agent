# Connecting to ChatGPT

Rel.AI MCP exposes one 19-tool workspace surface across local MCP and the ChatGPT connector.

- `relai_repo_snapshot`
- `relai_search`
- `relai_exec`
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
- `relai_complete_task`

Use `relai_repo_snapshot` for repository context, `relai_search` for locating code, `relai_read` for source beyond the returned ranges, and `relai_edit` as the primary change tool. Search defaults to adaptive `mode:"auto"`: focused searches receive broader context, while noisy searches receive smaller prioritized ranges. Use explicit `mode:"compact"` for path/line-only results or `mode:"context"` for fixed caller-controlled limits. Context results are grouped by file, merge overlapping ranges, and include file hashes. `relai_write` and `relai_replace` remain direct fallback tools.

Use `relai_exec` for one-shot project commands such as dependency installation, migrations, compilers, and repository utilities. It returns the exit status, bounded output, timeout state, and detected file changes. It does not replace the final `relai_run_checks` call required before `relai_complete_task`.

Repository snapshots automatically include guidance from `REL_AI.md` and `.relai/instructions.md` when present. `REL_AI.md` has higher precedence. The combined connector payload is capped at 64 KiB and reports its sources and truncation state; use `relai_read` on the named file when the complete text is needed. Instruction text is never executed automatically.

Persistent process management, managed worktrees, and persistent task plans are currently deferred and are not exposed by this build.

Tracked-file deletion is handled through a structured `Delete File` patch sent to `relai_edit`. Session-owned untracked artifacts are removed only through `relai_tidy_plan` followed by `relai_tidy_run`.

## Starting the server

Launch the **Rel.AI MCP** desktop app. It starts the local server and the public tunnel together, using the ngrok authtoken and static domain you entered in the setup wizard.

ChatGPT requires a public HTTPS endpoint, which the bundled ngrok agent provides. Nothing has to be installed or started separately. See [ONE_CLICK_SETUP.md](ONE_CLICK_SETUP.md) for the full first-run walkthrough.

The packaged desktop app opens the dashboard in a secured Electron window by default. The same local `/dashboard` route remains accessible in a normal browser when needed; both hosts use the same dashboard code and server APIs. Electron uses a single-use bootstrap exchange and an HttpOnly local session cookie instead of exposing the permanent dashboard token to the embedded renderer.

Use **Sessions** for grouped ChatGPT work and **Activity log** for individual tool calls. Rel.AI keeps each session open for five minutes after its latest tool call, renewing the window when ChatGPT continues, so ordinary approval, reasoning, and connector-reconnect gaps stay grouped. Separate concurrent sessions remain distinct when Rel.AI has stable conversation identity. The workspace selector scopes Overview, Sessions, Workspaces, Activity, and Diagnostics to one configured repository.

## Adding the connector in ChatGPT

1. Launch the Rel.AI MCP desktop app and open the dashboard from the tray or the main window.
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

Use the bundled ngrok agent with a static domain. Do not expose plain HTTP to the public internet.

Maintained by [@Kyne0328](https://github.com/Kyne0328).
