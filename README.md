# Rel.AI MCP

Rel.AI MCP is a full MCP-based Codex-like coding runner for ChatGPT. It lets ChatGPT inspect configured workspaces, read and write safe text files, create task sessions, apply patches, run allowlisted tests, inspect failures, patch again, commit, push, and create draft pull requests.

This repo is the MCP successor to the original Rel.AI browser-extension/native-host flow.

```text
ChatGPT
-> MCP tool: create task session
-> MCP tool: inspect workspace tree/profile
-> MCP tool: read/search files
-> MCP tool: create feature branch
-> MCP tool: write files or apply validated patch
-> MCP tool: run allowlisted tests/test matrix
-> MCP tool: inspect failures and patch again
-> MCP tool: commit, push, create draft PR, inspect checks
```

## Version

Current version: `0.3.0`

## What v0.3 adds

v0.3 turns the prototype into a full-fledged Codex-like runner instead of a patch-only bridge.

- Adds persistent task sessions: start, list, read, append steps, and update status/summary.
- Adds audit logging for every tool call, including timing and success/failure.
- Adds safe direct text-file writes with path validation, size limits, secret blocking, and optional `expectedSha256` optimistic locking.
- Adds a focused context pack tool: tree + selected files + search hits.
- Adds workspace profile detection for common manifests and project stacks.
- Adds apply-patch-and-run-tests in one tool for build/verify loops.
- Adds test matrix execution across multiple allowlisted test commands.
- Adds configured dev command execution via workspace `commands`.
- Adds opt-in arbitrary command support for advanced users only, guarded by config and command policy.
- Adds Git log/show/switch branch tools.
- Adds GitHub CLI PR checks.
- Adds richer PR creation support: labels, reviewers, base/head, draft mode.
- Raises default tree/search/read/output limits for real projects.
- Adds `relai_version` and `relai_audit_tail` tools.
- Adds `test:workflow`, a real temporary Git repo smoke test covering task/session/branch/write/test behavior.
- Expands README with original Rel.AI-style version history.

## What is still intentionally guarded

Full-fledged does not mean reckless. These are still blocked or opt-in:

- No secret-file reads or writes.
- No full-disk access.
- No unbounded command execution by default.
- No direct commits to protected branches.
- No protected branch pushes.
- No force-push tool.
- No auto-merge tool.
- No deploy tool.
- No destructive branch/file cleanup unless explicitly enabled in config.

## Requirements

- Node.js 18+
- Git available on `PATH`
- Optional: GitHub CLI `gh`, only if you enable PR creation/checks
- Optional: HTTPS tunnel/reverse proxy for ChatGPT Developer Mode remote MCP access

## Install

```bash
npm install
npm run check
npm run test:smoke
npm run test:http
npm run test:workflow
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

Enable GitHub CLI actions only when you want PR creation/checks:

```bash
node bin/relai-mcp-config.js set allowGitHubCli true
```

Example config:

```json
{
  "version": 1,
  "stateDir": "/Users/you/.rel-ai-mcp",
  "auditLogPath": "",
  "maxReadFileBytes": 300000,
  "maxWriteFileBytes": 600000,
  "maxSearchFileBytes": 300000,
  "maxOutputBytes": 2097152,
  "commandTimeoutMs": 1200000,
  "maxTreeEntries": 5000,
  "maxSessionSteps": 300,
  "allowGitHubCli": false,
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
      }
    }
  }
}
```

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
-> your configured workspace
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

### Task session tools

- `relai_task_start` - create a persistent task session.
- `relai_task_list` - list recent task sessions.
- `relai_task_read` - read full task session details.
- `relai_task_step` - append a plan/test/patch/PR note.
- `relai_task_update` - update session status, branch, or summary.

Use sessions to make long ChatGPT coding work behave more like Codex tasks.

### Workspace/context tools

- `relai_workspace_tree` - filtered safe file tree.
- `relai_workspace_profile` - manifest/stack detection.
- `relai_read_files` - read safe text files.
- `relai_write_file` - write safe text files with optional SHA locking.
- `relai_search` - literal local text search.
- `relai_context_pack` - focused context pack from paths and search terms.

### Patch/test tools

- `relai_apply_patch` - check or apply unified diff.
- `relai_apply_patch_and_run` - apply patch and run selected tests.
- `relai_run_test` - run one allowlisted test command.
- `relai_run_test_matrix` - run multiple allowlisted test commands.
- `relai_run_command` - run configured dev command; arbitrary commands require explicit opt-in.

### Git/PR tools

- `relai_git_status` - branch, clean/dirty state, short status.
- `relai_git_diff` - unstaged/staged diff.
- `relai_git_log` - recent commits.
- `relai_git_show` - show one commit/ref.
- `relai_create_branch` - create and switch to feature branch.
- `relai_switch_branch` - switch branches with guardrails.
- `relai_commit_all` - stage and commit all changes.
- `relai_push_branch` - push feature branch to allowlisted remote.
- `relai_create_pr` - create draft PR through GitHub CLI.
- `relai_pr_checks` - inspect PR checks through GitHub CLI.

## Recommended Codex-like workflow prompt

```text
Use Rel.AI MCP on workspace myapp.
Start a task session for this goal.
Inspect the workspace profile and tree.
Read the smallest set of files needed.
Create a feature branch.
Make the change using patches or safe file writes.
Run unit, lint, and typecheck.
If a test fails, inspect the failure and patch again.
When tests pass, show the diff, commit, push, and create a draft PR.
Never touch secrets or protected branches.
```

## Security model

Rel.AI MCP uses layered safety checks:

1. Workspace aliases are explicit. ChatGPT cannot browse arbitrary disk paths.
2. All file paths are relative and validated against traversal and workspace escape.
3. Secret-looking paths are blocked.
4. Binary-looking files are skipped.
5. Writes are text-only and size-limited.
6. Tests and commands are allowlisted by default.
7. Arbitrary commands are disabled unless explicitly enabled.
8. GitHub CLI actions are disabled unless explicitly enabled.
9. Protected branches are blocked for commits/pushes.
10. Every tool call is written to an audit log.

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

### PR creation fails

Check:

```bash
gh auth status
node bin/relai-mcp-config.js set allowGitHubCli true
```

Also verify the workspace branch is pushed or pushable and the repo has an `origin` remote.

---

## Version history

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
