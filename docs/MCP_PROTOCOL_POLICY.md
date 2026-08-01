# MCP Protocol Policy

Rel.AI MCP targets protocol version `2026-07-28` through exact-pinned `@modelcontextprotocol/node` and `@modelcontextprotocol/server` version `2.0.0`.

## Supported model

- Stateless `server/discover` negotiation
- Stdio transport through the MCP SDK
- OAuth-protected HTTP on `/mcp`
- `MCP-Protocol-Version`, `Mcp-Method`, and matching per-request `_meta` on native `2026-07-28` HTTP requests
- SDK-managed stateless HTTP compatibility for ChatGPT clients that still negotiate the frozen `2025-11-25` lifecycle through `initialize`
- Optional client implementation metadata and required per-request client capabilities on native `2026-07-28` requests
- No `MCP-Session-Id` or HTTP transport-session persistence
- Origin and Host validation for HTTP
- One logical Rel.AI `task_id` per independent user objective
- Native MCP Tasks advertisement and routing on HTTP when the request advertises `io.modelcontextprotocol/tasks`

Transport connections deliver requests but do not retain negotiation or task state. They never select, merge, or complete a logical coding task. Logical work remains owned only by the opaque `task_id` returned from `relai_start_task`.

## Unsupported compatibility surfaces

- Legacy lifecycle support on stdio or through custom Rel.AI protocol code; the HTTP bridge is delegated entirely to the pinned MCP SDK
- Legacy `/sse` and `/messages` routes
- JSON-RPC request batches
- Removed tool aliases
- Transport-derived or conversation-derived task identity
- MCP Tasks advertisement on stdio until the pinned SDK stdio router dispatches extension methods

## Recovery policy

Rel.AI fingerprints the full client-visible tool manifest. Each stateless discovery or list request observes the current manifest. The dashboard reports waiting, ready, capability mismatch, reauthentication required, degraded, and failed states separately.

When ChatGPT freezes or requires approval for a changed action snapshot, automatic transport recovery cannot approve that host-side change. The dashboard gives the exact manual action: refresh the existing Rel.AI app actions, approve changes if prompted, and reconnect. Recreating the app is not the default recovery path.

## Version changes

A future protocol upgrade must update the SDK dependency, runtime compatibility metadata, release manifest, tests, packaged acceptance, documentation, and changelog together. Rel.AI does not advertise speculative protocol dates or custom replacements for the MCP lifecycle.
