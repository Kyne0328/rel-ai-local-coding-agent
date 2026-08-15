# MCP Protocol Policy

## Version boundary

- Modern MCP protocol: `2026-07-28`.
- Stateless ChatGPT HTTP compatibility: `2025-11-25`.
- Release/tool schema version: `7`.

The HTTP compatibility path exists because supported ChatGPT clients may use the SDK-supported stateless initialize lifecycle before ordinary tool and resource requests. Authentication, principal construction, request budgets, telemetry, tool policy, workspace ownership, and explicit work-session identity remain shared with the modern transport.

Compatibility is protected by the HTTP/ChatGPT smoke tests, while stdio tests verify that stdio remains modern-only. Strict modern headers and request envelopes are protected separately.

**Removal condition:** remove the `2025-11-25` HTTP compatibility adapter only after supported ChatGPT clients no longer require it and packaged connector acceptance proves the modern flow end to end.

## Supported model

- Stateless `server/discover` negotiation for modern HTTP and stdio clients.
- Stateless HTTP `initialize` and `notifications/initialized` compatibility for ChatGPT.
- Stdio through the MCP SDK.
- Bearer-authenticated private HTTP MCP at `POST /mcp`.
- `MCP-Protocol-Version`, `Mcp-Method`, and matching per-request `_meta` on modern requests.
- Optional client implementation metadata and required per-request client capabilities.
- No `MCP-Session-Id` or HTTP transport-session persistence.
- Host/Origin validation for the private local HTTP service.
- One principal-bound Rel.AI `work_id` per independent repository objective.
- Native MCP Tasks advertisement/routing through `io.modelcontextprotocol/tasks` on the modern protocol route only.
- Direct completion for clearly bounded operations, native tasks for long/indeterminate eligible work, and bounded synchronous fallback when Tasks are not advertised.

### Native Tasks capability policy

Rel.AI keeps one current tool surface regardless of whether a connected MCP client advertises the Tasks extension. Clients that do not advertise `io.modelcontextprotocol/tasks` receive ordinary synchronous results for the same current tools; there are no legacy tool aliases, compatibility operation names, or client-name heuristics.

Native Tasks activate only when the request explicitly advertises the supported Tasks capability. The eligibility metadata describes which current operations may use that execution mode. Protocol-version negotiation remains transport interoperability, not a second or legacy tool API.

Keep `nativeTaskService`, `nativeToolTasks`, `transportTasks`, task eligibility metadata, and their protocol tests while Rel.AI supports Native MCP Tasks.

Transport connections deliver requests but do not retain work-session identity. They never select, merge, replay, or complete repository work.

## Secure MCP Tunnel boundary

OpenAI Secure MCP Tunnel is transport, not an alternate MCP implementation.

1. ChatGPT sends MCP traffic through the configured OpenAI tunnel.
2. The bundled `tunnel-client` forwards the `main` channel to the private local Rel.AI `/mcp` service.
3. Tunnel-client injects the private Rel.AI bearer header for that local hop.
4. The normal MCP authorization, request validation, tool policy, task ownership, and workspace boundaries execute locally.
5. Results return through the same tunnel transport.

The tunnel ID, tunnel-client process, ChatGPT conversation, Rel.AI `work_id`, native MCP `taskId`, and managed-process `processId` remain independent identifiers.

A transport reconnect may restore connectivity but may not replay an ambiguous mutation. The local task-integrity model remains authoritative about mutation ownership and completion evidence.

## Unsupported compatibility surfaces

- Initialize-based lifecycle handling on stdio.
- Sessionful legacy HTTP operation or `MCP-Session-Id`.
- Legacy `/sse` and `/messages` routes.
- Removed local OAuth routes `/register`, `/authorize`, and `/token`.
- JSON-RPC request batches.
- Removed tool aliases.
- Transport- or conversation-derived repository work identity.
- Native task handles without explicit per-request Tasks capability negotiation.
- Responses to JSON-RPC notifications.

Unsupported protocol versions and modern-envelope mismatches fail closed. The HTTP compatibility path serves `2025-11-25` directly through the SDK rather than rewriting it into a `2026-07-28` envelope.

## Version changes

A future MCP or public schema upgrade must update the implementation, release metadata, tests, package acceptance, documentation, and changelog together. Rel.AI does not advertise speculative protocol dates or custom replacements for MCP lifecycle behavior.
