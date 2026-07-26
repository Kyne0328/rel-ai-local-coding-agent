# Rel AI MCP Multi-Chat Task Isolation and Completion Investigation

**Date:** 2026-07-26
**Scope:** MCP logical task identity, concurrent tool routing, task persistence, activity ownership, and `complete_task` semantics
**Repository:** Rel AI MCP

## 1. Executive summary

The defect was caused by several layers treating a transport-derived session scope or workspace as if it were the identity of one logical user task.

The previous implementation had four mutually reinforcing failure mechanisms:

1. `src/toolActivity.js` kept one active task per scope and could reattach or absorb weak transport scopes by workspace. Two unrelated ChatGPT conversations that shared or changed transport context could therefore be represented as one task.
2. `src/policyResolver.js` stored one policy file per workspace. Starting a second task in the same workspace overwrote the first task's baseline and ownership record.
3. `src/tools/completion.js` resolved completion evidence through workspace/session history rather than requiring one stable logical task identity. Validation or mutations from another task could affect the result.
4. `src/taskHistoryStore.js` and `src/taskHistory.js` stitched weak task fragments by workspace and time, persisting the grouping error after the immediate request ended.

The correction introduces an explicit opaque logical task identity:

```text
relai_start_task(workspace)
-> returns task_id

every later task-scoped call
-> includes the same task_id

relai_complete_task(task_id)
-> resolves, validates, and completes only that task
```

The new identity is a generated UUID and does not depend on an undocumented ChatGPT conversation ID. Multiple logical tasks may share one MCP connection, one client instance, or one server process. Transport identity remains useful for diagnostics, but it is no longer used as task identity.

`complete_task` is now task-specific, retry-safe, and restart-resumable. A duplicate completion returns the original completion result. Completing task A leaves task B active. If another task changes the same physical workspace after task A's validation, task A receives `TASK_PERSISTENCE_CONFLICT` and must revalidate against the current worktree; it is not allowed to complete against stale code.

### User impact before correction

- Unrelated conversations could appear as one session.
- A conversation could inherit another task's changed-file ownership.
- Validation from one task could be considered when completing another.
- Mutations from another task could unexpectedly invalidate completion.
- `complete_task` could resolve no task, the wrong task, or an ambiguously merged task.
- Completion or cleanup of one task could clear workspace-scoped state needed by another.

### Remaining limitation

The repository implementation, deterministic MCP harness, full 106-file suite, unpacked Windows Electron build, and read-only packaged-layout verification pass. The normal installed application was deliberately not restarted, replaced, uninstalled, or exercised through live ChatGPT during this investigation. Final live-client acceptance therefore still requires a disposable Windows environment and real ChatGPT connector verification. The core defect is resolved in source, regression coverage, and packaged source layout, but live production-client verification remains pending.

## 2. Reproduction report

### Environment

- One Rel AI MCP repository and server implementation.
- One simulated MCP client connection using JSON-RPC `tools/call` messages.
- Two or more independent logical objectives.
- Same-workspace and different-workspace variants.
- Controlled concurrency using a filesystem barrier rather than timing-dependent sleeps.
- Persistent state stored in isolated temporary test directories.
- No live ChatGPT dependency required for regression coverage.

### Direct runtime observation

At the start of the investigation, the live Rel AI status for this conversation reported session-owned files from another concurrent task, including `src/bridge/validation.js` and `test/activity-scroll-unit.mjs`. This was direct evidence that the running application had grouped activity across independent work.

### Baseline deterministic failure

`test/multi-chat-task-isolation-unit.mjs` was added before changing production behavior. Under the old tracker, two explicit starts over the same transport scope returned the same task ID.

Observed failure:

```text
AssertionError: explicit task creation over one transport must produce independent task IDs
actual:   <same UUID>
expected: <different UUID>
```

This reproduced the core collision without relying on browser timing or live ChatGPT behavior.

### Reproduction matrix

| Scenario | Connections | Logical tasks | Repositories | Call overlap | Expected | Before correction | After correction |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| Single task | 1 | 1 | One | None | Normal completion | Passed | Passed |
| Two tasks, shared transport | 1 | 2 | Different | Sequential | Independent identities | Same task ID could be reused | Distinct opaque IDs |
| Two tasks, shared transport | 1 | 2 | Different | Controlled concurrent | A completes while B executes | Shared task/scope could interfere | A completes; B remains active |
| Two tasks, same workspace | 1 | 2 | Same | Sequential | Independent task state | Workspace inference/policy overwrite | Separate task records and policies |
| Same workspace changed after validation | 1 | 2 | Same | Sequential | Stale validation rejected safely | Other task state could be merged ambiguously | `TASK_PERSISTENCE_CONFLICT`; revalidation required |
| Reconnect | Changed transport scope | 1 | Same | None | Original task remains resolvable | Weak-scope reattachment was ambiguous | Explicit task ID resumes persisted task |
| Duplicate completion | 1 or more | 1 | Same | Retry | Idempotent success | Could fail after state was cleared | Original completion returned with `duplicate:true` |
| Concurrent completion, same task | 1 | 1 | Same | Controlled concurrent | One transition, one duplicate | Shared completion state was not explicit | One accepted request; retry collapses idempotently |
| Unknown task ID | 1 | 1 invalid | Any | None | Explicit rejection | Could create or infer state | `TASK_NOT_FOUND` |
| Completed task reused for work | 1 | 1 | Same | None | Explicit rejection | Stale selection was possible | `INVALID_TASK_STATE` |
| Task B borrows task A validation | 1 | 2 | Same | Sequential | Rejected | Workspace/session fallback could permit it | Rejected; exact task validation required |

### Exact controlled overlap

`test/multi-chat-mcp-integration.mjs` performs this sequence:

1. Initialize one MCP client context.
2. Start task A for workspace A.
3. Start task B for workspace B over the same MCP transport scope.
4. Validate task A.
5. Start a task B command that writes a ready file and waits on a release barrier.
6. Confirm task B has one active call.
7. Complete task A.
8. Confirm task B is still active and present.
9. Release task B and let its command finish.
10. Validate and complete task B.
11. Retry task A completion over a changed transport scope.
12. Confirm the retry returns task A's original result.

## 3. Current architecture before correction

### Previous task creation flow

```text
ChatGPT tool invocation
-> MCP HTTP/SSE/stdio transport
-> request dispatcher
-> transport-derived taskScopeId
-> toolActivity task lookup
-> one task selected or weak scope merged by workspace
-> tool handler
-> workspace policy file
-> audit/task-history stitching
```

### Previous completion flow

```text
complete_task invocation
-> current transport/session scope
-> active task/session inference
-> workspace/session validation lookup
-> completion request on inferred task
-> workspace policy cleanup
-> audit/history grouping
```

### Identity levels before correction

| Identity level | Previous representation | Defect |
| --- | --- | --- |
| Application instance | Electron/server process | Reasonable process scope |
| MCP server process | One Node.js process | Reasonable server scope |
| Transport connection/session | `taskScopeId` from headers/session/fallback | Incorrectly overloaded as task identity |
| MCP client instance | Partly represented by transport context | Not consistently separated from task |
| ChatGPT conversation | Optional headers when present | Not proven stable or universally available |
| Logical Rel AI task | Implicit active task | Missing stable public identity |
| Tool invocation | JSON-RPC request plus activity operation | Could be routed through shared mutable task context |
| Workspace | Alias/path | Used as an unsafe task inference and persistence key |

### Mutable state inventory

| State | Owner | Previous scope/key | Readers | Writers | Persistence | Protection | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Active task map | `src/toolActivity.js` | One task per scope | Tool dispatcher, activity UI | Every tool call | Memory | Process-local mutation | Defective scope |
| Weak-scope task grouping | `src/toolActivity.js` | Workspace/time | Task resolver | New calls/reconnect | Memory | Heuristic only | Defective inference |
| Session policy | `src/policyResolver.js` | One file per workspace | Status, validation, completion | Session start/touch/clear | JSON file | File replacement | Defective uniqueness key |
| Audit stream | `src/audit.js` | Global append-only log | Completion/history/UI | Every tool call | JSONL | Append | Valid storage; insufficient identity fields previously |
| Task history | `src/taskHistoryStore.js` | Canonicalized/stiched task | Dashboard/completion | Audit ingestion | Per-task JSON | File writes | Defective legacy canonicalization for concurrent tasks |
| Workspace operation queue | `src/workspaceOperationQueue.js` | Workspace alias | Tool dispatcher | Workspace operations | Memory | Promise tail | Intentional same-worktree serialization |
| Completion request | `src/toolActivity.js` | Active task object | Tracker | `complete_task`/atomic checks | Memory | Task-local after correction | Corrected |

## 4. Root-cause analysis

### Finding 1: transport scope was treated as logical task identity

| Field | Detail |
| --- | --- |
| Finding | Multiple logical tasks over one transport could resolve to one active task. |
| Location | `src/toolActivity.js`, `beginConnectorToolCall` around line 21; `resolveImplicitTask` around line 168. |
| Evidence | Baseline regression returned the same UUID for two starts over one scope. Old code keyed task state by scope and merged weak scopes by workspace. |
| Confidence | Confirmed. |
| Impact | High: wrong task routing, grouped activity, failed or misdirected completion. |
| Root cause | Missing logical task identity; overly broad session identity; global mutable scope mapping. |
| Correction | Separate `tasksById` and `taskIdsByScope`; always create a fresh UUID for `relai_start_task`; explicit task binding on later calls. |
| Verification | `test/multi-chat-task-isolation-unit.mjs`; `test/multi-chat-mcp-integration.mjs`. |
| Effort | Architectural but contained. |
| Risk | High before; medium migration risk after. |

### Finding 2: workspace policy persistence allowed one task to overwrite another

| Field | Detail |
| --- | --- |
| Finding | Only one `${workspace}-policy.json` existed per workspace. |
| Location | `src/policyResolver.js`, `readSessionPolicy` around line 80 and `ensureSessionStarted` around line 163. |
| Evidence | Starting task B for the same workspace replaced the task A policy in the old design. |
| Confidence | Confirmed by code and regression. |
| Impact | High: changed-file ownership and baseline state leaked across tasks. |
| Root cause | Persistence-key collision; workspace used as task identity. |
| Correction | Task-specific policy files keyed by encoded workspace and opaque task ID; legacy file remains readable only for migration. |
| Verification | `test/auto-session-unit.mjs`; `test/multi-chat-task-isolation-unit.mjs`. |
| Effort | Moderate. |
| Risk | Medium due to migration compatibility. |

### Finding 3: completion evidence was not strictly task-scoped

| Field | Detail |
| --- | --- |
| Finding | Validation and mutation evidence could be resolved through workspace/session fallback. |
| Location | `src/tools/completion.js`, `completeTask` around line 25 and `finalizeDuplicateCompletion` around line 163. |
| Evidence | Previous logic could recover or associate validation from a related workspace/session. New tests explicitly prove task B cannot borrow task A validation. |
| Confidence | Confirmed by code and regression coverage. |
| Impact | Critical if the wrong task were completed; high for common completion failures. |
| Root cause | Ambiguous task inference; activity-routing error; retry/idempotency defect. |
| Correction | Require `task_id`; query audit/history only for that ID; verify invocation binding; keep task-specific completion state; persist duplicate result. |
| Verification | `test/task-completion-unit.mjs`; `test/multi-chat-mcp-integration.mjs`. |
| Effort | Moderate. |
| Risk | Medium because public schema changes. |

### Finding 4: history stitching persisted the grouping defect

| Field | Detail |
| --- | --- |
| Finding | Weak task fragments could be stitched by workspace/time and validation aliases. |
| Location | `src/taskHistoryStore.js`, `resolveCanonicalTaskId`; `src/taskHistory.js`, `canStitchTaskGroups`. |
| Evidence | Legacy canonicalization accepted scope/workspace continuity as evidence of one task. |
| Confidence | Confirmed by code inspection. |
| Impact | Medium to high: dashboard and restart behavior retained incorrect ownership. |
| Root cause | Overloaded session model; persistence identity collision. |
| Correction | Identity version 2 uses the explicit task ID as the canonical key and disables stitching/alias merging. Legacy records retain old logic only for compatibility. |
| Verification | `test/task-history-store-unit.mjs`; `test/task-history-unit.mjs`. |
| Effort | Moderate. |
| Risk | Medium migration risk. |

### Finding 5: observability could not distinguish identity layers

| Field | Detail |
| --- | --- |
| Finding | Logs did not consistently separate server, transport, client, task, and invocation identity. |
| Location | `src/server.js`, `handleToolCall`; `src/tools/task.js`, `taskAuditContext` around line 37. |
| Evidence | Earlier events emphasized tool/workspace/task scope without a complete identity tuple. |
| Confidence | Confirmed. |
| Impact | Medium: root-cause diagnosis and production verification were unnecessarily difficult. |
| Root cause | Insufficient observability. |
| Correction | Add server instance, process, transport type/session, client name/version, initialization request, JSON-RPC request, operation, task, workspace, event type, duration, and duplicate indicators. |
| Verification | Audit assertions in `test/multi-chat-mcp-integration.mjs`. |
| Effort | Small to moderate. |
| Risk | Low; secret fields remain redacted. |

### Finding 6: same-worktree tasks require validation conflict detection

| Field | Detail |
| --- | --- |
| Finding | Independent task identity does not make two tasks operating on one physical worktree independent at the filesystem level. |
| Location | `src/tools/completion.js`; `src/workspaceOperationQueue.js`. |
| Evidence | A task can validate, then another task can change the same workspace before the first completes. |
| Confidence | Confirmed design property and deterministic test. |
| Impact | High if stale validation were accepted. |
| Root cause | Shared mutable workspace, not identity collision. |
| Correction | Keep same-workspace operations serialized and reject completion with `TASK_PERSISTENCE_CONFLICT` if another task mutated the workspace after validation. |
| Verification | Shared-worktree case in `test/task-completion-unit.mjs`. |
| Effort | Small. |
| Risk | Low; may require legitimate revalidation. |

## 5. MCP client and transport findings

`src/http/mcp.js` constructs a transport/client scope from available headers, MCP session ID, or a generated fallback in `resolveTaskScopeId` around line 171. The implementation can observe transport identity, but repository and test evidence do not prove that ChatGPT supplies a stable conversation/thread ID on every call.

Therefore:

- No design decision relies on a ChatGPT conversation ID.
- One transport connection may own multiple logical tasks.
- JSON-RPC request IDs identify invocations, not tasks.
- Reconnect may change transport identity while preserving task identity through `task_id`.
- Client name/version and initialization request ID are diagnostics, not authorization or task identity.

The exact number of live ChatGPT transport connections used for separate conversations remains unverified until packaged live-client testing. The corrected architecture works whether ChatGPT uses one shared connection or several.

## 6. Alternative designs considered

### Alternative A: explicit opaque task ID on task-scoped calls — selected

**Benefits**

- Independent of undocumented client metadata.
- Works over one or many transport connections.
- Supports reconnect and restart.
- Makes routing and error behavior deterministic.
- Enables exact audit, persistence, activity, and completion ownership.

**Drawbacks**

- Adds one tool and one argument to the client workflow.
- Existing clients need migration behavior.
- The AI client must retain and reuse the returned ID.

**Effort:** Moderate.
**Risk:** Medium migration risk, low runtime ambiguity after migration.

### Alternative B: bind one active task to each transport connection

**Benefits**

- Minimal public schema change.
- Simple when one connection always equals one conversation.

**Drawbacks**

- Fails if ChatGPT shares a connection across conversations.
- Fails when reconnect changes connection identity.
- Continues to overload transport and task lifecycles.
- Cannot represent concurrent tasks over one client context.

**Decision:** Rejected as technically unreliable.

### Alternative C: one MCP server process per task

**Benefits**

- Strong process isolation.
- Simple in-memory ownership.

**Drawbacks**

- Operationally expensive for the desktop application.
- Complicates OAuth, connector registration, ports, lifecycle, UI, and packaging.
- Does not solve shared-worktree conflicts by itself.
- Unnecessary for the confirmed defect.

**Decision:** Rejected as disproportionate.

### Alternative D: hybrid explicit ID with temporary unambiguous legacy resolution

**Benefits**

- Allows older task-scoped calls to continue when exactly one task is present.
- Provides a controlled migration path.

**Drawbacks**

- Implicit behavior must remain temporary.
- Legacy calls must fail once ambiguity exists.

**Decision:** Selected as migration behavior. `complete_task` requires `task_id` immediately; other tools may use legacy implicit resolution only when exactly one candidate exists.

## 7. Target architecture

```text
Rel AI application instance
└── MCP server process (serverInstanceId)
    ├── transport/client context A
    │   ├── logical task A (task_id)
    │   │   ├── workspace A
    │   │   ├── invocation IDs
    │   │   ├── activity stream
    │   │   ├── task policy
    │   │   └── validation/completion state
    │   ├── logical task B (task_id)
    │   │   └── independent state
    │   └── logical task C (task_id)
    └── transport/client context B
        └── logical tasks with the same identity rules
```

### Identity rules

1. `serverInstanceId` identifies one running server process.
2. Transport session identifies a connection context only.
3. Client metadata is diagnostic only.
4. `task_id` is the canonical logical task identity.
5. JSON-RPC request ID plus internal operation ID identifies one invocation.
6. Workspace identifies a repository/worktree resource, not a task.
7. A ChatGPT conversation ID is used only if it is someday documented and proven; it is not required now.

### Ownership model

- Task IDs are UUIDs and not predictable sequence numbers.
- A task is created for one workspace.
- A task ID cannot be used against another workspace.
- A completed task ID cannot be reused for new work.
- A reconnecting client may resume a task by presenting its ID.
- The current local product treats possession of an unguessable task ID as the capability to resume that task. It does not yet implement separate user accounts or cryptographic per-client ownership because the supported application is local and connector access is already authenticated.
- Task enumeration is not added to the MCP surface by this change.

### Completion state machine

```text
created/active
-> validating
-> active with passed validation
-> completing
-> completed
```

Error and terminal-adjacent states include:

```text
validation failed
inactive/abandoned
failed
cancelled (future product behavior)
```

Rules:

- First valid completion atomically requests the transition for that task.
- Concurrent completion retries for the same task return duplicate acceptance.
- A persisted completed task returns its original result after reconnect/restart.
- Completion while another operation on the same task is active returns `TASK_COMPLETION_IN_PROGRESS`.
- Another task may remain active during completion.
- Another task changing the same workspace after validation produces `TASK_PERSISTENCE_CONFLICT`.
- Activity received for a completed task is rejected with `INVALID_TASK_STATE`.

### Resolution rules

1. Explicit `task_id` resolves exactly one persistent task.
2. Unknown ID: `TASK_NOT_FOUND`.
3. Workspace mismatch: `TASK_OWNERSHIP_MISMATCH`.
4. Completed task reused: `INVALID_TASK_STATE`.
5. Missing ID with multiple candidates: `TASK_ID_REQUIRED`.
6. No silent newest-task, latest-activity, repository-only, or arbitrary selection.

### Cleanup and retention

- In-memory inactive tasks expire on the existing idle window.
- Task-specific policy files expire under the existing policy TTL.
- Persistent task history remains bounded by the existing history-store retention behavior.
- Client initialization contexts are bounded to 256 entries and expire after 24 hours.
- Cleanup removes only the selected task's policy and tracker entry.
- Completing one task does not cancel timers, operations, or activity for another task.

## 8. Implementation

### Public interface

- Added `relai_start_task`.
- Tool surface version initially increased to 9 for logical task identity, then advanced to 10 when the six deprecated compatibility tools were removed.
- The final callable surface contains 20 active tools and no deprecated tools.
- Connector schemas expose `task_id` for task-scoped tools.
- `relai_complete_task` requires `task_id`.
- Every successful task-scoped response includes `task_id`.
- MCP initialize instructions describe the task-handle workflow.

### Core changed files and symbols

| File | Main changes |
| --- | --- |
| `src/toolActivity.js` | Multi-task tracker, explicit binding, ambiguity rejection, task-local completion, duplicate handling. |
| `src/tools/task.js` | Task creation, persistent task validation, identity audit context, response task identity. |
| `src/tools.js` | Dispatcher integration, known-task checks, task-aware audit, task-specific policy cleanup. |
| `src/tools/registry.js` | `relai_start_task`, tool surface version 10, completion contract, and the final 20-tool active-only surface. |
| `src/tools/schema.js` | Connector `task_id` schema and required completion ID. |
| `src/tools/handlers.js` | Start-task handler registration. |
| `src/tools/completion.js` | Exact-task validation/completion, idempotency, restart recovery, shared-worktree conflict detection. |
| `src/policyResolver.js` | Per-task policy persistence and ambiguity-safe legacy reads. |
| `src/taskHistoryStore.js` | Identity-v2 canonical persistence; exact task session lookup; new trace fields. |
| `src/taskHistory.js` | Disable task stitching for identity version 2. |
| `src/server.js` | Server instance ID, client initialization context, request/transport metadata, MCP instructions. |
| `src/http/mcp.js` | Separate transport type/session metadata from task identity. |
| `src/tools/errors.js` | Structured task error context. |
| `src/tools/session.js` | Task-aware session start and completion audit fields. |
| `types/boundaries.d.ts` | `task_id` boundary field. |
| `README.md` | Explicit logical task workflow and dashboard semantics. |

### Structured events and trace fields

Persistent audit events now include, when available:

- `serverInstanceId`
- process ID
- `transportType`
- `transportSessionId`
- `clientName`
- `clientVersion`
- `initializationRequestId`
- JSON-RPC `requestId`
- internal `operationId`
- tool and operation
- logical `taskId`
- scope ID
- workspace
- duration
- status/error code
- duplicate request indicator
- identity version

Task lifecycle event names include:

```text
task.started
task.start.rejected
task.completion.committed
task.completion.duplicate
task.completion.rejected
tool.call.completed
```

The existing audit redactor continues to remove token-, secret-, password-, authorization-, and API-key-like fields. Raw prompts and repository contents are not added to lifecycle metadata.

### Structured errors

Implemented or enforced errors include:

- `TASK_ID_REQUIRED`
- `TASK_NOT_FOUND`
- `TASK_OWNERSHIP_MISMATCH`
- `INVALID_TASK_STATE`
- `TASK_COMPLETION_IN_PROGRESS`
- `TASK_PERSISTENCE_CONFLICT`
- `CONNECTION_CONTEXT_UNAVAILABLE`

## 9. Test report

### New tests

- `test/multi-chat-task-isolation-unit.mjs`
  - two task IDs over one scope
  - explicit ambiguity failure
  - task A completion while task B is active
  - concurrent duplicate completion for one task
  - per-task policy coexistence and cleanup

- `test/multi-chat-mcp-integration.mjs`
  - JSON-RPC initialize and tools/call flow
  - one transport with multiple tasks
  - different workspaces
  - same workspace with different objectives
  - controlled active-call barrier
  - reconnect with changed transport scope
  - duplicate completion
  - completed task reuse rejection
  - unknown task rejection
  - exact audit metadata

### Updated tests

- `test/task-completion-unit.mjs`
  - exact task validation
  - atomic and standalone completion
  - restart recovery
  - idempotent retry
  - validation borrowing rejection
  - shared-worktree mutation conflict

- `test/tool-activity-unit.mjs`
  - weak-scope ambiguity now fails instead of merging.

- `test/auto-session-unit.mjs`
  - multiple task policies coexist; implicit lookup is ambiguous.

- `test/tool-registry-unit.mjs`
  - 20-tool active-only surface, version 10, start tool, task ID schema, and removed compatibility tools.

### Passing targeted validation

```text
node test/multi-chat-task-isolation-unit.mjs
node test/tool-activity-unit.mjs
node test/task-completion-unit.mjs
node test/multi-chat-mcp-integration.mjs
node test/task-history-store-unit.mjs
node test/task-history-unit.mjs
node test/auto-session-unit.mjs
node test/mcp-task-scope-unit.mjs
node test/tool-registry-unit.mjs
npm run check
```

Final validation completed after the full change set:

```text
Checked 269 JavaScript files.
ESLint: passed with zero warnings.
TypeScript boundary typecheck: passed.
Release consistency: passed for 0.21.0.
106/106 test files passed.
Unpacked Windows Electron build: passed.
Read-only packaged layout verification: passed; 10 required files present.
```

### Before and after

| Test property | Before | After |
| --- | --- | --- |
| Two starts on one transport | Same task ID | Different task IDs |
| Ambiguous implicit routing | Workspace/time merge | `TASK_ID_REQUIRED` |
| Complete A while B active | Shared state could interfere | A completes; B remains active |
| Validation ownership | Workspace/session recovery | Exact task only |
| Duplicate completion | State-dependent failure possible | Original result returned |
| Restart recovery | Scope reconstruction | Explicit task ID + persisted history |
| Policy cleanup | Workspace-wide | Exact task only |
| Same-worktree post-validation mutation | Ambiguous interference | Explicit persistence conflict |

### Tests intentionally not performed

- The user's normal installed Rel AI application was not stopped, replaced, uninstalled, or upgraded.
- Installer/uninstaller tests were not run on the developer host.
- The unpacked packaged application was not launched.
- Live ChatGPT OAuth and multi-conversation behavior were not exercised against the packaged build.

### Packaged verification performed

```text
npm run electron:build
npm run verify:packaged -- --dir dist/build-check/win-unpacked
```

The unpacked Windows application was built successfully and the read-only verifier confirmed all 10 required packaged files for version 0.21.0. No installer, uninstaller, or packaged executable was run.

## 10. Compatibility and migration

### Existing records

- Legacy workspace policy files remain readable.
- New task-aware writes use task-specific policy filenames.
- Identity-v2 task history uses explicit IDs without stitching.
- Legacy history may retain old stitching behavior so historical UI data remains readable.
- No destructive migration rewrites all existing records in place.

### Existing clients

- `relai_start_task` is the preferred entry point.
- All task-scoped responses return `task_id` so clients can retain it.
- `relai_complete_task` requires `task_id` immediately because ambiguous completion is unsafe.
- Other legacy calls without `task_id` work only when exactly one valid task can be resolved.
- Multiple candidates produce `TASK_ID_REQUIRED`; Rel AI does not select the latest task.

### Deprecation plan

The implicit compatibility path should be removed after supported clients consistently call `relai_start_task` and pass `task_id`. Removal criteria:

1. Tool-surface telemetry or test fixtures show no supported client depending on implicit task resolution.
2. Packaged ChatGPT validation confirms the initialize instructions are followed.
3. A release note announces the required explicit task handle.
4. Legacy policy/history records have exceeded the supported retention or migration window.

## 11. Performance and resource impact

- No process is created per task.
- Task maps are bounded by inactivity cleanup.
- Client context map is capped at 256 entries with a 24-hour TTL.
- Audit metadata is small and excludes prompt/file bodies.
- Same-workspace operations retain the existing workspace queue to prevent unsafe concurrent filesystem mutation.
- Different workspaces can execute concurrently.
- Task completion uses task-local state rather than a global request queue.

## 12. Security and privacy

The correction reduces cross-task exposure by preventing repository activity, completion summaries, validation evidence, and policy ownership from being selected through another task's scope.

Current security properties:

- Task IDs are unguessable UUIDs.
- Workspace ownership is validated.
- No task enumeration tool was added.
- Completion and activity are keyed by exact task ID.
- Trace logs redact credential-like fields and do not add raw prompts.

Product-policy limitation:

- A client already authorized to the local MCP server and possessing a valid task ID can resume that task. Per-user authorization beyond the task capability is not implemented because the current product is a local authenticated application, not a multi-tenant service. If Rel AI becomes multi-user or remotely shared, task ownership must include a durable authenticated principal rather than task-ID possession alone.

## 13. Risk and rollback plan

### Operational risks

- Older clients may omit `task_id` and receive `TASK_ID_REQUIRED` once multiple tasks exist.
- AI clients must retain the ID returned by `relai_start_task`.
- Same-worktree tasks may require additional validation after another task edits the repository.

### Data risks

- Legacy and identity-v2 history coexist. Incorrect migration code could hide older sessions, but the implementation does not destructively rewrite them.
- Task policy files increase from one per workspace to one per active task; TTL cleanup limits retention.

### Security risks

- Treating task ID as a local capability is appropriate for the current deployment but insufficient for a future multi-user server.
- Additional metadata must remain redacted; existing audit redaction is retained.

### Exact rollback

Rollback the following concern-separated changes together:

1. Revert `relai_start_task`, tool-surface version 10, the active-only registry contract, and connector task schema in `src/tools/registry.js`, `src/tools/schema.js`, and `src/tools/handlers.js`.
2. Revert explicit task dispatch and audit integration in `src/tools.js`, `src/tools/task.js`, and `src/server.js`.
3. Revert task-local tracker behavior in `src/toolActivity.js`.
4. Revert task-specific policy persistence in `src/policyResolver.js`.
5. Revert exact completion semantics in `src/tools/completion.js`.
6. Revert identity-v2 persistence changes in `src/taskHistoryStore.js` and `src/taskHistory.js`.
7. Revert transport metadata changes in `src/http/mcp.js` and boundary/error updates.
8. Revert documentation and tests.

Rollback must be performed as one compatible set. Reverting only the public schema or only persistence would create an inconsistent task model. Existing identity-v2 JSON history and task policy files can remain on disk because older code ignores unknown files/fields; they should not be deleted during rollback without a separate backup decision.

## 14. Issue-ready follow-up tasks

### Follow-up A: packaged live ChatGPT multi-conversation acceptance

**Scope:** Build in an isolated Windows environment and connect live ChatGPT conversations A, B, and C to one packaged Rel AI instance.
**Acceptance criteria:** Each conversation starts and retains a distinct task ID; interleaved calls remain isolated; A and B complete independently; reconnect and duplicate retry work; traces show actual connection/session behavior.
**Risk:** Medium.
**Dependencies:** Full repository suite, safe package verification, disposable VM or test host, ChatGPT connector access.

### Follow-up B: durable authenticated task ownership for remote multi-user mode

**Scope:** Define a principal-aware ownership model if Rel AI supports multiple remote users or shared deployments.
**Acceptance criteria:** Task resume requires both valid task capability and matching authenticated principal; cross-principal enumeration and operation are denied; restart restores ownership.
**Risk:** High if product deployment expands before implementation.
**Dependencies:** Product decision on remote/multi-user support and authentication identity.

### Follow-up C: expose task-focused dashboard filtering and terminology review

**Scope:** Verify the dashboard consistently labels identity-v2 work as logical tasks rather than overloaded sessions and provides task/workspace filtering without merging.
**Acceptance criteria:** Task A/B activity, progress, errors, and completion remain visually separate; stale/inactive tasks are distinguishable; no completion clears another task's display.
**Risk:** Medium usability risk, low data risk.
**Dependencies:** Existing dashboard activity/history components and packaged acceptance environment.

## 15. Final decision

**Decision:** Core defect resolved in repository code, deterministic unit/integration coverage, the full repository suite, and unpacked package verification; live production-client verification is pending.

Demonstrated acceptance criteria:

- Multiple logical tasks share one MCP connection safely.
- Every new task has an unambiguous opaque ID.
- Tool calls and completion resolve the requested task deterministically.
- Completing task A leaves task B unchanged and active.
- Concurrent and duplicate completion requests are idempotent.
- Ambiguous legacy calls fail explicitly.
- Activity, policy, audit, validation, and persistence are task-scoped.
- Reconnect/restart can resume by task ID.
- Single-task behavior remains covered.
- The design does not rely on undocumented ChatGPT conversation metadata.
- Shared-worktree mutations produce an explicit validation conflict rather than stale completion.

Not yet demonstrated against the released product:

- Live packaged ChatGPT behavior with multiple real conversations.
- Exact live connection reuse behavior chosen by the current ChatGPT client.
- Installer lifecycle acceptance on an isolated Windows machine.

The issue must not be marked fully production-verified until the packaged live-client follow-up passes.
