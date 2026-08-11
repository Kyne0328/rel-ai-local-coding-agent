# Rel.AI MCP architecture

This document describes the current production architecture after the repository simplification and shared-gateway implementation. It records ownership and compatibility boundaries; it is not a roadmap for speculative abstractions or proof that a hosted production deployment is currently published.

## Composition roots

Rel.AI has four executable composition roots:

| Host | Composition root | Responsibility |
| --- | --- | --- |
| Electron desktop | `electron/main.js` | Owns Electron windows, tray, updater, the one local HTTP service, Cloud-or-Direct public-connection lifecycle, desktop identity storage, notifications, and shutdown order. |
| Rel.AI Cloud service | external private service | Owns hosted authorization and routing. Its implementation and production infrastructure intentionally live outside this public repository. |
| HTTP MCP service | `bin/rel-ai-mcp-http.js` -> `src/httpServer.js` | Owns the authenticated local HTTP server, dashboard routes, Direct OAuth routes, modern and legacy MCP request routing, process cleanup, and telemetry lifecycle. |
| Stdio MCP service | `bin/rel-ai-mcp.js` -> `src/server.js` | Owns the modern stdio transport, connection-scoped principal, native Task transport wrapper, process cleanup, and telemetry lifecycle. |

Composition roots construct resource owners. Pure validation, mapping, formatting, catalog, and projection functions are imported directly.

The Cloud path intentionally keeps the local service separate from public-connectivity lifecycle. `electron/public-connection-runtime.js` owns either one `GatewayClient` or one managed-ngrok child. It has no local-server or BrowserWindow restart authority, so a gateway WebSocket reconnect cannot restart the local MCP server or remount the application.

## Canonical tool and action catalog

`src/tools/actionDefinitions.js` owns the immutable internal and public tool definitions. `src/tools/actionCatalog.js` is the single owner of action mapping, authorization capability, approval policy, catalog construction, and operation resolution for the public MCP surface:

- 12 public tools;
- public and internal operation identity;
- input and output schemas;
- action fields and required fields;
- annotations and execution behavior;
- authorization capability;
- approval policy;
- task and concurrency scope;
- native Task eligibility;
- dashboard and generated-gateway manifest metadata;
- the single tool-surface version.

`src/tools/runtimeRegistry.js` retains one executable-only operation-to-function map. This is a deliberate cycle boundary: handlers depend on status and schema code that ultimately reads the catalog. The map contains executable function references only; it does not own schemas, policy, versions, or action metadata.

`scripts/generate-cloud-contract.mjs` derives the committed `contracts/cloud/mcp-manifest.json` artifact from the same canonical public tool source. `scripts/verify-cloud-contract.mjs` compares public schema evolution against a real Git base. The private cloud service consumes this public contract without exposing its implementation here.

Connector result serialization remains operation-aware in the tool execution path. It compacts safe fields, applies public cleanup, attaches `work_id`, and validates the selected action output schema.

## MCP transports and compatibility

Modern MCP protocol behavior targets `2026-07-28`.

- `src/server.js` serves modern stdio and rejects initialize-based legacy lifecycle requests.
- `src/http/mcpTransport.js` serves modern stateless local HTTP requests with strict protocol, method, name, capability, and `_meta` validation.
- The private Rel.AI Cloud service validates public Cloud MCP ingress and routes authenticated requests to an eligible paired desktop; its implementation is not part of this repository.
- Native Task interception is owned by `src/mcp/transportTasks.js` before ordinary modern SDK dispatch.
- Authentication, principal construction, request limits, accounting, telemetry, tool policy, and workspace ownership remain shared local MCP concerns.

HTTP also retains the SDK-supported stateless `2025-11-25` flow required by current ChatGPT clients. That compatibility does not create transport-session identity, infer repository work identity, or enable legacy stdio behavior. Removal conditions and protecting tests are documented in `docs/MCP_PROTOCOL_POLICY.md`.

## Rel.AI Cloud boundary

The canonical public Cloud flow is:

```text
ChatGPT custom app
  -> Rel.AI Cloud
  -> authenticated Rel.AI desktop connection
  -> electron/gateway-client.js
  -> src/gateway/localExecution.js
  -> normal local MCP execution boundary
  -> configured local workspace
```

This repository intentionally contains only the client-side Cloud contract and local execution adapter. Hosted authorization, routing, persistence, abuse controls, production configuration, deployment code, and server-only tests live in the private `rel-ai-cloud` repository.

### Public client contract

The desktop generates a device key pair locally and keeps the private key protected by Electron `safeStorage`. Only public identity material and bounded compatibility metadata are sent during pairing. The desktop connects outward to Rel.AI Cloud, advertises workspace aliases rather than local filesystem paths, validates incoming protocol frames, and executes routed MCP requests through the same local safety boundary used by Direct mode.

`src/gateway/protocol.js` is intentionally public because the desktop must encode and validate the wire contract. `contracts/cloud/mcp-manifest.json` is intentionally public because ChatGPT-facing tool names and schemas are a compatibility contract. Neither file is an authorization secret.

Repository files, absolute workspace paths, Git operations, command execution, tests, builds, and managed processes remain local. A copied client is not trusted merely because it knows the Cloud hostname or protocol; hosted authorization remains server-controlled.

### Schema, device, and update synchronization

`release-manifest.json` carries the public application/MCP/tool-surface contract plus schema and device-protocol compatibility metadata. The desktop keeps authentication state, tool-refresh state, application-update state, and device-protocol compatibility as separate state machines so one does not falsely imply another.

The public repository proves the manifest it expects and validates client compatibility. Server-side observation, enforcement, persistence, routing, and production policy are private implementation details.

### Usage and privacy

The desktop may request Rel.AI-observed usage summaries from the hosted service for display in the Usage page. Public UI contracts describe the metrics shown, but the hosted aggregation implementation and storage model are intentionally private. Rel.AI usage metrics are gateway traffic/execution metrics, not ChatGPT model-token or billing estimates.
## Native MCP Tasks

`src/mcp/nativeTaskService.js` is the lifecycle and persistence authority for native MCP Tasks. It owns IDs, protocol statuses, principal/logical-task ownership, bounded result/error records, input requirements, executor association, cancellation acknowledgement, restart policy, TTL, persistence, and pruning.

`src/mcp/nativeToolTasks.js` is the narrow production adapter for tool execution. It exposes only create, complete, fail, signal, and prune operations and supplies tool-specific origin metadata. It does not define a second lifecycle model.

Rel.AI `work_id`, native MCP `taskId`, and managed-process `processId` remain independent identifiers.

## Task-state authorities and projections

The task systems remain separate because they answer different trust and lifecycle questions:

| Concern | Authority |
| --- | --- |
| Live logical-task activity | `src/toolActivity.js` |
| Integrity, mutation generation, and final-validation authority | `src/taskIntegrity.js` |
| Durable logical-task history | `src/taskHistoryStore.js` and `src/taskHistoryStorage.js` |
| Native MCP Task lifecycle | `src/mcp/nativeTaskService.js` |
| Canonical status mappings and terminal rules | `src/taskState.js` |
| Safe progress, event, and metadata normalization | `src/taskObservability.js` and `src/taskEvents.js` |
| Dashboard read model | `src/http/dashboardData.js` |
| Browser display adapters | `src/ui/task-identity.js` and task UI components |

Display state and 100% progress are never treated as validation or completion authority. Final completion continues to depend on `src/taskIntegrity.js` and explicit accepted completion.
### Workflow intelligence is derived, not authoritative

`src/workflow/` derives bounded workflow guidance from existing runtime facts. It may discover nested package topology, classify task-owned scope and risk, summarize safe evidence, and recommend the cheapest useful next action. It is advisory: workflow stage, risk, evidence summaries, and recommendations cannot override task-integrity generations, authorization, path or sensitive-file safety, Git containment, stale-write protection, workspace conflicts, or explicit completion authority. `src/taskIntegrity.js` remains the authority for mutation ownership and final-validation freshness, while durable task history remains observational state rather than a second completion system.

## Electron ownership and IPC

Factories remain only where a module owns mutable state, a framework object, an operating-system resource, events, timers, or lifecycle. Examples include window managers, tray, updater, lifecycle manager, task activity runtime, shutdown coordinator, runtime log buffer, approval-token manager, gateway device identity, and diagnostic path owner.

`electron/ipc-handlers.js` keeps one composition function and nine capability-specific registration functions:

- setup;
- recovery;
- service lifecycle;
- dashboard window;
- Cloud gateway controls;
- desktop settings;
- updater;
- diagnostics;
- shared utilities.

Every channel remains sender-window constrained. Setup-only Cloud actions cannot be called by the dashboard, dashboard gateway/device/usage controls cannot be called by setup or unknown renderers, and recovery/credential values cross IPC only through explicit user actions. Passive gateway status contains no principal ID, private key, recovery secret, or pairing poll token.

Cloud status is pushed through `desktop:gateway-status` and updates only the relevant Connection region. Gateway reconnects do not use the structural dashboard rerender path.

## Durable persistence

`src/durableState.js` owns atomic local text/JSON promotion, restrictive file modes, optional backups, backup restoration, validation, and typed read/write failures.

Local stores using that primitive include managed worktree registration, connection generations, configuration/connection profile, task history/integrity, and managed-process metadata where applicable.

Hosted Cloud persistence is outside this repository. Local durable stores remain owned by `src/durableState.js`; the public client does not depend on or expose the hosted storage implementation.

## Compatibility exceptions

The following retained compatibility is intentional and bounded:

- HTTP `2025-11-25` stateless lifecycle support for current ChatGPT clients;
- Direct managed-ngrok mode and legacy ngrok-config migration;
- read tolerance for old native Task records containing `internal.compatibilityOperation`, bounded by the tool-task TTL and documented in `src/mcp/nativeToolTasks.js`;
- historical task-status aliases normalized on read in `src/taskState.js`;
- stable internal operation names retained in audit, task history, authorization evidence, and diagnostics.

Compatibility code must remain isolated, tested, and documented with a removal condition. It must not create a second active source of schemas, policy, lifecycle, or persistence behavior.

## Current architecture metrics

| Metric | Current contract |
| --- | ---: |
| Public tools | 12 |
| Active public tool-schema source | 1 canonical catalog |
| Generated Cloud manifest source | Canonical catalog-derived |
| MCP protocol | `2026-07-28` |
| Release schema version | 3 |
| Gateway device protocol | 1 |
| Minimum compatible gateway device protocol | 1 |
| Electron IPC channels under exact sender-policy test | 49 |
| Cloud/Direct public-connection owner | 1 runtime |
| Durable Cloud request bodies | 0 |
| Durable Cloud result bodies | 0 |

## Validation and release boundaries

Architecture changes must preserve the public tool contract, OAuth grant/principal binding, device isolation, ownership non-disclosure, native Task parity, HTTP/stdio behavior, Electron sender isolation, managed-process cleanup, persistent recovery, Direct fallback, and Git safeguards.

CI verifies the public Cloud contract/schema policy, desktop gateway regressions, packaging isolation, and native packaged gateway acceptance. Private Worker tests and deployment validation run in the private `rel-ai-cloud` repository. The Windows packaged acceptance uses a localhost fake gateway against the actual unpacked Electron desktop to prove device challenge authentication, workspace advertisement, routed local execution, and graceful shutdown without real Cloudflare or ChatGPT credentials. Linux repeats the packaged acceptance in its native CI environment.

Those gates do not claim that a production Rel.AI Cloud deployment is live, that ChatGPT has accepted a new tool snapshot, that a real external tunnel is reachable, or that a logged-in ChatGPT UI flow has been manually approved. Installer lifecycle, live ChatGPT administration, production hosting, external reachability, and updater delivery require their documented release/deployment evidence.
