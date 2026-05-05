# Rel.AI MCP Security Notes

Rel.AI MCP is intentionally powerful. Treat it like a local coding agent with access to your configured projects.

## Core boundaries

- It can only access configured workspace aliases.
- File paths must be relative to a workspace.
- Traversal such as `../` is rejected.
- Absolute paths are rejected.
- Symlinks escaping the workspace are rejected.
- Secret-looking paths are blocked.
- Binary-looking files are skipped.
- Direct writes are text-only and size-limited.
- `expectedSha256` can be used for optimistic locking before writing a file.
- Unified diffs are path-validated before `git apply --check`.
- Protected branch commits and pushes are blocked.

## Blocked sensitive paths

Examples:

```text
.env
.ssh/
id_rsa
id_ed25519
*.pem
*.key
.aws/
.azure/
gcloud/credentials
service-account*.json
firebase-adminsdk*.json
.npmrc
.pypirc
.netrc
.kube/
kubeconfig
```

## Commands

Default behavior:

- `relai_run_test` only runs commands configured in `testCommands`.
- `relai_run_command` only runs commands configured in workspace `commands`.
- Arbitrary commands are disabled.

Advanced behavior:

```json
{
  "allowArbitraryCommands": true
}
```

or workspace-level:

```json
{
  "workspaces": {
    "myapp": {
      "allowArbitraryCommands": true
    }
  }
}
```

Even then, Rel.AI MCP rejects high-risk command patterns such as `rm -rf`, `sudo`, `mkfs`, device writes, recursive `chown`, reboot/shutdown, and obvious production deploy patterns.

## GitHub CLI

PR tools require:

```json
{
  "allowGitHubCli": true
}
```

The server uses your local `gh` authentication. Run:

```bash
gh auth status
```

before enabling PR creation/checks.

## Remote HTTP/SSE server

Never expose the HTTP server without auth.

Use:

```bash
REL_AI_MCP_TOKEN="long-random-token" npm run start:http
```

Avoid:

```bash
REL_AI_MCP_ALLOW_NO_AUTH=1
```

except for local-only testing on `127.0.0.1`.

## Audit logs

Every tool call is logged to:

```text
~/.rel-ai-mcp/audit.jsonl
```

or the configured `auditLogPath`.

The log redacts common secret/token/password field names and truncates very large strings.

## Recommended production settings

```json
{
  "allowGitHubCli": true,
  "allowArbitraryCommands": false,
  "allowDestructiveTools": false,
  "maxReadFileBytes": 300000,
  "maxWriteFileBytes": 600000,
  "maxOutputBytes": 2097152,
  "workspaces": {
    "myapp": {
      "protectedBranches": ["main", "master", "production"],
      "allowedRemotes": ["origin"],
      "testCommands": {
        "unit": "npm test",
        "lint": "npm run lint",
        "typecheck": "npm run typecheck"
      },
      "commands": {
        "build": "npm run build"
      }
    }
  }
}
```
