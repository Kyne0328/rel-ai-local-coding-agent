# Connecting Rel.AI MCP to ChatGPT

Rel.AI connects ChatGPT web to local projects through **OpenAI Secure MCP Tunnel**. ChatGPT provides the conversation and reasoning. Rel.AI lets it find files, edit code, run commands and tests, check the result, review changes, and use Git on the computer running Rel.AI.

## Configure the tunnel

1. Create an OpenAI Secure MCP Tunnel for this computer and create a runtime API key for it in OpenAI Platform.
2. Open Rel.AI MCP and enter the **Tunnel ID** and **runtime API key** in the first-run wizard or **Connection** page.
3. Keep Rel.AI running until Connection reports the Secure MCP Tunnel as **Connected**.
4. Follow the highlighted ChatGPT connector guide on **Overview**, then add at least one local workspace before asking ChatGPT to inspect repository files.

Rel.AI encrypts the saved runtime API key with Electron `safeStorage`. The key is never returned to the renderer after storage; entering a new value replaces it.

## Connect ChatGPT

After the Secure MCP Tunnel connects, Rel.AI opens **Overview** and highlights the remaining ChatGPT setup so you can continue from the same getting-started guide. Save the provided `relai-mcp.png` icon if you want to use it, then use **Open ChatGPT plugin setup** to open `https://chatgpt.com/plugins#settings/Connectors?create-connector=true`.

Create the connector with **Name: Rel.AI MCP**, **Connection: Tunnel**, the same Tunnel ID shown in Rel.AI, and **Authentication: No authentication**. Click **Scan Tools**, confirm the Rel.AI tools appear, then click **Create**. After creation, open **Manage** and upload the saved Rel.AI icon as the connector logo.

If the integration already exists, reconnect or refresh it rather than creating a second copy unless you deliberately want a separate tunnel association.

After enabling Rel.AI MCP in a chat, start with a read-only request:

```text
Use Rel.AI MCP with workspace "myapp". Start one work session, read the project, and explain how the relevant parts work before changing anything.
```

Rel.AI creates a separate work session for each new goal. Internally, that session has a `work_id` so edits, checks, review, recovery, and completion stay attached to the same task even if the connection changes.

## Why Rel.AI uses ChatGPT

Rel.AI uses ChatGPT's app/tool path, not Codex. OpenAI currently documents that [Apps use the normal ChatGPT rate limits for your plan](https://help.openai.com/en/articles/11487775-connectors-in), while [Codex usage counts toward agentic usage](https://help.openai.com/en/articles/11369540-codex-and-chatgpt-plan-usage-limits). Rel.AI therefore does not draw from the Codex agentic allowance. Your normal ChatGPT plan limits still apply, so Rel.AI does not describe its usage as unlimited.

ChatGPT supplies the model and reasoning. Rel.AI supplies the local coding tools. Model availability and plan limits are controlled by ChatGPT and may change independently of Rel.AI.

For many everyday repository tasks, Rel.AI can take the place of a Codex-style workflow: it can help ChatGPT read the project, edit files, run commands and tests, inspect the result, and use Git. Rel.AI does not emulate Codex internals or claim to be the same product.

## Why other AI clients are not supported

Rel.AI does not currently support Claude, Cursor, Gemini, or other AI clients. The desktop app, Secure MCP Tunnel connection, work-session model, workspace permissions, checks, recovery, and publishing rules are designed and tested around ChatGPT. Supporting another client would require its own connection and compatibility contract.

## Local connection security

The local Rel.AI MCP service requires a bearer credential. The bundled tunnel client adds that credential when it forwards MCP traffic to Rel.AI. ChatGPT does not receive or need the local Rel.AI bearer token.

The public Rel.AI runtime no longer exposes a local OAuth authorization server. `/register`, `/authorize`, `/token`, legacy `/sse`, and legacy `/messages` are not supported connection paths.

## MCP protocol requirement

Modern MCP behavior targets `2026-07-28`. HTTP also retains the SDK-supported stateless ChatGPT `2025-11-25` initialize flow. Rel.AI does not issue `MCP-Session-Id`; JSON-RPC batches, removed tool aliases, and initialize-based stdio are not supported.

Native MCP Tasks are negotiated independently through `io.modelcontextprotocol/tasks`. Short bounded operations complete directly. When a client does not advertise Tasks, longer eligible operations can return a running result and continue under the same Rel.AI `work_id`; use `relai_work` with `action:"status"` to retrieve the eventual result.

## Reconnects and tool changes

A tunnel reconnect restores the connection only. It does not choose a workspace, pick a work session, repeat an uncertain edit, or mark repository work complete.

When the public tool schema changes, use the current ChatGPT integration refresh/review flow so ChatGPT observes the current Rel.AI tool surface. Application updates, tunnel connectivity, and host-side tool refresh are separate states.

## Troubleshooting

If ChatGPT cannot reach Rel.AI:

- confirm Rel.AI shows the Secure MCP Tunnel as Connected;
- confirm ChatGPT is associated with the same Tunnel ID shown in Rel.AI;
- replace the tunnel runtime API key in **Connection** if it was revoked;
- confirm the local connection port is available; and
- open **Diagnostics** for sanitized tunnel and local-service logs.

If a workspace cannot be found, confirm its alias under **Workspaces**, then retry a simple read-only request in ChatGPT. Opening `/mcp` in a normal browser is not a connection test; MCP clients use `POST /mcp`.
