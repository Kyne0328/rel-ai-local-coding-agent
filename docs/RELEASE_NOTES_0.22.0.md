# Rel.AI MCP 0.22.0 Release Notes

Release date: 2026-07-27

## Breaking release

0.22.0 is an intentional pre-1.0 hard cutover. There is no compatibility period for the removed configuration, protocol, or task-history behavior.

### Upgrade effects

- Removed configuration properties are ignored rather than migrated. This includes `workflow`, `flow`, `cautionZone`, top-level `maxIndexFiles`, workspace `fastTask`, context `includePaths`, and patch `maxPatchBytes`.
- Existing task-history session files are deleted the first time 0.22.0 accesses history. Rel.AI creates `.task-history-v2` and records only new explicit identity-v2 tasks. Audit logs remain available but are not reconstructed into task history.
- Legacy MCP `GET /sse` and `POST /messages` endpoints are removed. Clients must use stdio or Streamable HTTP at `POST /mcp`.
- MCP initialization must provide the standard `capabilities` and `clientInfo` fields expected by MCP SDK v2.
- Every independent objective must call `relai_start_task` once. Every later task-scoped call must pass the returned exact `task_id`; Rel.AI no longer infers tasks from a connection, conversation, workspace, process, or timestamp.
- The desktop package now includes the MCP SDK v2 runtime and required transitive packages.

Back up any configuration values or session-history files you need before installing this release. Old history is intentionally not converted.

## MCP SDK v2

Rel.AI now registers its 20 tools and resources through `@modelcontextprotocol/server`. Stdio framing, initialization, tool/resource discovery, argument validation, protocol errors, and Streamable HTTP handling are supplied by the SDK. OAuth authorization, workspace safety, tool implementations, auditing, queues, result compaction, and task ownership remain Rel.AI responsibilities.

The custom JSON-RPC dispatcher and legacy MCP SSE session implementation have been deleted.

## Exact task identity

Task routing and persistence use only explicit opaque IDs. Distinct tasks remain independent even when they share one MCP connection or one workspace. Completed task IDs are rejected for later work, duplicate completion is idempotent, and another task changing the same worktree after validation forces revalidation.

## Codebase reduction

This release also removes additional indirection and duplication:

- tool definitions bind directly to executable handlers;
- the obsolete dispatch lookup module is removed;
- registry defaults are generated centrally;
- repeated HTML escaping, duration formatting, and hidden settings save rows are shared;
- onboarding and workspace settings use one alias/path implementation;
- task-history event predicates and formatting utilities are shared;
- ngrok authtoken validation has one implementation.

## Validation

The release candidate must pass the full source release gate, Electron packaging, zero-vulnerability production dependency audit, packaged-layout verification, and packaged OAuth/MCP connector acceptance. A final real ChatGPT UI app-selection check remains manual because repository automation cannot operate a user's logged-in ChatGPT interface.
