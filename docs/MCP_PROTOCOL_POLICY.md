# MCP Protocol Policy

Rel.AI MCP targets protocol version `2026-07-28` through exact-pinned `@modelcontextprotocol/node` and `@modelcontextprotocol/server` version `2.0.0`. Its HTTP endpoint also serves the SDK-supported stateless `2025-11-25` initialize flow required by ChatGPT.

## Supported model

- Stateless `server/discover` negotiation for modern HTTP and stdio clients.
- Stateless HTTP `initialize` and `notifications/initialized` compatibility for ChatGPT, followed by ordinary tool and resource requests.
- Stdio transport through the MCP SDK.
- OAuth-protected HTTP on `/mcp`.
- `MCP-Protocol-Version`, `Mcp-Method`, and matching per-request `_meta` on every modern request.
- Optional client implementation metadata and required per-request client capabilities.
- No `MCP-Session-Id` or HTTP transport-session persistence.
- Origin and Host validation for HTTP.
- One principal-bound Rel.AI `work_id` per independent repository objective.
- Native MCP Tasks advertisement and routing on HTTP and stdio through the `io.modelcontextprotocol/tasks` extension.
- Direct completion for clearly bounded operations, native tasks for long or indeterminate eligible work, and bounded synchronous fallback when the client does not advertise Tasks.

Transport connections deliver requests but do not retain negotiation or work-session identity. They never select, merge, or complete repository work. Work remains owned by the authenticated principal and the opaque `work_id` returned from `relai_begin_work`.

The SDK classifies the request era before dispatch. Modern requests pass Rel.AI's strict header and `_meta` validation. ChatGPT-compatible requests use the SDK's stateless legacy transport and the same tool registry, OAuth identity, workspace policy, and principal-bound work-session enforcement. Compatibility is not a protocol session and does not translate or infer repository work identity.

## Unsupported compatibility surfaces

- Initialize-based lifecycle handling on stdio.
- Sessionful legacy HTTP operation or `MCP-Session-Id`.
- Legacy `/sse` and `/messages` routes.
- JSON-RPC request batches.
- Removed tool aliases.
- Transport-derived or conversation-derived work identity.
- Native task handles without explicit per-request Tasks capability negotiation.
- Responses to JSON-RPC notifications.

Unsupported protocol versions and modern-envelope mismatches fail closed. The HTTP compatibility path serves `2025-11-25` directly through the SDK rather than rewriting requests into `2026-07-28` envelopes.

## Identity policy

A repository `work_id`, native MCP `taskId`, and managed-process `processId` are independent identifiers.

- Work sessions are bound to the complete stable authenticated principal and configured workspace.
- OAuth principal identity includes issuer, client ID, subject, authorization context, resource, and scopes when available.
- Stdio uses a connection-scoped local principal. Active stdio tasks are terminalized as interrupted after process restart and cannot be adopted by another stdio connection.
- Unknown and unauthorized work or task IDs use non-disclosing errors.

## Recovery policy

Rel.AI fingerprints the full client-visible tool manifest. Each stateless discovery or list request observes the current manifest. The dashboard reports ready, active, recently active, authentication required, capability mismatch, degraded, and failed states separately.

When ChatGPT freezes or requires approval for a changed action snapshot, automatic transport recovery cannot approve that host-side change. Refresh the existing Rel.AI app actions, approve changes if prompted, and reconnect. Recreating the app is not the default recovery path.

## Version changes

A future protocol upgrade must update the SDK dependency, runtime compatibility metadata, release manifest, tests, packaged acceptance, documentation, and changelog together. Rel.AI does not advertise speculative protocol dates or custom replacements for the MCP lifecycle.
