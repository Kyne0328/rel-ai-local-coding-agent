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
