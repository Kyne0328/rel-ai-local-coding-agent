# Connecting Rel.AI MCP to ChatGPT

Rel.AI turns ChatGPT web into a repository-capable coding agent by exposing one canonical 12-tool MCP surface through **OpenAI Secure MCP Tunnel**. ChatGPT provides the conversation and reasoning; repository files, Git operations, commands, validation, builds, and managed processes execute on the computer running Rel.AI.

## Configure the tunnel

1. Create an OpenAI Secure MCP Tunnel for this computer and create a runtime API key for it in OpenAI Platform.
2. Open Rel.AI MCP and enter the **Tunnel ID** and **runtime API key** in the first-run wizard or **Connection** page.
3. Keep Rel.AI running until Connection reports the Secure MCP Tunnel as **Connected**.
4. Add at least one local workspace before asking ChatGPT to inspect repository files.

Rel.AI encrypts the saved runtime API key with Electron `safeStorage`. The key is never returned to the renderer after storage; entering a new value replaces it.

## Connect ChatGPT

Create or reconnect the Rel.AI MCP integration in ChatGPT using the **Tunnel** connection option and associate it with the Tunnel ID shown in Rel.AI. If the integration already exists, reconnect or refresh it rather than creating a second copy unless you deliberately want a separate tunnel association.

After enabling Rel.AI MCP in a chat, start with a read-only request:

```text
Use Rel.AI MCP on workspace "myapp". Call relai_work with action "begin", retain the returned work_id, then call relai_snapshot with that work_id. Do not modify files yet.
```

Each independent repository objective receives its own principal-bound `work_id`. Tunnel connectivity, ChatGPT conversation identity, and repository name do not replace that work-session boundary.

## ChatGPT models and usage

Rel.AI uses ChatGPT's app/tool path, not Codex. OpenAI currently documents that:

- [Apps follow the normal ChatGPT rate limits for your plan](https://help.openai.com/en/articles/11487775-connectors-in). Rel.AI adds no separate per-tool usage quota.
- [Codex usage counts toward agentic usage](https://help.openai.com/en/articles/11369540-codex-and-chatgpt-plan-usage-limits). Rel.AI app calls therefore do not draw from the Codex agentic allowance.
- [GPT-5.6 Sol powers Medium, High, and Extra High reasoning on eligible plans](https://help.openai.com/en/articles/20001354-gpt-5-6-in-chatgpt).
- ChatGPT Apps are available with all models except Pro models. That means GPT-5.6 Sol High can be used when available to the plan, and Extra High can be used where the plan exposes it, but GPT-5.6 Sol Pro cannot be used with the Rel.AI app.

Model availability and plan limits are controlled by ChatGPT and may change independently of Rel.AI.

## Authentication boundary

The private local MCP service requires a bearer credential. The bundled tunnel client injects that bearer header when it forwards MCP traffic to Rel.AI. ChatGPT does not receive or need the local Rel.AI bearer token.

The public Rel.AI runtime no longer exposes a local OAuth authorization server. `/register`, `/authorize`, `/token`, legacy `/sse`, and legacy `/messages` are not supported connection paths.

## MCP protocol requirement

Modern MCP behavior targets `2026-07-28`. HTTP also retains the SDK-supported stateless ChatGPT `2025-11-25` initialize flow. Rel.AI does not issue `MCP-Session-Id`; JSON-RPC batches, removed tool aliases, and initialize-based stdio are not supported.

Native MCP Tasks are negotiated independently through `io.modelcontextprotocol/tasks`. Clients without Tasks support receive bounded synchronous execution for eligible operations.

## Reconnects and tool changes

A tunnel reconnect restores transport only. It does not select a workspace, infer a `work_id`, replay an uncertain mutation, or mark repository work complete.

When the public tool schema changes, use the current ChatGPT integration refresh/review flow so ChatGPT observes the current Rel.AI tool surface. Application updates, tunnel connectivity, and host-side tool refresh are separate states.

## Troubleshooting

If ChatGPT cannot reach Rel.AI:

- confirm Rel.AI shows the Secure MCP Tunnel as Connected;
- confirm ChatGPT is associated with the same Tunnel ID shown in Rel.AI;
- replace the tunnel runtime API key in **Connection** if it was revoked;
- confirm the local connection port is available; and
- open **Diagnostics** for sanitized tunnel and local-service logs.

If a workspace cannot be found, confirm its alias under **Workspaces**, then retry a read-only `relai_work begin` + `relai_snapshot` request. Opening `/mcp` in a normal browser is not a connection test; MCP clients use `POST /mcp`.
