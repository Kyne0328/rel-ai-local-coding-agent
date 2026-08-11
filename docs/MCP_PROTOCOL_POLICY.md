# MCP Protocol Policy

## Version boundary

- Modern MCP protocol: `2026-07-28`.
- Stateless ChatGPT HTTP compatibility: `2025-11-25`.
- Rel.AI Cloud device protocol: version `1`, minimum compatible version `1`.
- Generated public schema version: `3`.

The HTTP compatibility path exists because supported ChatGPT clients may use the SDK-supported stateless initialize lifecycle before ordinary tool and resource requests. Authentication, principal construction, request budgets, telemetry, tool policy, workspace ownership, and explicit work-session identity remain shared with the modern transport.

Compatibility is protected by `test/chatgpt-local-compat-smoke.mjs`, while `test/mcp-stdio-legacy-rejection.mjs` verifies that stdio remains modern-only. Strict modern headers and envelopes are protected separately.

**Removal condition:** remove the legacy adapter only after supported ChatGPT clients no longer require the `2025-11-25` stateless initialize flow and packaged connector acceptance proves the modern flow end to end. No calendar date is assigned without that product evidence.

## Supported model

- Stateless `server/discover` negotiation for modern HTTP and stdio clients.
- Stateless HTTP `initialize` and `notifications/initialized` compatibility for ChatGPT, followed by ordinary tool/resource requests.
- Stdio transport through the MCP SDK.
- OAuth-protected HTTP on `/mcp`.
- `MCP-Protocol-Version`, `Mcp-Method`, and matching per-request `_meta` on modern requests.
- Optional client implementation metadata and required per-request client capabilities.
- No `MCP-Session-Id` or HTTP transport-session persistence.
- Origin/Host validation for local HTTP and issuer/resource validation for Cloud OAuth.
- One principal-bound Rel.AI `work_id` per independent repository objective.
- Native MCP Tasks advertisement/routing through `io.modelcontextprotocol/tasks`.
- Direct completion for clearly bounded operations, native tasks for long/indeterminate eligible work, and bounded synchronous fallback when Tasks are not advertised.

Transport connections deliver requests but do not retain work-session identity. They never select, merge, or complete repository work. Work remains owned by the authenticated principal and the opaque `work_id` returned from `relai_work` with `action:"begin"`.

## Rel.AI Cloud public contract

Rel.AI Cloud adds a hosted routing boundary; it does not replace the local MCP execution boundary.

1. ChatGPT authenticates to Rel.AI Cloud.
2. The hosted service selects only an authorized paired desktop using server-owned state that is intentionally outside this repository.
3. The selected desktop receives a validated, bounded MCP request over its authenticated outbound connection.
4. `src/gateway/localExecution.js` invokes the normal local MCP execution boundary using the paired identity and workspace alias.
5. Repository files, commands, and results are produced locally and returned through the bounded Cloud response path.

Absolute local paths are not a Cloud routing primitive. Workspace aliases are the public routing handle and are resolved only on the selected desktop.

### Identity and device contract

- A desktop generates its device private key locally and protects it with Electron `safeStorage`; only public identity material is registered remotely.
- Hosted account/device authorization and ownership are server-controlled and are not defined by caller-supplied MCP arguments.
- Repository `work_id`, native MCP `taskId`, managed-process `processId`, and device identity remain separate identifiers.
- Work sessions remain bound to the authenticated local execution context plus configured workspace after routing.
- Unknown or unauthorized work, task, and device identifiers use non-disclosing errors.

### Device protocol and synchronization

The Cloud device protocol is versioned independently from the MCP tool schema. A selected desktop must report compatible protocol metadata before forwarding; incompatible clients receive `DEVICE_UPDATE_REQUIRED` instead of a request they cannot safely execute.

Authentication, ChatGPT tool refresh, application update availability, and device-protocol compatibility are separate states. Public UI may report `reauthentication_required`, `tool_refresh_required`, `device_update_required`, or `current`, but the hosted observation and persistence implementation behind those states is intentionally private.

`contracts/cloud/mcp-manifest.json` is the committed public compatibility artifact for the ChatGPT-facing tool surface. A schema or device-protocol change must update the corresponding public contract and release metadata intentionally.

### Request retry and cancellation behavior

Read-only requests may be retried only when the hosted service can establish that retry is safe. Mutating requests are never blindly replayed after an ambiguous execution boundary. Cancellation, expiry, offline-device, compatibility, selection, and rate-limit failures return bounded structured states rather than causing local fallback execution on an unintended device.

### Usage policy

The desktop may display exact Rel.AI-observed traffic/execution summaries such as request counts, tool outcomes, bytes, duration, active days, and device/tool/workspace breakdowns. These metrics are not ChatGPT model-token or billing counts. Hosted aggregation and retention implementation details are outside this public repository.
## Unsupported compatibility surfaces

- Initialize-based lifecycle handling on stdio.
- Sessionful legacy HTTP operation or `MCP-Session-Id`.
- Legacy `/sse` and `/messages` routes.
- JSON-RPC request batches.
- Removed tool aliases.
- Transport-, device-, or conversation-derived repository work identity.
- Native task handles without explicit per-request Tasks capability negotiation.
- Responses to JSON-RPC notifications.
- Using OAuth reauthentication as an implicit tool-schema refresh.
- Using a tool-schema refresh as an implicit device update.

Unsupported protocol versions and modern-envelope mismatches fail closed. The HTTP compatibility path serves `2025-11-25` directly through the SDK rather than rewriting requests into `2026-07-28` envelopes.

## Version changes

A future MCP, schema, or device-protocol upgrade must update the correct independent contract: implementation, public Cloud contract, runtime compatibility/release metadata, tests, package acceptance, documentation, and changelog as applicable. Rel.AI does not advertise speculative protocol dates, schema versions, or custom replacements for the MCP lifecycle.
