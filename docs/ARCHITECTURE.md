# Rel.AI ChatGPT Web harness architecture

This document describes Rel.AI as the local agency/runtime harness around ChatGPT Web. MCP is the primary ChatGPT-facing tool transport, but the harness also owns local task state, repository intelligence, validation, Git, processes, memory and skills, observability, desktop lifecycle, and opt-in computer control.

The architecture records current runtime ownership and compatibility boundaries rather than historical connection modes.

## Harness responsibility boundary

| Layer | Owns | Does not own |
| --- | --- | --- |
| ChatGPT Web | Model selection, conversation, reasoning, product-side context, and deciding when to call tools | Local repository state, durable Rel.AI tasks, local process lifecycle, Git state, or host input devices |
| Rel.AI harness | Authorized local tools, work sessions, repository intelligence, edits, commands, validation evidence, Git, managed processes, skills/memory, observability, desktop lifecycle, and opt-in computer control | ChatGPT's hidden reasoning, model runtime, account limits, or conversation storage |
| OpenAI Secure MCP Tunnel | Private transport between ChatGPT and the selected Rel.AI desktop | Repository/task authority, local authorization policy, or completion state |

This separation is intentional: Rel.AI extends ChatGPT with a durable local execution environment without pretending to host or replace the ChatGPT runtime.

## Composition roots

The Rel.AI harness has three executable composition roots plus one external transport service:

| Host | Composition root | Responsibility |
| --- | --- | --- |
| Electron desktop | `electron/main.js` | Owns windows, tray, updater, the local HTTP service, Secure MCP Tunnel child lifecycle, encrypted tunnel credentials, notifications, and shutdown order. |
| HTTP MCP service | `bin/rel-ai-mcp-http.js` -> `src/httpServer.js` | Owns the authenticated local HTTP server, dashboard/API routes, modern and compatible stateless MCP routing, process cleanup, and telemetry lifecycle. |
| Stdio MCP service | `bin/rel-ai-mcp.js` -> `src/server.js` | Owns modern stdio MCP, connection-scoped principal state, native Task routing, process cleanup, and telemetry lifecycle. |
| OpenAI Secure MCP Tunnel | external service + bundled `tunnel-client` | Provides the private transport between ChatGPT and the selected desktop. It does not own repository state or Rel.AI task lifecycle. |

Composition roots construct resource owners. Pure validation, mapping, formatting, catalog, and projection functions are imported directly.

## Secure tunnel ownership

`electron/secure-tunnel-runtime.js` is the sole owner of the bundled OpenAI tunnel-client child process. It:

- resolves the reviewed platform binary from packaged resources;
- passes the configured tunnel ID and control-plane key;
- maps the tunnel's `main` channel to the private local `/mcp` service;
- injects the Rel.AI bearer token only on the local forwarding hop;
- binds tunnel-client health to a local ephemeral health address;
- waits for `/readyz` before reporting the connection as running; and
- terminates the child during restart or application shutdown.

`electron/tunnel-credentials.js` owns tunnel runtime API-key persistence through Electron `safeStorage`. The renderer sees only whether a key exists.

The canonical request path is:

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> bundled tunnel-client
  -> Authorization: Bearer <local Rel.AI token>
  -> private local POST /mcp
  -> normal MCP authorization and execution boundary
  -> configured workspace
```

The transport cannot select a repository by absolute path, bypass tool authorization, infer a `work_id`, or mark work complete.

## Canonical tool and action catalog

`src/tools/actionDefinitions.js` owns immutable tool definitions. `src/tools/actionCatalog.js` is the single owner of action mapping, authorization capability, approval policy, catalog construction, operation resolution, schemas, annotations, task scope, concurrency scope, execution class, dashboard metadata, and tool-surface version.

The public tool count is derived from the canonical runtime manifest (`release-manifest.json` records 15 for the current release). `src/tools/runtimeRegistry.js` contains executable function references only and deliberately does not become a second schema or policy source.

Connector result serialization remains operation-aware. It compacts safe fields, attaches `work_id` where required, and validates the selected action output schema before returning a result.

## MCP transports and compatibility

Modern MCP behavior targets protocol `2026-07-28`.

- `src/server.js` serves modern stdio and rejects initialize-based legacy lifecycle requests.
- `src/http/mcpTransport.js` serves stateless HTTP MCP with strict protocol, method, name, capability, Host/Origin, and `_meta` validation.
- `src/http/mcpAuth.js` accepts the private Rel.AI bearer token used by tunnel-client and explicit local clients.
- HTTP retains the SDK-supported stateless `2025-11-25` initialization flow required by supported ChatGPT clients.
- Native Task interception is owned by `src/mcp/transportTasks.js` before ordinary modern SDK dispatch.

The HTTP service does not expose the removed OAuth authorization server. `/register`, `/authorize`, `/token`, legacy `/sse`, and legacy `/messages` are absent.

## Task-state authorities

The task systems answer different lifecycle questions and remain separate:

| Concern | Authority |
| --- | --- |
| Live logical-task activity | `src/toolActivity.js` |
| Mutation generation and final-validation authority | `src/taskIntegrity.js` |
| Durable logical-task history | `src/taskHistoryStore.js` and `src/taskHistoryStorage.js` |
| Native MCP Task lifecycle | `src/mcp/nativeTaskService.js` |
| Canonical status mappings | `src/taskState.js` |
| Safe progress/event normalization | `src/taskObservability.js` and `src/taskEvents.js` |
| Dashboard read model | `src/http/dashboardData.js` |

Display state and 100% progress are never completion authority. Final completion depends on current validation evidence and explicit accepted completion.

### Workflow intelligence is derived, not authoritative

`src/workflow/` derives bounded guidance from existing runtime facts. It may discover package topology, classify task-owned scope and risk, summarize evidence, and recommend the cheapest useful next action. It cannot override task-integrity generations, authorization, path safety, Git containment, stale-write protection, workspace conflicts, or explicit completion authority. Derived completion readiness must use the same risk-based validation predicate as authoritative completion; it must not invent a stricter second policy.

### Restriction and recovery policy

Rel.AI restrictions must protect a concrete resource or failure mode. A `work_id`, validation gate, or approval prompt is not a general-purpose proof of safety.

- Require `work_id` when behavior genuinely depends on logical-task identity: repository mutation ownership, bounded command execution, process start/write, mutating UI actions, task-scoped tidy, task-scoped checkpoints, and authoritative validation/completion.
- Do not require a synthetic logical task for ordinary read/search/inspect/status/HTTP observation or for recovery operations whose real identity is already principal + workspace + resource ID. Artifact resource links use principal + authorized workspace + exact path + content hash + short TTL. Process read/list/stop and UI observation/stop recover from their own resource IDs under the authenticated workspace boundary.
- Native MCP Tasks and fallback operation IDs are transport mechanisms. They must never be converted into fake logical `work_id` requirements.
- Approval is reserved for the destructive/high-risk operation itself. Workspace reset and real Git push remain approval-gated. Do not add model-supplied magic confirmation strings as a second pseudo-consent layer when native approval already binds the exact request.
- Validation is risk-proportional. Read-only work needs none; low-risk documentation/text mutations may complete without validation unless an explicit check failed; behavior-changing source/config/build/security mutations require current-generation validation. A passed check becomes stale after relevant mutation.
- Recovery should use the narrowest real identity. Observation and cleanup should not force users to resurrect an unrelated or completed logical task when principal, workspace, and resource/session identity are sufficient.
- Cross-workspace continuity is supplemental context, not authority. Require multiple meaningful lexical matches before injecting portable task history; one generic overlap is insufficient.

Any new restriction must document the concrete attack/failure mode it prevents and add a regression at the public action boundary. Tests must include the least-privileged successful path, not only refusal cases. If the same policy decision appears in workflow guidance and authoritative execution, share one predicate instead of maintaining stricter duplicate logic.

## Electron ownership and IPC

Factories remain only where a module owns mutable state, a framework object, an operating-system resource, events, timers, or lifecycle. Examples include window managers, tray, updater, lifecycle manager, task activity runtime, shutdown coordinator, runtime log buffer, tunnel runtime, tunnel credential store, and diagnostic path owner.

`electron/ipc-handlers.js` owns sender-constrained setup, recovery, service lifecycle, dashboard-window management, notifications, and shared utilities. `electron/ipc-handlers-dashboard.js` owns the dashboard-only analytics, desktop-settings, updater, and diagnostics capabilities. There are no provider-switch, device-pairing, hosted-usage, or approval-token IPC channels.

Connection status is projected through the existing server-status path and updates only the relevant dashboard regions. A tunnel reconnect does not remount the application or restart unrelated managed developer processes.

## Durable persistence

`src/durableState.js` owns atomic local text/JSON promotion, restrictive file modes, optional backups, backup restoration, validation, and typed failures.

Local durable stores include configuration, connection profile, connection generations, task history/integrity, managed-process metadata, lifecycle state, and other repository-work state. The tunnel runtime API key is deliberately outside ordinary JSON configuration and is stored through Electron `safeStorage`.

## Compatibility exceptions

Retained compatibility is intentionally narrow:

- HTTP `2025-11-25` stateless initialization for supported ChatGPT clients;
- historical task-status aliases normalized on read; and
- stable internal operation names retained in audit/history/authorization evidence where they are data contracts rather than transport modes.

Compatibility code must remain isolated and tested. It must not create a second active source of schemas, policy, lifecycle, persistence, or connection transport.

## Current architecture metrics

| Metric | Current contract |
| --- | ---: |
| Public tools | Derived from canonical manifest (14 in current release) |
| Public actions | Derived from the canonical action catalog |
| Active public tool-schema source | 1 canonical catalog |
| MCP protocol | `2026-07-28` |
| Release schema version | 7 |
| Supported ChatGPT transport | OpenAI Secure MCP Tunnel only |
| Local MCP auth | Private bearer token |
| Public Rel.AI OAuth routes | 0 |
| Active transport provider modes | 1 |

## Validation and release boundaries

Architecture changes must preserve the public tool contract, local bearer authentication, tunnel-client provenance, work-session ownership, native Task parity, HTTP/stdio behavior, Electron sender isolation, managed-process cleanup, durable recovery, Git safeguards, and package integrity.

CI verifies source tests, generated assets, transport-removal contracts, tunnel-client provenance, Electron packaging, packaged bearer-authenticated MCP behavior, fuse policy, and release metadata. A real external Secure MCP Tunnel and logged-in ChatGPT integration require credentials and account state that are intentionally not embedded in CI; those remain explicit release acceptance evidence rather than something automated tests pretend to prove.
