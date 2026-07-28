# MCP Protocol Policy

Rel AI MCP targets protocol version `2026-07-28` through exact-pinned `@modelcontextprotocol/node` and `@modelcontextprotocol/server` version `2.0.0`.

## Supported model

- Stateless stdio and HTTP request handling
- `server/discover`
- Explicit protocol version, client identity, capabilities, method, and named target
- Explicit logical Rel AI task IDs
- OAuth-protected `POST /mcp`
- No initialize handshake or transport session
- No `Mcp-Session-Id`
- No legacy SSE or `/messages` routes
- No compatibility aliases for earlier protocol models

Older clients must use an earlier Rel AI release. The repository must not reintroduce compatibility branches without a named supported consumer and a product decision.

The feature-flagged native Tasks canary is documented in `docs/NATIVE_MCP_TASKS_PROBE.md`. It is diagnostic and does not change the default durable `operationTaskId` workflow.

## Conformance gate

Before publishing a release that claims final protocol conformance:

1. Record the authoritative final specification tag and commit.
2. Run the official conformance suite when available.
3. Run external-client tests over stdio and OAuth-protected stateless HTTP.
4. Map every advertised capability to a specification section and automated test.
5. Confirm that application-level durable operations are not described as native MCP Tasks unless the formal extension is negotiated and implemented.

SDK package stability alone is not sufficient evidence that the specification repository has published its final release artifact.
