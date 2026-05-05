# Security model

Rel.AI MCP is intentionally powerful. Treat it like a local coding agent with write access to configured repositories.

## Core boundaries

- Workspaces are explicit aliases in `~/.rel-ai-mcp/config.json`.
- Tools cannot read arbitrary paths outside configured workspaces or attached task worktrees.
- Paths must be relative and cannot contain traversal.
- Secret-looking paths are blocked for reads, writes, and patches.
- Binary-looking files are skipped.
- Text writes are size-limited.
- Unified diffs are validated before `git apply --check` and `git apply`.

## Task worktrees

v0.5 keeps the v0.4 worktree-per-task isolation model. The recommended flow is:

```text
base workspace main branch
-> create task session
-> create task worktree from main
-> patch/test in worktree
-> commit/push/PR from worktree
-> remove worktree after review
```

This prevents ChatGPT from dirtying your main local checkout during experiments. Destructive reset/remove tools require the `admin` permission profile.


## Approval gates

v0.5 adds backend approval records for high-risk actions. MCP clients may already show confirmation modals, but Rel.AI MCP can also require a one-time `approvalId` for configured actions.

Default gates:

```json
{
  "approvalGates": {
    "commit": false,
    "push": true,
    "pr": true,
    "reset": true,
    "worktree-remove": true,
    "docker": false,
    "command": false,
    "patch": false,
    "write": false
  }
}
```

A gated flow is:

```text
relai_approval_request
-> user or operator approves with relai_approval_resolve
-> retry gated tool with approvalId
-> approval is consumed once
```

## Plans, locks, and indexes

Persistent plans, cooperative locks, and repository indexes are stored under `stateDir`. They are local operational metadata, not source-controlled project files. Locks are cooperative safety rails; they do not modify Git state.

## Permission profiles

```text
read-only -> inspect only
patch     -> edit/patch/branch
test      -> patch + tests/jobs/Docker
pr        -> test + commit/push/PR
admin     -> pr + cleanup/destructive tools
```

Default: `pr`.

Use `read-only` for repo exploration. Use `pr` for normal coding. Use `admin` briefly when cleaning worktrees or cancelling jobs.

## Commands

By default, ChatGPT can run only commands you configure by key:

```json
{
  "testCommands": {
    "unit": "npm test"
  },
  "commands": {
    "build": "npm run build"
  }
}
```

Arbitrary shell commands require `allowArbitraryCommands: true` and still pass a basic command safety policy. Keep this disabled unless you understand the risk.

## Docker

Docker support is opt-in through `allowDocker`. Docker runs mount the active workspace at `/workspace` and run an allowlisted command inside an allowlisted image. The default behavior disables networking unless `dockerNetworkNone` is set to `false`.

Recommended:

```json
{
  "allowDocker": true,
  "defaultDockerImage": "node:22-alpine",
  "allowedDockerImages": ["node:22-alpine"],
  "dockerNetworkNone": true
}
```

## Git and GitHub

- Protected branch commits and pushes are blocked.
- Pushes are limited to allowlisted remotes.
- PR creation/checks require `allowGitHubCli: true` and a working `gh auth status`.
- No auto-merge tool is included.
- No force-push tool is included.

## HTTP/SSE transport

Remote transport requires `REL_AI_MCP_TOKEN` unless `REL_AI_MCP_ALLOW_NO_AUTH=1` is set. Never expose an unauthenticated server through a tunnel.

Use HTTPS in front of the server when connecting from ChatGPT Developer Mode.

## Audit logs

Every MCP tool call is written to the configured audit log. The log includes tool name, workspace, session id, success/failure, duration, and error message when applicable. It does not intentionally include file contents.

## v0.6 task runner security notes

The high-level `relai_task_run` tool coordinates existing primitives; it does not bypass the same workspace, path, command, branch, and approval restrictions used by lower-level tools.

Recommended defaults:

- Keep `taskRunner.requireWorktree=true` so implementation happens in an isolated git worktree.
- Keep approval gates enabled for push, PR, reset, and worktree removal.
- Keep `ciRepair.enabled=false` until the repo has reliable allowlisted repair/build commands.
- Keep `sandboxMode="none"` until Docker execution is deliberately configured; when Docker is enabled, prefer network-disabled test containers.
- Use `relai_session_export` for audit/debug records before deleting a task worktree.

`relai_ci_repair_run` only runs configured repair commands unless `allowArbitraryCommands` is explicitly enabled. Do not enable arbitrary commands for shared or untrusted workspaces.

## v0.7 multi-agent security notes

The multi-agent layer does not create independent unbounded agents. It stores subtask records and gives each subtask its own session/worktree when requested. Every subtask still uses the same permission profile, workspace path validation, approval gates, command allowlists, and Git protections as normal tools.

Recommended defaults:

- Keep `multiAgent.requireReviewBeforeMerge=true`.
- Keep the `merge` approval gate enabled for non-dry-run `relai_subtask_merge_back`.
- Use `relai_conflict_check` before merging subtask branches.
- Use `relai_agent_review_diff` before commit/push/PR when multiple subtasks touched the same area.
- Keep `maxParallelSubtasks` low until the repo has reliable tests and branch hygiene.

Non-dry-run merge-back is intentionally gated because it modifies the target branch checkout. Prefer dry-run merge preflight first.

## v0.8 production-hardening notes

v0.8 adds several safety-oriented layers intended for longer multi-agent runs:

- `.gitattributes` and `.editorconfig` are included so source files, JSON, Markdown, and smoke-test fixtures stay LF-normalized across Windows/macOS/Linux.
- `relai_doctor` checks local prerequisites and can detect missing line-ending normalization files in a workspace.
- `relai_policy_summary` and `relai_policy_evaluate` expose the effective safety posture before high-risk actions.
- `relai_snapshot_create` should be used before large patches, merge-back, commit, push, and CI-repair cycles.
- `relai_snapshot_restore` stays approval-gated through the `reset` gate when actually restoring.
- `relai_memory_*` stores local repository notes only inside `stateDir`; do not store secrets in memory notes.
- Optional semantic-ish indexing is local and token-frequency based; it does not call an external embedding service.
- PR reply tools remain behind the `pr` permission level and the PR approval gate.

For remote ChatGPT Developer Mode use, keep `approvalGates.push`, `approvalGates.pr`, `approvalGates.merge`, and `approvalGates.reset` enabled.


## v0.9 production UX notes

- Use the dashboard only over localhost, a trusted tunnel, or HTTPS with a strong bearer token.
- `/events` streams dashboard snapshots over SSE and should not be exposed without authentication.
- `relai_cleanup_run`, `relai_doctor_fix`, `relai_state_import`, and original Rel.AI config import are admin-level operations.
- Prefer `relai_cleanup_preview` before deleting generated state files.
- Keep state exports private; they can contain task summaries, diffs, audit entries, and local path metadata.
