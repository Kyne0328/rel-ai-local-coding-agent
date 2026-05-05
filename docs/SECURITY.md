# Security Model

Rel.AI MCP is intentionally local, narrow, and allowlist-based.

## Default protections

- Workspace aliases must be configured locally.
- Paths must be relative to the workspace root.
- Path traversal and absolute paths are rejected.
- Sensitive paths such as `.env`, `.ssh`, `.aws`, key files, npm/pypi credentials, service account JSON files, and Firebase admin SDK files are blocked.
- Binary-looking files are skipped when reading or searching.
- Symlinks are skipped while building trees.
- Generated and dependency folders such as `.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, and `target` are skipped in tree/search operations.
- Test execution only accepts locally configured `testCommandKey` values.
- Commits and pushes are refused on protected branches.
- PR creation through GitHub CLI is disabled unless `allowGitHubCli` is set to `true`.

## Dangerous things this v1 does not expose

- No arbitrary shell command tool.
- No delete-file tool.
- No deployment tool.
- No force-push tool.
- No direct merge tool.
- No direct secret-reading tool.

## Recommended workflow

1. Create or switch to a feature branch.
2. Read only the files needed for the task.
3. Apply a dry-run patch first.
4. Apply the patch if the dry-run passes.
5. Run an allowlisted test command.
6. Inspect errors and patch again if needed.
7. Commit and push the feature branch.
8. Create a draft PR.
