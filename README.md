# Rel.AI MCP

Rel.AI MCP is a full MCP-based Codex-like coding runner for ChatGPT. It lets ChatGPT inspect configured workspaces, create isolated task worktrees, read/write safe text files, apply patches, run tests, inspect failures, patch again, track jobs, commit, push, create draft pull requests, and watch PR checks.

This repo is the MCP successor to the original Rel.AI browser-extension/native-host flow.

```text
ChatGPT
-> MCP tool: create task session
-> MCP tool: create isolated task worktree
-> MCP tool: inspect workspace tree/profile/context
-> MCP tool: read/search files
-> MCP tool: apply patches or safe file writes
-> MCP tool: run tests, Docker sandbox commands, or background jobs
-> MCP tool: inspect failures and patch again
-> MCP tool: commit, push, create draft PR, watch checks
-> MCP tool: reset/remove task worktree after review
```

## Version

Current version: `0.5.0`

## What v0.5 adds

v0.5 is the orchestration release. It moves Rel.AI MCP from a powerful tool backend into a fuller Codex-like task system with persistent plans, approval gates, repository indexing, issue-to-PR bootstrap, cooperative locks, CI repair snapshots, and a lightweight dashboard.

- Adds persistent implementation plans through `relai_plan_create`, `relai_plan_read`, `relai_plan_update`, `relai_plan_step_update`, and `relai_plan_step_append`.
- Adds approval gates through `relai_approval_request`, `relai_approval_resolve`, and `approvalId` support on gated actions.
- Adds repository indexing through `relai_index_build`, `relai_index_stats`, and `relai_index_search`.
- Adds `relai_task_bootstrap` to create a session, task worktree, repository index, and initial plan in one call.
- Adds `relai_issue_to_pr_bootstrap` to read a GitHub issue with `gh`, create a worktree, build an index, and prepare a linked implementation plan.
- Adds `relai_ci_repair_snapshot` to capture PR check state and create a repair-oriented session note.
- Adds cooperative workspace locks with `relai_lock_acquire`, `relai_lock_release`, and `relai_lock_list`.
- Adds `relai_dashboard_summary` and HTTP `/dashboard` + `/api/dashboard` endpoints for a simple operational view.
- Adds config fields for `approvalGates`, index limits, dashboard enablement, and session lock behavior.
- Adds `npm run test:v5`, covering bootstrap, plans, index search, locks, approval-gated commit, dashboard summary, and worktree cleanup.

## What v0.4 adds

v0.4 is the infrastructure release. It moves Rel.AI MCP from "tools that can edit a repo" toward a fuller Codex-style task system with isolated execution surfaces.

- Adds worktree-per-task isolation through `relai_task_worktree_create`.
- Lets normal read/search/write/patch/test/git tools operate on a session's attached task worktree automatically.
- Adds guarded task worktree removal through `relai_task_worktree_remove`.
- Adds `relai_worktree_list` to inspect Git worktrees.
- Adds `relai_git_reset_worktree` for hard reset/clean of task worktrees after failed experiments.
- Adds background job execution for allowlisted test/dev commands.
- Adds `relai_job_start_command`, `relai_job_status`, `relai_job_list`, and `relai_job_cancel`.
- Adds Docker sandbox hooks through `relai_docker_run` using allowlisted images and configured commands.
- Adds permission profiles: `read-only`, `patch`, `test`, `pr`, and `admin`.
- Adds PR check polling through `relai_pr_watch_checks`.
- Adds a multi-cycle `relai_patch_test_loop` for iterative patch/test runs.
- Adds config fields for `worktreeRoot`, `permissionProfile`, `allowDocker`, and Docker image allowlists.
- Raises default tree/session limits for larger repositories.
- Expands README version history in the original Rel.AI style.

## What remains guarded

Full-fledged does not mean reckless. These are still blocked or opt-in:

- No arbitrary disk browsing.
- No secret-file reads or writes.
- No binary writes.
- No unbounded shell execution by default.
- No direct commits or pushes to protected branches.
- No force-push tool.
- No auto-merge tool.
- No deploy tool.
- Destructive reset/remove tools require the `admin` permission profile.

## Requirements

- Node.js 18+
- Git available on `PATH`
- Optional: GitHub CLI `gh`, only if you enable PR creation/checks
- Optional: Docker, only if you enable Docker sandbox commands
- Optional: HTTPS tunnel/reverse proxy for ChatGPT Developer Mode remote MCP access

## Install

```bash
npm install
npm run check
npm run test:smoke
npm run test:http
npm run test:workflow
npm run test:v4
npm run test:v5
```

There are no runtime npm dependencies. `npm install` is mainly useful if you want a lockfile.

## Initialize config

```bash
npm run init-config
```

Default config path:

```text
~/.rel-ai-mcp/config.json
```

Add a workspace:

```bash
npm run workspace:add -- myapp /absolute/path/to/project
```

Add allowlisted test commands:

```bash
npm run testcmd:add -- myapp unit "npm test"
npm run testcmd:add -- myapp lint "npm run lint"
npm run testcmd:add -- myapp typecheck "npm run typecheck"
```

Add allowlisted dev commands:

```bash
npm run cmd:add -- myapp install "npm install"
npm run cmd:add -- myapp build "npm run build"
```

Enable optional capabilities deliberately:

```bash
node bin/relai-mcp-config.js set permissionProfile pr
node bin/relai-mcp-config.js set allowGitHubCli true
node bin/relai-mcp-config.js set allowDocker true
node bin/relai-mcp-config.js set allowArbitraryCommands false
node bin/relai-mcp-config.js set allowDestructiveTools false
```

Use `permissionProfile: "admin"` only when you want reset/remove/cancel tools available.

Example config:

```json
{
  "version": 1,
  "stateDir": "/Users/you/.rel-ai-mcp",
  "auditLogPath": "",
  "worktreeRoot": "/Users/you/.rel-ai-mcp/worktrees",
  "permissionProfile": "pr",
  "maxReadFileBytes": 300000,
  "maxWriteFileBytes": 600000,
  "maxSearchFileBytes": 300000,
  "maxOutputBytes": 2097152,
  "commandTimeoutMs": 1200000,
  "maxTreeEntries": 12000,
  "maxSessionSteps": 1000,
  "maxPlanSteps": 200,
  "maxIndexFiles": 25000,
  "maxIndexFileBytes": 300000,
  "sessionLocksEnabled": true,
  "dashboardEnabled": true,
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
  },
  "allowGitHubCli": false,
  "allowDocker": false,
  "allowArbitraryCommands": false,
  "allowDestructiveTools": false,
  "workspaces": {
    "myapp": {
      "path": "/absolute/path/to/myapp",
      "protectedBranches": ["main", "master"],
      "defaultBaseBranch": "main",
      "allowedRemotes": ["origin"],
      "repoSlug": "Kyne0328/myapp",
      "testCommands": {
        "unit": "npm test",
        "lint": "npm run lint",
        "typecheck": "npm run typecheck"
      },
      "commands": {
        "install": "npm install",
        "build": "npm run build"
      },
      "allowDocker": false,
      "defaultDockerImage": "node:22-alpine",
      "allowedDockerImages": ["node:22-alpine"],
      "dockerNetworkNone": true,
      "dockerUser": "node"
    }
  }
}
```

## Permission profiles

Rel.AI MCP now has coarse permission profiles so the same server can be exposed in safer or more powerful modes.

```text
read-only -> inspect config, sessions, files, tree, search, git status/diff/log/show
patch     -> read-only + task creation, worktree creation, safe writes, patching, branch creation
 test     -> patch + allowlisted tests/dev commands, Docker runs, background jobs
pr        -> test + commit, push, PR creation, PR checks
admin     -> pr + reset worktree, remove worktree, cancel live jobs
```

Default: `pr`.

For normal coding work, use `pr`. For safe repo exploration, use `read-only`. Temporarily switch to `admin` only when you need cleanup tools.

## Run as local stdio MCP server

Use this for local MCP clients that support stdio:

```bash
node /absolute/path/to/rel-ai-mcp/bin/rel-ai-mcp.js
```

Example local MCP config:

```json
{
  "mcpServers": {
    "rel-ai-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/rel-ai-mcp/bin/rel-ai-mcp.js"],
      "env": {
        "REL_AI_MCP_CONFIG": "/absolute/path/to/config.json"
      }
    }
  }
}
```

## Run as remote HTTP/SSE MCP server

Use this for ChatGPT Developer Mode or any MCP client that needs a remote endpoint.

Generate a strong token:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start the server:

```bash
REL_AI_MCP_TOKEN="paste-token-here" \
REL_AI_MCP_CONFIG="$HOME/.rel-ai-mcp/config.json" \
npm run start:http -- --host 127.0.0.1 --port 3333
```

Endpoints:

```text
GET  /health
POST /mcp
GET  /sse
POST /messages?sessionId=...
```

Remote requests must include:

```text
Authorization: Bearer <REL_AI_MCP_TOKEN>
```

For local-only testing without auth:

```bash
REL_AI_MCP_ALLOW_NO_AUTH=1 npm run start:http -- --host 127.0.0.1 --port 3333
```

Do not expose an unauthenticated server through a tunnel.

## Expose to ChatGPT Developer Mode

ChatGPT needs a reachable HTTPS URL. For local testing, put the HTTP server behind a tunnel:

```text
ChatGPT
-> HTTPS tunnel
-> http://127.0.0.1:3333
-> rel-ai-mcp
-> your configured workspace/worktrees
```

Examples:

- Cloudflare Tunnel
- Tailscale Funnel
- a private VPS reverse proxy
- Railway/Fly.io/Render if your workspaces are available there

Use `POST /mcp` as the primary endpoint when the connector asks for a streamable HTTP MCP endpoint. Use `GET /sse` only for clients that specifically expect SSE.

See [`docs/CONNECTING_TO_CHATGPT.md`](docs/CONNECTING_TO_CHATGPT.md).

## Available tools

### Core/server tools

- `relai_version` - server version, runtime, transport, and capability summary.
- `relai_config` - public config summary without secrets.
- `relai_audit_tail` - recent tool-call audit entries.

### Task/session/worktree tools

- `relai_task_start` - create a persistent task session.
- `relai_task_list` - list recent task sessions.
- `relai_task_read` - read full task session details.
- `relai_task_step` - append a plan/test/patch/PR note.
- `relai_task_update` - update session status, branch, or summary.
- `relai_task_worktree_create` - create and attach an isolated Git worktree to a task session.
- `relai_task_worktree_remove` - remove a task worktree after review/merge.
- `relai_worktree_list` - list Git worktrees for a workspace.

### Workspace/context tools

- `relai_workspace_tree` - filtered safe file tree.
- `relai_workspace_profile` - manifest/stack detection.
- `relai_read_files` - read safe text files.
- `relai_write_file` - write safe text files with optional SHA locking.
- `relai_search` - literal local text search.
- `relai_context_pack` - focused context pack from paths and search terms.

These tools accept `sessionId` where useful. If the session has an attached worktree, the operation targets the task worktree automatically.

### Patch/test/job/sandbox tools

- `relai_apply_patch` - check or apply unified diff.
- `relai_apply_patch_and_run` - apply patch and run selected tests.
- `relai_patch_test_loop` - run one or more patch/test cycles.
- `relai_run_test` - run one allowlisted test command.
- `relai_run_test_matrix` - run multiple allowlisted test commands.
- `relai_run_command` - run configured dev command; arbitrary commands require explicit opt-in.
- `relai_job_start_command` - start an allowlisted command as a background job.
- `relai_job_status` - poll job status and log tails.
- `relai_job_list` - list jobs.
- `relai_job_cancel` - cancel a live job.
- `relai_docker_run` - run an allowlisted command inside an allowlisted Docker image.

### Git/PR tools

- `relai_git_status` - branch, clean/dirty state, short status.
- `relai_git_diff` - unstaged/staged diff.
- `relai_git_log` - recent commits.
- `relai_git_show` - show one commit/ref.
- `relai_create_branch` - create and switch to feature branch.
- `relai_switch_branch` - switch branches with guardrails.
- `relai_git_reset_worktree` - hard reset/clean task worktree.
- `relai_commit_all` - stage and commit all changes.
- `relai_push_branch` - push feature branch to allowlisted remote.
- `relai_create_pr` - create draft PR through GitHub CLI.
- `relai_pr_checks` - inspect PR checks through GitHub CLI.
- `relai_pr_watch_checks` - poll PR checks for CI repair loops.

## Recommended Codex-like workflow prompt

```text
Use Rel.AI MCP on workspace myapp.
Start a task session for this goal.
Create a task worktree from main.
Inspect the workspace profile and tree.
Read the smallest set of files needed.
Make the change using patches or safe file writes.
Run unit, lint, and typecheck.
If a test fails, inspect the failure and patch again.
Show the final diff.
Commit, push, and create a draft PR.
Watch PR checks once.
Do not remove the task worktree until I approve cleanup.
Never touch secrets or protected branches.
```

## Security model

Rel.AI MCP uses layered safety checks:

1. Workspace aliases are explicit. ChatGPT cannot browse arbitrary disk paths.
2. Task worktrees isolate edits from the base workspace.
3. All file paths are relative and validated against traversal and workspace escape.
4. Secret-looking paths are blocked.
5. Binary-looking files are skipped.
6. Writes are text-only and size-limited.
7. Tests and commands are allowlisted by default.
8. Arbitrary commands are disabled unless explicitly enabled.
9. Docker images are allowlisted when Docker support is enabled.
10. GitHub CLI actions are disabled unless explicitly enabled.
11. Protected branches are blocked for commits/pushes.
12. Destructive cleanup requires the `admin` permission profile.
13. Every tool call is written to an audit log.

See [`docs/SECURITY.md`](docs/SECURITY.md).

## Troubleshooting

### Config not found

Run:

```bash
npm run init-config
```

Or set:

```bash
export REL_AI_MCP_CONFIG=/absolute/path/to/config.json
```

### ChatGPT cannot connect

Check:

```bash
curl http://127.0.0.1:3333/health
curl -H "Authorization: Bearer $REL_AI_MCP_TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://127.0.0.1:3333/mcp
```

If local health works but ChatGPT cannot connect, the issue is your HTTPS tunnel or Developer Mode connector URL/token.

### Worktree creation fails

Check:

```bash
git status
git worktree list
```

Common causes:

- Branch already exists.
- `fromRef` does not exist locally.
- The repo has uncommitted changes that conflict with worktree setup.
- `worktreeRoot` points somewhere unavailable.

### Docker run fails

Check:

```bash
docker version
node bin/relai-mcp-config.js set allowDocker true
```

Also verify the image is listed in `allowedDockerImages` for the workspace.

### PR creation fails

Check:

```bash
gh auth status
node bin/relai-mcp-config.js set allowGitHubCli true
```

Also verify the workspace branch is pushed or pushable and the repo has an `origin` remote.

---

## v0.5 Codex-like workflow

A normal full task flow now looks like this:

```text
relai_task_bootstrap
-> relai_context_pack / relai_index_search
-> relai_plan_step_update
-> relai_apply_patch_and_run or relai_patch_test_loop
-> relai_git_diff
-> relai_approval_request when a configured gate requires it
-> relai_commit_all
-> relai_push_branch
-> relai_create_pr
-> relai_pr_watch_checks / relai_ci_repair_snapshot
-> patch again if needed
-> relai_task_worktree_remove after review
```

For issue-driven work:

```text
relai_issue_to_pr_bootstrap
-> implement in the generated worktree
-> run validation
-> commit/push/create draft PR
-> watch PR checks
-> repair failures
```

The server still does not silently browse arbitrary disk paths. Everything is scoped to configured workspace aliases and task worktrees.

---

## Version history

### 0.5.0

- Adds persistent implementation plans stored under `stateDir/plans`.
- Adds plan tools: `relai_plan_create`, `relai_plan_list`, `relai_plan_read`, `relai_plan_update`, `relai_plan_step_update`, and `relai_plan_step_append`.
- Adds approval gates stored under `stateDir/approvals`.
- Adds approval tools: `relai_approval_request`, `relai_approval_read`, `relai_approval_list`, and `relai_approval_resolve`.
- Adds configurable `approvalGates` for write, patch, command, Docker, commit, push, PR, reset, and worktree removal actions.
- Adds one-time `approvalId` consumption for gated actions so a single approval cannot be reused accidentally.
- Adds repository indexing stored under `stateDir/indexes`, including file hashes, line counts, extensions, and simple symbol extraction.
- Adds index tools: `relai_index_build`, `relai_index_stats`, and `relai_index_search`.
- Adds `relai_task_bootstrap` to create a task session, worktree, index, and plan in one call.
- Adds `relai_issue_to_pr_bootstrap`, which uses GitHub CLI issue metadata to bootstrap an implementation session and branch.
- Adds `relai_ci_repair_snapshot` to capture PR check output and attach repair guidance to the task session.
- Adds cooperative locks stored under `stateDir/locks` with acquire/list/release tools.
- Adds `relai_dashboard_summary` for ChatGPT-side operational status.
- Adds HTTP `/dashboard` and `/api/dashboard` endpoints for a lightweight local dashboard.
- Adds config fields: `maxPlanSteps`, `maxIndexFiles`, `maxIndexFileBytes`, `maxConcurrentSessionsPerWorkspace`, `sessionLocksEnabled`, `dashboardEnabled`, and `approvalGates`.
- Adds `npm run test:v5`, covering bootstrap, plans, index search, locks, approvals, gated commit, dashboard summary, and worktree cleanup.

### 0.4.0

- Adds worktree-per-task isolation through `relai_task_worktree_create`.
- Adds session-aware workspace resolution: tools that accept `sessionId` automatically operate inside the attached task worktree instead of the base workspace.
- Adds `relai_task_worktree_remove` for guarded task worktree cleanup.
- Adds `relai_worktree_list` for inspecting Git worktrees.
- Adds `relai_git_reset_worktree` for hard reset and optional clean of task worktrees.
- Adds background job support: `relai_job_start_command`, `relai_job_status`, `relai_job_list`, and `relai_job_cancel`.
- Adds a persistent `stateDir/jobs` store for background job metadata and log file paths.
- Adds Docker sandbox hooks with `relai_docker_run`, using allowlisted images and configured test/dev commands only.
- Adds `allowDocker`, `defaultDockerImage`, `allowedDockerImages`, `dockerNetworkNone`, and `dockerUser` config fields.
- Adds permission profiles: `read-only`, `patch`, `test`, `pr`, and `admin`.
- Adds `permissionProfile` to public config summaries and permission enforcement for every MCP tool call.
- Adds `relai_patch_test_loop` for multi-cycle patch/test iteration.
- Adds `relai_pr_watch_checks` for polling GitHub CLI PR checks and returning a timeline useful for CI repair loops.
- Adds global and per-workspace `worktreeRoot` configuration.
- Raises default `maxTreeEntries` from 5,000 to 12,000 and `maxSessionSteps` from 300 to 1,000.
- Updates CLI `set` support for `allowDocker`, `allowDestructiveTools`, `permissionProfile`, and `worktreeRoot`.
- Adds `npm run test:v4`, covering task session creation, worktree creation, session-aware file reads, patch/test loop, background job execution, worktree reset, and worktree removal.
- Updates README, example config, and security guidance for task worktrees, jobs, Docker, and permission profiles.

### 0.3.0

- Converts Rel.AI MCP from a thin MCP patch runner into a full Codex-like task runner.
- Adds persistent task sessions stored under `stateDir/sessions`, including start/list/read/append/update flows.
- Adds audit logging to `audit.jsonl` for every tool call with tool name, workspace, session id, result status, and duration.
- Adds `relai_version` for server/version/capability discovery.
- Adds `relai_audit_tail` for quick diagnostics from ChatGPT.
- Adds `relai_write_file` for guarded text-file creation/replacement with secret-path blocking, traversal blocking, workspace-escape blocking, size limits, and optional `expectedSha256` optimistic locking.
- Adds `relai_context_pack` to combine a filtered tree, explicit file reads, and search hits into one focused context result.
- Adds `relai_workspace_profile` to detect common stack manifests such as `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `composer.json`, `Gemfile`, and `pubspec.yaml`.
- Adds `relai_apply_patch_and_run`, the main build/verify loop tool that applies a diff and runs selected test commands.
- Adds `relai_run_test_matrix` for multi-command validation such as unit + lint + typecheck.
- Adds `relai_run_command` for locally configured dev commands, plus an explicit opt-in path for arbitrary commands when advanced users need it.
- Adds Git tools for log, show, and guarded branch switching.
- Expands PR creation to support draft mode, labels, reviewers, explicit base/head, and workspace default base branches.
- Adds `relai_pr_checks` to inspect PR checks through GitHub CLI.
- Adds workspace-level `commands`, `allowedRemotes`, `defaultBaseBranch`, `repoSlug`, `allowArbitraryCommands`, and `allowDestructiveTools` config fields.
- Adds global `stateDir`, `auditLogPath`, `maxWriteFileBytes`, `maxSessionSteps`, `allowArbitraryCommands`, and `allowDestructiveTools` config fields.
- Raises default file/tree/output limits for real project work: 300 KB reads/search, 600 KB writes, 5,000 tree entries, and 2 MB command output.
- Adds `npm run cmd:add` for allowlisted dev commands.
- Adds `npm run test:workflow`, which creates a temporary Git repo and verifies task session creation, branch creation, safe file write, allowlisted test execution, and session step recording.
- Updates docs to describe a complete ChatGPT-to-PR workflow rather than only patch application.

### 0.2.0

- Adds remote HTTP JSON-RPC endpoint: `POST /mcp`.
- Adds SSE compatibility endpoint: `GET /sse` plus `POST /messages?sessionId=...`.
- Adds bearer-token authentication for remote transport.
- Adds health endpoint: `GET /health`.
- Adds HTTP smoke test.
- Keeps local stdio MCP server support.
- Keeps zero runtime npm dependencies.

### 0.1.0

- Adds initial local stdio MCP server.
- Adds safe workspace aliases.
- Adds filtered workspace tree.
- Adds safe text-file reads.
- Adds literal workspace search.
- Adds unified diff patch check/apply through Git.
- Adds allowlisted test command execution.
- Adds Git status/diff/branch/commit/push tools.
- Adds optional draft PR creation through GitHub CLI.
- Adds basic security documentation.
