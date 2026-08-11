# Connecting Rel.AI MCP to ChatGPT

Rel.AI exposes one canonical 12-tool MCP surface. The normal desktop connection is **Rel.AI Cloud**; **Direct** remains an Advanced fallback for users who deliberately want a personal ngrok endpoint. In both modes repository files, Git operations, commands, validation, builds, and managed processes execute on the selected local desktop.

## Rel.AI Cloud — default

1. Open **Connection** in Rel.AI MCP or choose **Connect ChatGPT** during first-run setup.
2. Rel.AI starts the desktop connection and its outbound gateway connection, then shows a short-lived pairing code.
3. In ChatGPT, use the connection path for your plan: **Plus or Pro** — open **Plugins** from the sidebar or **Settings > Plugins**, add Rel.AI MCP, and choose **Connect**; **Business, Enterprise, or Edu** — open the Rel.AI app provided under your workspace **Apps**. Enable Developer mode or obtain workspace approval when your plan/workspace requires it.
4. When the Rel.AI OAuth page opens, enter the pairing code shown by the desktop.
5. Return to Rel.AI and wait for **Connected**.
6. Add at least one local workspace before asking ChatGPT to inspect repository files.

Cloud pairing does not require a separate Rel.AI username/password, an ngrok account, a connection port, or the Direct approval token.

## Device identity and recovery

Initial Cloud pairing creates an accountless Rel.AI principal and a device identity. Each desktop generates a P-256 key pair; the private key is encrypted locally through Electron `safeStorage`, while the gateway receives only the public identity needed for challenge verification.

Use **Connection** for the explicit recovery and device actions:

- reveal and securely store the recovery code;
- create a short-lived, one-time device-link code from an already paired computer;
- recover the same accountless principal on a replacement computer;
- list paired devices and revoke a lost or retired device.

Workspace folders remain computer-specific. Pairing another desktop does not upload or copy repository paths or files from the first computer.

## Verify the connection safely

Start with a read-only request:

```text
Use Rel.AI MCP on workspace "myapp". Call relai_work with action "begin", retain the returned work_id, then call relai_snapshot with that work_id. Do not modify files yet.
```

Each independent repository objective receives its own principal-bound `work_id`. Transport connections, ChatGPT conversation identity, device identity, and repository name do not replace that work-session boundary.

## Tool refresh, reauthentication, and desktop updates

These are independent states:

- `tool_refresh_required`: the current OAuth grant has not observed the current Rel.AI tool manifest through `tools/list`. This is advisory for an otherwise compatible request.
- `reauthentication_required`: OAuth authorization must be restored.
- `device_update_required`: the selected desktop gateway protocol is incompatible; the gateway blocks forwarding until the desktop is updated.

Rel.AI can prove which manifest it serves and when a grant requests that manifest. It cannot force ChatGPT to replace its host-side cached app definition or prove that an administrator/user accepted refreshed actions. Use the current ChatGPT app-management refresh/review flow when Rel.AI reports a stale tool snapshot.

## Usage

The top-level **Usage** page loads one UTC month on demand from Rel.AI Cloud. It shows exact gateway-observed request, tool-call, outcome, byte, duration, active-day, device, tool, and workspace aggregates. These values are not ChatGPT model-token or billing estimates.

The gateway persists monthly aggregate usage. The current implementation does not define an automatic deletion/retention window for those aggregate rows.

## Advanced: Direct connection

Direct mode retains the managed-ngrok + local OAuth architecture:

1. Open **Connection** and choose the Advanced Direct setup.
2. Configure the desktop connection port, ngrok account key, and static ngrok domain.
3. Rel.AI starts the same local MCP service plus the bundled managed ngrok agent.
4. In ChatGPT, add the Direct MCP using the plan-appropriate surface: **Plugins** for Plus/Pro, or the workspace **Apps** surface for managed plans, then configure the Direct `/mcp` endpoint with OAuth.
5. Approve the local Rel.AI authorization page with the Direct approval token.

Legacy ngrok configurations migrate to Direct mode. Switching to Cloud preserves Direct settings so the fallback remains reversible.

Replacing the Direct approval token revokes current Direct OAuth access/refresh state while preserving the registered app where possible. Reconnect the existing app with the replacement token; do not treat Direct token rotation as a Cloud schema refresh.

## MCP protocol requirement

Modern MCP behavior targets `2026-07-28`. HTTP also retains the SDK-supported stateless ChatGPT `2025-11-25` initialize flow. Rel.AI does not issue `MCP-Session-Id`; legacy `/sse`, `/messages`, JSON-RPC batches, removed tool aliases, and initialize-based stdio are not supported.

Native MCP Tasks are negotiated independently through `io.modelcontextprotocol/tasks`. Clients without Tasks support receive bounded synchronous execution for eligible operations.

## Troubleshooting

If Cloud pairing fails, create a fresh pairing code, keep the desktop running, and confirm the OAuth page is using the current code. If Rel.AI reports `device_update_required`, update the desktop first. If ChatGPT shows old tools while Rel.AI reports `tool_refresh_required`, refresh/review the existing app definition in ChatGPT rather than rotating credentials.

If a workspace cannot be found, confirm its alias under **Workspaces**, then retry a read-only `relai_work begin` + `relai_snapshot` request. Opening `/mcp` in a normal browser is not a connection test; MCP clients use `POST /mcp`.

For Direct failures, verify the connection port is free, the ngrok account key is valid, and the configured static domain is available to the current agent.
