# Rel.AI MCP One-Click Setup

This guide covers the packaged desktop application. Rel.AI uses one supported ChatGPT transport: **OpenAI Secure MCP Tunnel**. Repository access and tool execution stay on the computer running Rel.AI.

## Before you begin

You need:

- the Rel.AI MCP desktop application;
- an OpenAI Secure MCP Tunnel created for this computer;
- a runtime API key for that tunnel;
- a ChatGPT plan/workspace that can use the required MCP integration; and
- at least one local repository folder you are willing to configure as a Rel.AI workspace.

## Install and first run

1. Install or launch the appropriate Rel.AI MCP desktop package.
2. In the setup wizard, enter the OpenAI **Tunnel ID** and **runtime API key** for this computer.
3. Keep the default local connection port unless it conflicts with another local application.
4. Choose **Start secure connection**. Rel.AI starts its private local MCP service and the bundled OpenAI tunnel client.
5. Open **Workspaces**, add a repository folder, and give it a short alias such as `myapp`.
6. In ChatGPT, create or reconnect the Rel.AI MCP integration using the **Tunnel** connection option and associate it with this computer's tunnel.
7. Enable Rel.AI MCP in the chat and send a read-only first request.

The runtime API key is encrypted through Electron `safeStorage` and is write-only after it is saved. Rel.AI does not require a second public transport account or a public URL entered by the user.

## What stays local

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> bundled tunnel-client
  -> private local Rel.AI MCP service
  -> configured local workspace
```

Repository files, absolute workspace paths, commands, Git operations, tests, builds, managed processes, workspace configuration, task history, and local analytics remain on this computer. The tunnel is transport only; it does not become the authority for repository work.

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

## Connection and Usage

**Connection** shows the configured tunnel ID, whether the runtime key is stored, local MCP health, Secure MCP Tunnel health, and recovery actions. Saving connection settings restarts only the Rel.AI connection service and tunnel client; it does not restart unrelated developer processes.

**Usage** is built from locally observed Rel.AI activity. It is not ChatGPT model-token or billing accounting.

## Application updates

Installed Windows builds check for updates periodically. Update discovery, download, and restart-to-install remain explicit user actions, and restart-to-install is blocked while Rel.AI work is active. Application update state is independent from tunnel connectivity and repository task completion.

## Troubleshooting

If the tunnel does not connect:

1. confirm the Tunnel ID starts with `tunnel_` and belongs to the intended OpenAI Secure MCP Tunnel;
2. replace the runtime API key in **Connection** if the saved key was revoked or replaced;
3. confirm the configured local port is available;
4. keep Rel.AI running while ChatGPT reconnects to the tunnel; and
5. open **Diagnostics** for the sanitized local service and tunnel logs.

Diagnostic exports redact bearer credentials, API keys, passwords, authorization headers, and similarly named secret fields. Do not post tunnel runtime keys or repository credentials in public issues.
