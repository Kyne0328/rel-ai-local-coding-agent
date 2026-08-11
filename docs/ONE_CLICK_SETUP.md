# Rel.AI MCP One-Click Setup

This guide covers the packaged desktop application. The normal setup path is Rel.AI Cloud and keeps coding execution on your computer.

## Before you begin

For the normal Cloud setup you need:

- the Rel.AI MCP desktop application;
- a ChatGPT workspace/plan that can use the required custom MCP app; and
- at least one local repository folder you are willing to configure as a Rel.AI workspace.

Ngrok credentials are needed only for **Advanced Direct connection**.

## Install and first run

1. Install or launch the appropriate Rel.AI MCP desktop package.
2. The first-run wizard opens the three-step Cloud flow: **Connect ChatGPT**, **Secure this device**, **Ready**.
3. Choose **Connect ChatGPT**. Rel.AI starts its desktop connection and outbound gateway client, then displays a short-lived pairing code.
4. In ChatGPT, use the surface for your plan: **Plus or Pro** — open **Plugins** from the sidebar or **Settings > Plugins**, add Rel.AI MCP, and choose **Connect**; **Business, Enterprise, or Edu** — open the Rel.AI app provided under workspace **Apps**. Use OAuth when prompted.
5. Enter the desktop pairing code on the Rel.AI OAuth page.
6. When the desktop confirms the pairing, continue to **Secure this device**.
7. Reveal the recovery code explicitly and store it somewhere appropriate for your threat model.
8. Finish setup and add a workspace from **Workspaces**.

The setup flow does not place pairing/recovery secrets in URLs or passive status payloads.

## What stays local

```text
ChatGPT
  -> Rel.AI Cloud MCP/OAuth gateway
  -> authenticated principal + selected paired device
  -> outbound Rel.AI desktop connection
  -> local MCP execution
  -> configured local workspace
```

Repository files, absolute workspace paths, commands, Git operations, tests, builds, managed processes, and workspace configuration remain on the selected desktop. The gateway owns identity, OAuth, device routing, bounded request coordination, schema observation, and aggregate usage.

Hosted routing and persistence are implementation details of the private Rel.AI Cloud service; the public desktop does not store or expose that server-side design.

## Add your first workspace

1. Open **Workspaces**.
2. Choose **Add workspace**.
3. Select a project folder.
4. Enter or accept a short workspace alias.
5. Review repository and validation information.
6. Save the workspace.

Use a read-only first request before allowing edits:

```text
Use Rel.AI MCP on workspace "myapp". Call relai_work with action "begin", retain the returned work_id, then call relai_snapshot with that work_id. Do not modify files yet.
```

## Secure this device

Each Cloud desktop owns a P-256 device key pair. Electron encrypts the private key with `safeStorage`; the gateway verifies the corresponding public identity during challenge authentication.

### Recovery code

The long-lived recovery secret identifies the same accountless principal. Reveal it only through the explicit recovery action and keep it separate from routine logs/config exports. On a replacement computer, choose the recovery action, enter the saved code, then complete the new short-lived OAuth pairing.

### One-time device link

If an existing paired desktop is available, create a one-time link code instead of revealing the long-lived recovery code. The gateway consumes that proof when it is used; reuse is rejected.

### Lost device

Open **Connection** on another paired desktop and revoke the lost/retired device. Revocation is separate from OAuth reauthentication and tool-schema refresh.

## Connection and Usage

**Connection** is the routine status/recovery surface. It owns Cloud/Direct mode, device controls, recovery, and independent tool/auth/device synchronization states. Gateway status updates refresh only the affected Connection region and do not restart the desktop connection or remount unrelated dashboard pages.

**Usage** loads one selected UTC month from Rel.AI Cloud on demand. It reports exact Rel.AI gateway traffic/execution aggregates, not ChatGPT model-token or billing estimates. The current implementation has no automatic deletion/retention window for those monthly aggregate rows.

## Application updates

Installed Windows builds check for updates periodically. Update discovery, download, and restart-to-install remain explicit user actions, and restart-to-install is blocked while Rel.AI work is active. Application update availability is independent from live OAuth, tool-schema, and device-compatibility state.

## Advanced: Direct connection

Direct mode preserves the managed-ngrok fallback. Configure it only when you deliberately want a personal secure connection:

1. Open Advanced Direct setup from the wizard or **Connection**.
2. Choose the desktop connection port.
3. Enter the ngrok account key and static domain.
4. Rel.AI starts the same local MCP server plus the bundled managed ngrok agent.
5. In ChatGPT, add the Direct MCP from **Plugins** on Plus/Pro, or from workspace **Apps** on managed plans, then configure the Direct `/mcp` URL with OAuth.
6. Approve the local OAuth page with the Direct Rel.AI approval token.

Legacy configurations containing ngrok values migrate to Direct mode rather than being discarded. Switching to Cloud preserves those Direct settings.

## Troubleshooting

For Cloud pairing, use a fresh unexpired pairing code and keep the desktop running. A `device_update_required` state must be resolved by updating the desktop; a `tool_refresh_required` state is handled through the current ChatGPT app refresh/review flow, not by rotating the Direct token.

For Direct mode, confirm the configured port is free, the ngrok account key is valid, and the static domain is not already owned by another running agent.

Open **Diagnostics** for stable error codes and sanitized local-service logs. Diagnostic exports redact OAuth/bearer credentials, approval material, API keys, ngrok keys, and similarly named secret fields.
