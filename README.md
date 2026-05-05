# Rel.AI MCP

MCP-based Codex-like local coding runner for ChatGPT.

This is a first version of the cleaner Rel.AI architecture:

```text
ChatGPT
-> MCP tool: inspect workspace
-> MCP tool: read selected files
-> MCP tool: apply validated patch
-> MCP tool: run allowlisted tests
-> MCP tool: inspect output
-> MCP tool: patch again
-> MCP tool: commit, push, and create a draft PR
```

It replaces the original browser-extension prompt-insertion flow with direct MCP tools.

## What this v1 includes

- Local stdio MCP server using newline-delimited JSON-RPC.
- No external npm dependencies.
- Workspace aliases stored in a local config file.
- Safe file-tree generation.
- Safe text-file reads.
- Literal workspace search.
- Unified diff application through `git apply --check` and `git apply --whitespace=warn`.
- Allowlisted test command execution by `testCommandKey`.
- Git status and diff tools.
- Feature branch creation.
- Commit all changes.
- Push feature branch.
- Optional draft PR creation through GitHub CLI.

## What this v1 intentionally does not include

- No arbitrary shell command tool.
- No silent full-disk access.
- No delete-file tool.
- No deploy tool.
- No force-push tool.
- No auto-merge tool.
- No secret-file reads.

## Requirements

- Node.js 18+
- Git available on PATH
- Optional: GitHub CLI `gh`, only if you enable PR creation

## Install

```bash
npm install
npm run check
```

No dependencies are currently installed; `npm install` mainly creates your lockfile if you want one.

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

Example config:

```json
{
  "version": 1,
  "allowGitHubCli": false,
  "workspaces": {
    "myapp": {
      "path": "/absolute/path/to/myapp",
      "protectedBranches": ["main", "master"],
      "testCommands": {
        "unit": "npm test",
        "lint": "npm run lint"
      }
    }
  }
}
```

## Connect as an MCP server

Use this shape in your MCP client or ChatGPT Developer Mode connector setup:

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

If you use the default config path, the `env` block can be omitted.

## Available tools

### `relai_config`

Returns config path, limits, configured workspace aliases, and test command keys.

### `relai_workspace_tree`

Returns a safe filtered workspace tree.

```json
{ "workspace": "myapp", "maxEntries": 1500 }
```

### `relai_read_files`

Reads specific text files.

```json
{ "workspace": "myapp", "paths": ["package.json", "src/index.ts"] }
```

### `relai_search`

Literal text search across safe text files.

```json
{ "workspace": "myapp", "query": "refreshToken", "maxMatches": 50 }
```

### `relai_apply_patch`

Checks or applies a unified diff.

```json
{ "workspace": "myapp", "diff": "diff --git ...", "dryRun": true }
```

Use `dryRun: true` before real application.

### `relai_run_test`

Runs a locally configured test command.

```json
{ "workspace": "myapp", "testCommandKey": "unit" }
```

### `relai_git_status`

Returns branch and short status.

```json
{ "workspace": "myapp" }
```

### `relai_git_diff`

Returns unstaged or staged diff.

```json
{ "workspace": "myapp", "staged": false }
```

### `relai_create_branch`

Creates and switches to a feature branch.

```json
{ "workspace": "myapp", "branchName": "relai/fix-auth-refresh" }
```

### `relai_commit_all`

Stages and commits all changes. Refuses protected branches.

```json
{ "workspace": "myapp", "message": "Fix auth refresh handling" }
```

### `relai_push_branch`

Pushes current or named feature branch.

```json
{ "workspace": "myapp", "remote": "origin" }
```

### `relai_create_pr`

Creates a draft PR through GitHub CLI. Disabled unless `allowGitHubCli` is `true`.

```json
{
  "workspace": "myapp",
  "title": "Fix auth refresh handling",
  "body": "Summary and validation notes.",
  "base": "main",
  "draft": true
}
```

## Suggested agent loop

Ask ChatGPT to follow this order:

```text
1. relai_git_status
2. relai_workspace_tree
3. relai_search / relai_read_files
4. relai_create_branch
5. relai_apply_patch with dryRun true
6. relai_apply_patch with dryRun false
7. relai_run_test
8. relai_read_files / relai_apply_patch again if tests fail
9. relai_git_diff
10. relai_commit_all
11. relai_push_branch
12. relai_create_pr or use ChatGPT's GitHub connector to open the PR
```

## Smoke test

```bash
npm run check
npm run test:smoke
```

The smoke test starts the MCP server, sends `initialize` and `tools/list`, and verifies that tools are returned.

## Notes

This is v0.1.0. It is deliberately small. The next version should add:

- direct file write tool with strong approval boundaries,
- structured patch summaries,
- test failure extraction,
- optional GitHub API integration without requiring `gh`,
- OpenCode fallback integration,
- audit log file under `.relai-mcp/`,
- workspace-level tool permissions.
