# Rel.AI MCP Task Isolation Architecture

**Originally investigated:** 2026-07-26  
**Current architecture:** 0.22.0 hard cutover

## Summary

Rel.AI uses one explicit opaque `task_id` as the canonical identity of a logical coding task. The task ID is created by `relai_start_task` and must be supplied to every later task-scoped call.

```text
relai_start_task(workspace)
-> task_id

relai_read / relai_edit / relai_run_checks / ...
-> same task_id

relai_complete_task
-> exact task_id only
```

MCP connection state, HTTP sessions, process IDs, workspace aliases, and ChatGPT conversation metadata are not task identities and are never used to select or merge tasks.

## Protocol boundary

Rel.AI uses MCP SDK v2:

```text
stdio client
-> @modelcontextprotocol/server stdio transport
-> McpServer
-> registered Rel.AI tool handler

HTTP/OAuth client
-> POST /mcp
-> OAuth or bearer authorization
-> @modelcontextprotocol/node adapter
-> @modelcontextprotocol/server Streamable HTTP handler
-> registered Rel.AI tool handler
```

The old custom JSON-RPC dispatcher is removed. The legacy MCP `GET /sse` and `POST /messages` routes are removed. Dashboard live updates still use the separate authenticated `/events` event stream and are not part of MCP transport.

## Identity model

| Identity | Purpose | May select a task? |
| --- | --- | --- |
| Server instance ID | Process-level diagnostics | No |
| MCP transport/session | Protocol delivery and diagnostics | No |
| MCP client name/version | Diagnostics | No |
| JSON-RPC request ID | One invocation | No |
| Workspace alias/path | Repository resource | No |
| `task_id` | Logical task ownership | **Yes — exact match only** |

Rules:

1. Every independent objective starts with `relai_start_task`.
2. Every task-scoped call supplies the returned `task_id`.
3. Missing IDs fail with `TASK_ID_REQUIRED`; Rel.AI does not choose the newest task or infer one from a workspace or connection.
4. Unknown IDs fail with `TASK_NOT_FOUND`.
5. A task ID cannot be used with another workspace.
6. Completed IDs cannot be reused for work and fail with `INVALID_TASK_STATE`.
7. Duplicate completion is idempotent and returns the original result.
8. Multiple tasks may share one MCP connection or one workspace while retaining independent ownership and completion state.

## Runtime ownership

```text
Rel.AI process
├── MCP SDK server instances
├── task tracker keyed by task_id
│   ├── task A activity and completion state
│   └── task B activity and completion state
├── per-task workspace policy/baseline records
├── per-workspace operation queue
├── append-only audit log
└── task-history v2 files keyed by task_id
```

The per-workspace operation queue intentionally serializes filesystem mutations against the same worktree. Identity isolation does not make one physical worktree immutable. If another task changes a workspace after task A validates, task A must revalidate before completion.

## Persistence

Task history accepts only current identity-v2 events with:

- a nonempty explicit `taskId`;
- `taskIdentityVersion >= 2`;
- `taskIdExplicit: true`;
- `taskHistoryEligible !== false`.

On first use after upgrading to 0.22.0, Rel.AI deletes the previous `sessions` directory and writes `.task-history-v2`. It does not migrate or reconstruct old task history from audit logs. Audit logs remain available as activity records but are not stitched into task sessions.

No task-history code groups entries by PID, timestamp, transport scope, conversation header, workspace, validation alias, or removed tool name.

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

Relevant errors include:

- `TASK_ID_REQUIRED`
- `TASK_NOT_FOUND`
- `TASK_OWNERSHIP_MISMATCH`
- `INVALID_TASK_STATE`
- `TASK_COMPLETION_IN_PROGRESS`
- `TASK_PERSISTENCE_CONFLICT`

## OAuth and security

OAuth remains the ChatGPT connector authorization layer. It is independent from logical task identity:

1. unauthenticated `POST /mcp` returns a Bearer challenge;
2. ChatGPT discovers the protected-resource and authorization-server metadata;
3. dynamic client registration creates a public client;
4. approval uses authorization code plus PKCE S256;
5. the issued access token authorizes MCP requests;
6. each task is still selected only through its explicit `task_id`.

Task IDs are unguessable capabilities inside the single-user authenticated product. A future multi-user deployment would also need durable principal ownership.

## Validation coverage

The release gate verifies:

- multiple explicit tasks on one SDK stdio connection;
- concurrent tasks and independent completion;
- same-workspace validation conflicts;
- duplicate completion;
- completed-task reuse rejection;
- exact task-history persistence;
- OAuth discovery, registration, PKCE, access and refresh tokens;
- MCP SDK stdio and Streamable HTTP behavior;
- removal of `/sse` and `/messages`;
- packaged backend startup and packaged OAuth/MCP acceptance.

The packaged acceptance script exercises the actual backend copied into the Electron build. A final manual ChatGPT UI check remains part of release operations because repository automation cannot operate the user's logged-in ChatGPT interface.
