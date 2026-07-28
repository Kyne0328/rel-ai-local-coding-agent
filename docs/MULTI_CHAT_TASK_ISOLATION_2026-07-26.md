# Rel.AI MCP Task Isolation Architecture

**Originally investigated:** 2026-07-26  
**Current architecture:** 0.23.0 MCP `2026-07-28` hard cutover

## Summary

Rel.AI uses one explicit opaque `task_id` as the canonical identity of a logical coding task. The task ID is created by `relai_start_task` and must be supplied to every later task-scoped call.

```text
relai_start_task(workspace)
-> task_id

relai_read / relai_edit / relai_run_checks / ...
-> same task_id

relai_run_checks complete:true
or relai_complete_task
-> exact task_id only
```

MCP transport state, HTTP connections, process IDs, operation-task IDs, worktree aliases, workspace aliases, and ChatGPT conversation metadata are not logical task identities and are never used to select or merge tasks.

## Protocol boundary

Rel.AI targets MCP `2026-07-28` through the stable MCP SDK v2.

```text
stdio client
-> request-scoped MCP SDK transport
-> registered Rel.AI tool handler

HTTP/OAuth client
-> OAuth or bearer authorization
-> stateless POST /mcp
-> request-scoped MCP SDK handler
-> registered Rel.AI tool handler
```

The protocol uses `server/discover`; there is no `initialize` handshake or protocol session. Each request carries its protocol version, method, client identity, capabilities, trace context, and named target explicitly. Rel.AI rejects `Mcp-Session-Id`, JSON-RPC batches, removed SSE/messages routes, and legacy aliases instead of treating them as compatibility input.

Dashboard live updates remain a separate authenticated `/events` stream and are not part of MCP transport identity.

## Identity model

| Identity | Purpose | May select a logical task? |
| --- | --- | --- |
| Server instance ID | Process-level diagnostics | No |
| MCP connection or transport | Request delivery and diagnostics | No |
| MCP client name/version | Diagnostics and policy context | No |
| JSON-RPC request ID | One invocation | No |
| Workspace alias/path | Repository resource | No |
| `task_id` | Logical coding-task ownership | **Yes — exact match only** |
| `processId` | One managed persistent child process | No |
| `operationTaskId` | One durable deferred operation | No; it is owned by a `task_id` |
| Managed worktree alias | One isolated repository worktree | No |
| Signed `requestState` | One resumable approval round trip | No |

Rules:

1. Every independent objective starts with `relai_start_task`.
2. Every task-scoped call supplies the returned `task_id`.
3. Missing IDs fail with `TASK_ID_REQUIRED`; Rel.AI does not choose the newest task or infer one from a workspace or connection.
4. Unknown IDs fail with `TASK_NOT_FOUND`.
5. A task ID cannot be used with another workspace.
6. Completed IDs cannot be reused for work and fail with `INVALID_TASK_STATE`.
7. Duplicate completion is idempotent and returns the original result.
8. Multiple tasks may share one MCP connection or one physical workspace while retaining independent activity, validation ownership, deferred operations, and completion state.

## Runtime ownership

```text
Rel.AI process
├── request-scoped MCP SDK handlers
├── task tracker keyed by task_id
│   ├── task A activity, approvals, operations, and completion state
│   └── task B activity, approvals, operations, and completion state
├── managed process registry keyed by processId
├── durable deferred-operation registry keyed by operationTaskId
├── managed worktree registry keyed by dynamic workspace alias
├── per-task workspace baseline and validation records
├── per-workspace reader/writer operation queue
├── append-only audit log
└── current-version task-history files keyed by task_id
```

The per-workspace queue serializes mutations against the same physical worktree while allowing compatible reads. Identity isolation does not make one checkout immutable. If another task changes a workspace after task A validates, task A must revalidate before completion.

Managed processes and deferred operations retain exact logical-task ownership. A caller cannot read, write, stop, cancel, or poll another task's runtime handle merely by knowing its ID.

## Persistent processes

`relai_process_start` returns a stable `processId` after spawn and an optional bounded startup observation window. The process continues independently of the MCP request. Output is written to private local logs and read through stdout/stderr cursors. Stop operations terminate the full process tree, and stale metadata is marked orphaned rather than killing a possibly reused PID.

Process identity does not complete or validate the owning logical task.

## Durable deferred operations

`relai_exec`, `relai_diagnostics_run`, and `relai_run_checks` may run with `defer:true`. The initial call returns an `operationTaskId`; the same logical task may poll it with `relai_operation_task_get` or request cooperative cancellation with `relai_operation_task_cancel`.

This is a Rel.AI runtime contract rather than native MCP `tasks/*`. The stable TypeScript SDK currently rejects that extension at its codec boundary and does not expose a stable server adapter that Rel.AI can register without replacing the SDK transport.

## Managed worktrees

A managed worktree receives a dynamic workspace alias and inherits the source workspace's validation, context, remote, and safety configuration. Worktree removal refuses dirty state, active managed processes, and active operations unless an explicit signed approval authorizes the requested destructive action. Branches are preserved by default.

A worktree alias identifies a repository resource, not a logical task. Multiple task IDs may use it subject to the same interference and revalidation rules as a configured workspace.

## Persistence and hard-cutover policy

0.23.0 is current-version-only. Rel.AI does not migrate or recover old MCP sessions, transport-derived task scopes, compatibility aliases, removed routes, old OAuth registrations, or obsolete configuration behavior.

Task history accepts only explicit current-version events with a nonempty `taskId` and current identity metadata. Audit logs remain activity records but are not stitched into logical tasks by PID, timestamp, connection, conversation header, workspace, validation alias, or removed tool name.

Users that need the previous handshake or connector behavior must remain on the previous release. Upgrading requires a new connector registration and approval.

## Completion model

A read-only task may complete without validation. A task that changed the workspace must have a successful current validation belonging to the same exact task.

```text
active
-> validation passed when mutation requires it
-> optional read-only review
-> explicit completion
-> completed
```

Completion may be signaled by:

- `relai_run_checks` with `complete:true` and a nonempty `summary`; or
- `relai_complete_task` after the final validation and any read-only review.

A successful arbitrary command, a running process, a completed deferred operation, a validation plan, or a worktree operation does not independently satisfy completion.

Relevant errors include:

- `TASK_ID_REQUIRED`
- `TASK_NOT_FOUND`
- `TASK_OWNERSHIP_MISMATCH`
- `INVALID_TASK_STATE`
- `TASK_COMPLETION_IN_PROGRESS`
- `TASK_PERSISTENCE_CONFLICT`

## OAuth and security

OAuth is the ChatGPT connector authorization layer and remains independent from logical task identity:

1. unauthenticated `POST /mcp` returns a Bearer challenge;
2. ChatGPT discovers exact protected-resource and authorization-server metadata;
3. dynamic client registration creates a public issuer-bound client;
4. approval uses authorization code plus mandatory PKCE S256;
5. codes, access tokens, and rotating refresh tokens remain bound to the issuer, client, redirect URI, resource, and allowed scopes;
6. refresh reuse is rejected;
7. replacing the approval token revokes grants and registrations;
8. each logical task is still selected only through its explicit `task_id`.

There is no previous-client recovery path in 0.23.0. An issuer change or approval-token replacement requires registration and approval again.

## Validation coverage

The release gate verifies:

- multiple explicit tasks on one request transport;
- concurrent tasks and independent completion;
- same-workspace validation conflicts;
- duplicate completion and completed-task reuse rejection;
- current-version task-history persistence;
- persistent-process start/read/write/stop/list behavior and cleanup;
- durable deferred-operation polling, ownership, and cancellation;
- managed worktree creation, inherited configuration, refusal, and removal;
- semantic search, trace analysis, structured diagnostics, and signed validation plans;
- OAuth discovery, registration, PKCE, issuer/resource binding, rotating refresh tokens, and revocation;
- stateless MCP stdio and HTTP behavior without initialize, sessions, batches, or removed routes;
- packaged backend startup and packaged OAuth/MCP acceptance.

The packaged acceptance scripts exercise the backend copied into the Electron build. A final manual ChatGPT UI check remains a release operation because repository automation cannot operate the user's logged-in ChatGPT interface.
