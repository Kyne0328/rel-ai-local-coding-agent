# One-click setup and permanent ChatGPT connector

This guide takes you from a downloaded installer to a working ChatGPT connector that survives restarts.

Rel.AI MCP is a self-contained Windows desktop app. It bundles its own runtime and its own ngrok agent, so there is nothing to install manually — no Node.js, no npm, no separate ngrok download. The app also keeps its ngrok agent up to date on its own.

## What you need first

The installer cannot create an ngrok account for you, so do that once before first launch. Sign up at [ngrok.com](https://ngrok.com) — the free tier is enough — and collect:

| Value | Where to find it | Why |
| --- | --- | --- |
| **Authtoken** | ngrok dashboard, under *Your Authtoken* | Authenticates the bundled agent |
| **Static domain** | ngrok dashboard, under *Domains* | Keeps your connector URL stable |

The static domain is the part that matters for a permanent setup. A random temporary tunnel URL changes every restart, which forces you to delete and recreate the ChatGPT app each time. A static domain is issued once and stays yours.

## Install and first run

1. Download the latest installer from the [Releases page](https://github.com/Kyne0328/rel-ai-mcp/releases) and run it. It installs per-user, no admin prompt.
2. Launch **Rel.AI MCP**. The setup wizard appears on first run only.
3. Paste your ngrok authtoken and static domain, and pick a local port (`3333` by default).
4. Save. The app writes its config, generates a dashboard token, starts the local server, and brings up the tunnel.

The desktop app creates `config.json` automatically. Skipping the dashboard onboarding leaves an empty but valid workspace configuration, so the app remains usable and workspaces can be added later. The `npm run init-config` command is only for repository/CLI development and is not required by the installed application.

On first launch the app copies its bundled ngrok agent into `~/.rel-ai-mcp/managed-ngrok/` and runs it from there, so it can update the agent later without touching the installed program files.

Every launch after this goes straight to the dashboard. The app lives in the system tray — closing a window leaves it running, and you quit it from the tray menu.

## What the app creates

All state lives under `~/.rel-ai-mcp/`:

| File | Contents |
| --- | --- |
| `config.json` | Workspaces, validation commands, safety settings |
| `.env` | Your dashboard bearer token (`REL_AI_MCP_TOKEN`) — keep private |
| `connection.json` | Host, port, and public URL of the current session |
| `managed-ngrok/` | The managed ngrok agent, its config, and update state |

## Connect ChatGPT

1. Open the dashboard from the tray or the main window.
2. Go to the **Connector** page. It shows your MCP URL — it will look like `https://your-domain.ngrok-free.app/mcp`.
3. In ChatGPT, go to **Settings > Apps > Create**.
4. Paste the MCP URL.
5. Set authentication to **OAuth**.

ChatGPT then opens a sign-in page served by your own machine and asks for your Rel.AI **dashboard token** to approve the connection. The token is in `~/.rel-ai-mcp/.env`, and the dashboard Connector page can show it to you directly. No secret is ever embedded in the URL.

Because the domain is static, this survives restarts. You set it up once.

### Use the same connector on another computer

The ChatGPT app is tied to the static MCP URL, not to one Windows installation. On another computer:

1. Stop Rel.AI MCP on the previous computer so the static ngrok domain is free.
2. Install Rel.AI MCP and configure the same ngrok account key and static domain.
3. Open ChatGPT and use the existing Rel.AI MCP app. Do not delete or recreate it.
4. When ChatGPT opens the authorization page, enter the dashboard token shown by the new computer.

Rel.AI recognizes the existing connector client ID and restores its registration after dashboard-token approval. Workspace configuration remains computer-specific, so add the folders available on that computer from the Workspaces page.

Only one computer can publish the same ngrok static domain at a time. Quit Rel.AI from the tray before handing the connector to another computer.

### Rotating the token

Open **Settings** in the desktop app and regenerate the dashboard token. The next ChatGPT OAuth sign-in uses the new value; the MCP URL itself does not change.

## Adding workspaces

A workspace is a local folder ChatGPT is allowed to touch, under an alias. Add one from the dashboard's **Workspaces** page with **Add workspace**, which opens a folder picker and lets you set the alias, validation commands, protected branches, and allowed remotes.

Changes apply immediately. There is no restart needed after adding a workspace.

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

1. Check the desktop app's status window. It reports server state, tunnel state, and the last error.
2. Confirm the tunnel status reads **running**. If it failed, the status window shows the ngrok log.
3. Check `http://127.0.0.1:3333/health` in a browser (adjust the port if you changed it).
4. Confirm the ChatGPT MCP URL is the plain `/mcp` URL, not `/dashboard`.
5. Confirm the ChatGPT app authentication is set to **OAuth**, and that you completed the dashboard-token sign-in.
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
Use the Rel.AI MCP connector tools directly.
Call relai_repo_snapshot with workspace "myapp" and maxEntries 200.
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
