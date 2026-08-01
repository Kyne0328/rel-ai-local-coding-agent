# Desktop setup and permanent ChatGPT connector

This guide takes you from a downloaded installer to a working ChatGPT connector that survives restarts.

Rel.AI MCP is a self-contained Windows desktop app. It bundles its own runtime but does not embed `ngrok.exe` in the installer. During first-run setup, Rel.AI asks for explicit consent, downloads the exact pinned official ngrok archive, verifies its archive and executable hashes, version, publisher, and certificate issuer, then configures the agent automatically. There is nothing to install or configure manually — no Node.js, no npm, and no separate ngrok installer. A network connection is required for the first acquisition or a later repair.

## What you need first

The installer cannot create an ngrok account for you, so do that once before first launch. Sign up at [ngrok.com](https://ngrok.com) — the free tier is enough — and collect:

| Value | Where to find it | Why |
| --- | --- | --- |
| **Authtoken** | ngrok dashboard, under *Your Authtoken* | Authenticates the bundled agent |
| **Static domain** | ngrok dashboard, under *Domains* | Keeps your connector URL stable |

The static domain is the part that matters for a permanent setup. A random temporary tunnel URL changes every restart, which forces you to delete and recreate the ChatGPT app each time. A static domain is issued once and stays yours.

## Install and first run

1. Download the latest installer from the [Releases page](https://github.com/Kyne0328/rel-ai-mcp/releases) and run it.
2. Choose whether to install **for the current user** or **for all users**. Current-user installation is the default and does not require administrator access. Choosing all users triggers a Windows administrator prompt when the installer is not already elevated.
3. Review the installation folder, change it when needed, and click **Install**. The installer creates Start menu and desktop shortcuts.
4. On the Finish page, leave **Run Rel.AI MCP** selected to open it immediately, or clear the checkbox and launch it later from the Start menu or desktop shortcut.
5. The Rel.AI setup wizard appears on first run only. Paste your ngrok authtoken and static domain, pick a local port (`3333` by default), and approve the official ngrok component download.
6. Save. Rel.AI downloads the pinned archive from ngrok, verifies it before execution, installs it into managed storage, writes its config, generates an approval token, starts the local server, and brings up the tunnel.

The desktop app creates `config.json` automatically. Skipping the dashboard onboarding leaves an empty but valid workspace configuration, so the app remains usable and workspaces can be added later. The `npm run init-config` command is only for repository/CLI development and is not required by the installed application.

On first launch, after consent, the app downloads the pinned official ngrok archive into a temporary directory. It verifies the archive size and SHA-256, extracts exactly one expected executable, verifies the executable size, SHA-256, exact version, Authenticode publisher, and certificate issuer, and only then atomically installs it under `~/.rel-ai-mcp/managed-ngrok/`. Temporary files are removed. Later launches reuse the managed copy only when it still passes every check. A missing or invalid copy is never executed and is repaired through the same verified acquisition path. The agent does not self-update; Rel.AI updates the pinned manifest through application releases.

Every ordinary launch after this goes straight to the dashboard. The app lives in the system tray — closing a window leaves it running, and you quit it from the tray menu. The installed Windows app can also launch at sign-in in the background, starting the tray, local service, and public endpoint without opening the dashboard.

## What the app creates

All state lives under `~/.rel-ai-mcp/`:

| File | Contents |
| --- | --- |
| `config.json` | Workspaces, validation commands, safety settings |
| `.env` | Your approval token (`REL_AI_MCP_TOKEN`) — keep private |
| `connection.json` | Host, port, and public URL of the current session |
| `managed-ngrok/` | The managed ngrok agent and its local configuration |

The installed desktop app also stores `desktop-lifecycle.json` in Electron's per-user application-data directory. It contains only non-secret version, launch-count, running-marker, and clean-exit metadata.

## Connect ChatGPT

1. Open the dashboard from the tray or the main window.
2. Go to the **Connection** page. It shows your MCP URL — it will look like `https://your-domain.ngrok-free.app/mcp`.
3. In ChatGPT, go to **Settings > Apps > Create**.
4. Paste the MCP URL.
5. Set authentication to **OAuth**.

ChatGPT then opens a sign-in page served by your own machine and asks for your Rel.AI **approval token** to approve the connection. The token is stored in `~/.rel-ai-mcp/.env`, and **Settings > Connection** can show and copy it through the secured Electron bridge. No secret is ever embedded in the URL.

Because the domain is static, this survives restarts. You set it up once.

After the desktop wizard launches Rel.AI, the dashboard opens directly on **Settings > Connection**. A compact setup handoff links to **Connect ChatGPT** and **Add workspace**; the separate browser onboarding wizard is not shown in the desktop app. The handoff remains available until you dismiss it.

### Use the same connector on another computer

The ChatGPT app is tied to the static MCP URL, not to one Windows installation. On another computer:

1. Stop Rel.AI MCP on the previous computer so the static ngrok domain is free.
2. Install Rel.AI MCP and configure the same ngrok account key and static domain.
3. Open ChatGPT and use the existing Rel.AI MCP app. Do not delete or recreate it.
4. When ChatGPT opens the authorization page, enter the approval token shown by the new computer.

Rel.AI recognizes the existing connector client ID and restores its registration after approval with the new computer's token. Workspace configuration remains computer-specific, so add the folders available on that computer from the Workspaces page.

Only one computer can publish the same ngrok static domain at a time. Quit Rel.AI from the tray before handing the connector to another computer.

### Rotating the token

Open **Settings > Connection** and choose **Replace approval token**. Type `REPLACE` to confirm. Rel.AI generates the new token in the Electron main process, revokes all current OAuth access and refresh tokens, preserves the existing ChatGPT client registration, and restarts the connection. The MCP URL does not change.

After replacement:

1. Copy the new approval token.
2. In ChatGPT Web, open **Settings > Apps > Enabled Apps** and select the existing **Rel.AI MCP** app.
3. Choose **Connect** or **Reconnect** if shown. Otherwise, select Rel.AI MCP in a new chat and ask ChatGPT to use it.
4. Paste the new token on the Rel.AI authorization page, approve access, and retry your request.

Do not delete or recreate the ChatGPT app.

## Adding workspaces

A workspace is a local folder ChatGPT is allowed to touch, identified by a workspace name. Add one from the dashboard's **Workspaces** page with **Add workspace**. Choose the project folder first; Rel.AI suggests a short workspace name and detects whether the folder is a Git repository and whether automatic validation is available.

The default protected branches, base branch, and allowed remote work for most repositories. Open **Git and safety settings** only when those defaults need to change. On the workspace card, branch state, validation commands, history links, and removal remain under **Repository and safety details** so the normal page stays focused on readiness and common actions.

Changes apply immediately. There is no restart needed after adding a workspace.

## Faster dashboard navigation

Use **Quick navigation** in the top bar, or press `Ctrl+K` on Windows/Linux and `Cmd+K` on macOS. It searches dashboard pages, Settings pages, common actions such as Refresh dashboard and Add workspace, and every configured workspace.

The **Jump to workspace…** control opens the matching Workspaces card directly. The top connection status links to **Settings → Connection**. Activity filters are stored in the route, so a filtered Activity view can be refreshed, bookmarked, or shared without losing its search, time range, tool, status, task, or workspace scope.

Keyboard focus stays inside open dialogs and drawers until they close, and Escape returns focus to the control that opened them. On narrow screens, controls stack, Settings tabs scroll horizontally, touch targets expand, and mobile navigation respects device safe areas. Reduced-motion and high-contrast preferences are preserved.

Routine dashboard information is intentionally flatter and denser than warnings, dialogs, and active recovery states. Summary counts and readiness facts are grouped into shared panels, while repeated setup instructions collapse after the connection is ready.

## Application updates

The installed Windows app checks GitHub Releases once per day. Open **Settings → General → Application updates** or use the tray menu to check immediately.

Rel.AI never downloads or installs an application update without an explicit action. When an update is available, choose **Download** and keep using the app while progress is shown. After the download finishes, choose **Restart and install**. Rel.AI refuses the restart while a tool call is active, so repository work is not interrupted.

The portable executable cannot update itself. General settings identifies the build as manual-only and links to GitHub Releases. Update failures leave the current version running and appear separately from connection health.

## Startup and recovery

Open **Settings → General → Startup and recovery** to control **Launch Rel.AI at sign-in**. This setting is available only in the installed Windows app. When enabled, Windows launches Rel.AI with `--background`: the tray, local service, public endpoint, and updater start, but the dashboard does not open. Opening Rel.AI normally still opens the dashboard.

Portable and development builds do not register startup entries. The same panel records the current version, launch count, and last clean exit. After an update, it confirms that the new version started successfully. If the previous desktop process ended without recording a clean shutdown, it reports a recovered interrupted exit without changing configuration or repository files. Repeated interrupted-exit notices should be reviewed in Diagnostics.

## Diagnostics and local history

Open **Settings → Diagnostics** to review stable error codes, impact, recommended actions, recent failed activity, and—when using the desktop app—recent local-service and tunnel logs. **Copy diagnostic report** creates a sanitized text summary suitable for troubleshooting; approval tokens, bearer credentials, OAuth values, passwords, API keys, and similar secrets are redacted.

Diagnostics also owns the controls for clearing session and activity history or the desktop service-log buffer. History cannot be cleared while a Rel.AI tool call is active. Service logs are in-memory and desktop-only, so browser-hosted dashboards show that control as unavailable.

## Safer first prompt

Use this after connecting the app in ChatGPT:

```text
Use Rel.AI MCP. Call relai_start_task for the configured workspace, retain the returned task_id, then call relai_repo_snapshot with that task_id. Do not modify files yet.
```

Then test a workspace read:

```text
Use Rel.AI MCP on workspace myapp. Start a task, retain its task_id, then show the workspace profile and the first 100 tree entries using that task_id. Do not modify files.
```

## Troubleshooting

If ChatGPT cannot connect:

1. Open **Settings > Diagnostics** in the desktop dashboard. It reports connection state, blocking errors, and recommended actions.
2. Confirm the Public endpoint layer reads **Available**. If the dashboard itself cannot start or load, Rel.AI opens a separate recovery fallback with the last service or tunnel error. Choose **Edit connection** there to repair the local port, ngrok account key, or static domain; the current approval token is preserved.
3. Check `http://127.0.0.1:3333/health` in a browser (adjust the port if you changed it).
4. Confirm the ChatGPT MCP URL is the plain `/mcp` URL, not `/dashboard`.
5. Confirm the ChatGPT app authentication is set to **OAuth**, and that you completed the approval-token sign-in.
6. Do not judge the connector by opening `/mcp` in a browser. MCP uses `POST`; an unauthenticated browser `GET` only returns a diagnostic.

Common tunnel failures:

| Symptom | Cause |
| --- | --- |
| `Port 3333 is already in use.` | Another program holds the port. Change the port in Settings. |
| ngrok exits immediately | Bad or expired authtoken. Re-enter it in Settings. |
| `failed to start tunnel` naming the domain | The domain is not on your ngrok account, or is already claimed by another running agent. |

## If ChatGPT says it cannot find the workspace or tools

That usually means ChatGPT searched connector files instead of calling the MCP tools, or the workspace alias is not configured.

Use this exact diagnostic prompt:

```text
Use the Rel.AI MCP tools directly.
Call relai_start_task with workspace "myapp" and retain the returned task_id.
Call relai_repo_snapshot with workspace "myapp", that task_id, and maxEntries 200.
Do not use file search. Do not modify files.
```

Expected result:

- `relai_repo_snapshot` returns the project profile, filtered tree, discovered commands, and workspace context.
- If `myapp` is not configured, the response shows a workspace resolution error; add the alias from the dashboard's Workspaces page.

Rel.AI MCP also exposes MCP resources:

```text
relai://server/help
relai://server/workspaces
relai://workspace/<alias>/inspect
relai://workspace/<alias>/profile
relai://workspace/<alias>/tree
```

These resources make the connector easier for ChatGPT to discover, but tools are still the preferred path for app actions.

Maintained by [@Kyne0328](https://github.com/Kyne0328).
