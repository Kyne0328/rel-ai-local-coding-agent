# Security Model

Rel.AI MCP is designed for coding-agent workflows without handing the model unrestricted shell or disk access.

## Main guarantees

- Workspace access is limited to configured aliases.
- Paths must be relative and must stay inside the workspace root.
- Secret-looking paths are blocked.
- Binary-looking and oversized files are blocked for reads/searches.
- Patch paths are validated before `git apply` runs.
- Test execution uses configured `testCommandKey` values only.
- Commits and pushes are refused on protected branches.
- Remote HTTP/SSE transport requires bearer-token auth unless explicitly disabled.

## Blocked sensitive paths

Examples:

```text
.env
.ssh/
.aws/
.azure/
gcloud/credentials
*.pem
*.key
*.p12
*.pfx
.npmrc
.pypirc
.netrc
firebase-adminsdk*.json
service-account*.json
```

## Remote transport rules

Use:

```bash
REL_AI_MCP_TOKEN="strong-random-token" npm run start:http
```

Do not expose the server over a public URL without a token.

`REL_AI_MCP_ALLOW_NO_AUTH=1` exists only for local testing.

## Safe command policy

There is no arbitrary command tool. Tests must be configured locally:

```json
{
  "workspaces": {
    "myapp": {
      "testCommands": {
        "unit": "npm test",
        "lint": "npm run lint"
      }
    }
  }
}
```

The model can request `unit`; it cannot provide a new shell command unless you add it to the config.

## Recommended setup

- Use a disposable/sandbox workspace first.
- Keep `allowGitHubCli` disabled until you are ready for PR creation.
- Use draft PRs.
- Keep protected branches set to at least `main` and `master`.
- Review diffs before commit/push.
- Never add deploy, force-push, delete-repo, or secret-reading tools.
