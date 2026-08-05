# Rel.AI MCP architecture

This document describes the current production architecture after the repository simplification work. It records ownership and compatibility boundaries; it is not a roadmap for speculative abstractions.

## Composition roots

Rel.AI has three executable composition roots:

| Host | Composition root | Responsibility |
| --- | --- | --- |
| Electron desktop | `electron/main.js` | Owns Electron windows, tray, updater, local HTTP service, managed ngrok process, desktop lifecycle, notifications, and shutdown order. |
| HTTP MCP service | `bin/rel-ai-mcp-http.js` → `src/httpServer.js` | Owns the authenticated HTTP server, dashboard routes, OAuth routes, modern and legacy MCP request routing, process cleanup, and telemetry lifecycle. |
| Stdio MCP service | `bin/rel-ai-mcp.js` → `src/server.js` | Owns the modern stdio transport, connection-scoped principal, native Task transport wrapper, process cleanup, and telemetry lifecycle. |

Composition roots construct resource owners. Pure validation, mapping, formatting, catalog, and projection functions are imported directly.

## Canonical tool and action catalog

`src/tools/actionCatalog.js` is the single owner of action-level metadata for the public MCP surface:

- 12 public tools;
- 35 public actions;
- public and internal operation identity;
- input and output schemas;
- action fields and required fields;
- annotations and execution behavior;
- authorization capability;
- approval policy;
- task and concurrency scope;
- native Task eligibility;
- dashboard and manifest metadata;
- the single tool-surface version.

`src/tools/runtimeRegistry.js` retains one executable-only operation-to-function map. This is a deliberate cycle boundary: handlers depend on status and schema code that ultimately reads the catalog. The map contains executable function references only; it does not own schemas, policy, versions, or action metadata.

Connector result serialization remains operation-aware in the tool execution path. It compacts safe fields, applies public cleanup, attaches `work_id`, and validates the selected action output schema.

## MCP transports and compatibility

Modern MCP protocol behavior targets `2026-07-28`.

- `src/server.js` serves modern stdio and rejects initialize-based legacy lifecycle requests.
- `src/http/mcpTransport.js` serves modern stateless HTTP requests with strict protocol, method, name, capability, and `_meta` validation.
- Native Task interception is owned by `src/mcp/transportTasks.js` before ordinary modern SDK dispatch.
- Authentication, principal construction, request limits, accounting, manifest observation, telemetry, and top-level errors are shared transport concerns.

HTTP also retains the SDK-supported stateless `2025-11-25` flow required by current ChatGPT clients. That path is isolated behind `handleLegacyMcpRequest`. It does not create transport-session identity, infer repository work identity, or enable legacy stdio behavior. Removal conditions and protecting tests are documented in `docs/MCP_PROTOCOL_POLICY.md`.

## Native MCP Tasks

`src/mcp/nativeTaskService.js` is the lifecycle and persistence authority for native MCP Tasks. It owns:

- IDs and protocol statuses;
- principal and logical-task ownership;
- bounded result and error records;
- input requirements;
- executor association and cancellation acknowledgement;
- restart policy, TTL, persistence, and pruning.

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

## Electron ownership and IPC

Factories remain only where a module owns mutable state, a framework object, an operating-system resource, events, timers, or lifecycle. Examples include window managers, tray, updater, lifecycle manager, task activity runtime, shutdown coordinator, runtime log buffer, approval-token manager, and diagnostic path owner.

Stable stateless behavior such as desktop status normalization and settings normalization uses named functions and direct imports.

`electron/ipc-handlers.js` keeps one composition function and eight capability-specific registration functions:

- setup;
- recovery;
- service lifecycle;
- dashboard window;
- desktop settings;
- updater;
- diagnostics;
- shared utilities.

Each capability registration receives only its own guards and actions. Sender-window validation, payload limits, URL restrictions, and asynchronous failure policy remain at registration. The preload channel names and renderer contract remain unchanged.

## Durable persistence

`src/durableState.js` owns atomic text and JSON promotion, restrictive file modes, optional backups, backup restoration, validation, and typed read/write failures.

Simple JSON stores use that primitive where their semantics match:

- managed worktree registry: `src/worktreeManager.js`;
- connection generations: `src/mcp/connectionGenerations.js`;
- configuration and connection profile;
- task history records and task integrity records;
- managed-process metadata where applicable.

The worktree registry validates its full versionless entry shape and never converts corruption into an empty registry. Connection generation records validate version 1, preserve unchanged-file avoidance, and never persist invalid numeric generations.

Specialized stores remain specialized when they require locking, journaling, issuer-specific OAuth behavior, native Task semantics, or process recovery. No generic repository or storage service wraps them.

## Compatibility exceptions

The following retained compatibility is intentional and bounded:

- HTTP `2025-11-25` stateless lifecycle support for current ChatGPT clients;
- read tolerance for old native Task records containing `internal.compatibilityOperation`, bounded by the tool-task TTL and documented in `src/mcp/nativeToolTasks.js`;
- historical task-status aliases normalized on read in `src/taskState.js`;
- stable internal operation names retained in audit, task history, authorization evidence, and diagnostics.

Compatibility code must remain isolated, tested, and documented with a removal condition. It must not create a second active source of schemas, policy, lifecycle, or persistence behavior.

## Current architecture metrics

| Metric | Current contract |
| --- | ---: |
| Public tools | 12 |
| Public actions | 35 |
| Active action metadata sources | 1 canonical catalog |
| Tool-surface versions | 1 |
| Broad capability-level IPC dependency bags | 0 |
| Confirmed stateless Electron manager factories | 0 |
| Confirmed forwarding wrappers | 0 |
| Generic operation-task façade | 0 |
| Targeted manual persistence writers | 0 |
| IPC channels | 33 |
| Discovery schema size | 28,383 bytes |

The top-level Electron IPC composition call and the executable-only handler map are not additional capability metadata or policy owners.

## Validation and release boundaries

Architecture changes must preserve the public contract, OAuth authorization, ownership non-disclosure, native Task parity, HTTP/stdio behavior, Electron sender isolation, managed-process cleanup, persistent recovery, and Git safeguards.

Release validation is defined by repository scripts and CI. Windows installer behavior, Authenticode identity, live ChatGPT OAuth approval, external endpoint reachability, and production updater delivery still require the documented manual or protected-CI environments; local tests do not fabricate those results.
