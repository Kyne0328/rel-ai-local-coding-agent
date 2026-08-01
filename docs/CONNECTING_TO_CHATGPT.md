# Connecting to ChatGPT

Rel.AI MCP exposes 34 callable workspace tools through MCP SDK v2 over stdio and the OAuth-protected Streamable HTTP endpoint at `POST /mcp`.

- `relai_start_task`
- `relai_repo_snapshot`
- `relai_search`
- `relai_code_inspect`
- `relai_exec`
- `relai_read`
- `relai_tidy_plan`
- `relai_tidy_run`
- `relai_run_checks`
- `relai_http_probe`
- `relai_ui_check`
- `relai_diff`
- `relai_restore_paths`
- `relai_reset_workspace`
- `relai_status`
- `relai_git_commit`
- `relai_git_push`
- `relai_git_draft_pr`
- `relai_edit`
- `relai_complete_task`

Use `relai_start_task` once for each independent logical task. It returns compact repository and instruction bootstrap context plus a workspace-bound `task_id`. Every later task-scoped call requires that ID and resolves the bound workspace automatically; pass `workspace` only when you want an explicit ownership check. Use `relai_repo_snapshot` only when the bootstrap needs refreshing, `relai_search` for raw text and contextual location, `relai_code_inspect` for symbol/reference/impact relationships and affected-test discovery, `relai_read` for source beyond the returned ranges, and `relai_edit` for all file changes. Search defaults to adaptive `mode:"auto"`: focused searches receive broader context, while noisy searches receive smaller prioritized ranges.

Use `relai_exec` for one-shot project commands such as dependency installation, migrations, compilers, and repository utilities. It returns the exit status, bounded output, timeout state, and detected file changes. It does not replace structured final validation.

Completion is explicit, never inferred from a passing test run. Prefer `relai_run_checks` with `complete:true` and `summary` on the final standard or release validation; this closes the session atomically only when all selected checks pass. When a read-only diff or status review follows validation, omit `complete` and call `relai_complete_task` once after the review.

Use `relai_http_probe` for local routes such as `/health` or `/dashboard`; it rejects absolute and protocol-relative URLs. Use `relai_ui_check` for an exact `package.json` script name intended for UI or browser validation.

Use `relai_restore_paths` to restore specific tracked paths without touching untracked or unrelated files. Use `relai_reset_workspace` only for repository-wide recovery: `confirmation:"RESET"` resets tracked changes, while untracked cleanup additionally requires `removeUntracked:true` and `confirmation:"RESET_AND_CLEAN"`.

Use `relai_status` with a workspace alias for command configuration, session policy, branch, ahead/behind counts, ownership-split changes, and untracked-file state. Repository details are nested under `workspace.repository`.

Use `relai_git_draft_pr` to prepare local pull-request title/body text from a base/head diff. It does not call GitHub, GitLab, or another hosting provider; it does not create a pull request, push a branch, or modify the repository.

Task bootstrap and repository snapshots automatically include guidance from `REL_AI.md`, `.relai/instructions.md`, and applicable hierarchical `AGENTS.override.md` / `AGENTS.md` files. `REL_AI.md` has highest precedence; nearer target-directory agent instructions override parent agent instructions. The combined connector payload is capped at 64 KiB and reports its sources and truncation state; use `relai_read` on a named file when complete text is needed. Instruction text is never executed automatically.

Persistent process management, managed worktrees, native MCP Tasks interoperability, and task history are available through the current surface. Managed worktrees use isolated aliases and preserve branches by default; removal refuses dirty worktrees and active processes unless the required explicit approval is supplied.

Tracked-file deletion is handled through a structured `Delete File` patch sent to `relai_edit`. Session-owned untracked artifacts are removed only through `relai_tidy_plan` followed by `relai_tidy_run`.

## Starting the server

Launch the **Rel.AI MCP** desktop app. It starts the local server and the public tunnel together, using the ngrok authtoken and static domain you entered in the setup wizard.

ChatGPT requires a public HTTPS endpoint, which the Rel.AI-managed ngrok agent provides. The installer does not embed ngrok. First-run setup asks permission to download the exact pinned official archive, verifies it before execution, and configures it automatically. Nothing has to be installed or started separately. See [ONE_CLICK_SETUP.md](ONE_CLICK_SETUP.md) for the full first-run walkthrough.

The packaged desktop app opens the dashboard in a secured Electron window by default. The same local `/dashboard` route remains accessible in a normal browser when needed; both hosts use the same dashboard code and server APIs. Electron uses a single-use bootstrap exchange and an HttpOnly local session cookie instead of exposing the permanent approval token to the embedded renderer.

Use **Sessions** for logical tasks and **Activity** for individual tool calls. Each independent objective begins with `relai_start_task`, and only its explicit `task_id` can select that task afterward. Connection changes, reasoning gaps, workspace names, and ChatGPT conversation metadata are never used to merge or recover tasks.

## Adding the connector in ChatGPT

1. Launch the Rel.AI MCP desktop app and open the dashboard from the tray or the main window.
2. Copy the MCP URL ending in `/mcp`.
3. In ChatGPT, open **Settings > Apps > Create**.
4. Add the MCP URL and select **OAuth** authentication.
5. When the Rel.AI authorization page opens, copy the current approval token from **Settings > Connection** and enter it.

Example MCP URL:

```text
https://your-domain.example/mcp
```

ChatGPT discovers the OAuth endpoints through `/.well-known/oauth-protected-resource`. Opening `/mcp` in a browser displays only a diagnostic; MCP clients use `POST /mcp`. The former `/sse` and `/messages` MCP routes are not supported.

When you replace the approval token, Rel.AI revokes current ChatGPT access and refresh tokens. The existing ChatGPT app and MCP URL remain valid. Copy the new token, then in ChatGPT Web open **Settings > Apps > Enabled Apps** and select the existing **Rel.AI MCP** app. Choose **Connect** or **Reconnect** if shown; otherwise, select Rel.AI MCP in a new chat and ask ChatGPT to use it. Paste the token on the Rel.AI authorization page, approve access, and retry the request. Do not delete and recreate the app.

## Tunnel requirement

Use the verified Rel.AI-managed ngrok agent with a static domain. Do not expose plain HTTP to the public internet.

Maintained by [@Kyne0328](https://github.com/Kyne0328).
