# Security

## Authentication model

Rel.AI MCP exposes one protected MCP endpoint at `POST /mcp`.

### ChatGPT connector: OAuth 2.1 with PKCE

ChatGPT connects with **OAuth**. Rel.AI MCP acts as both authorization server and resource server:

- Unauthenticated `POST /mcp` returns `401` with a Bearer challenge pointing to `/.well-known/oauth-protected-resource`.
- ChatGPT discovers the authorization server, dynamically registers a client, and uses the authorization-code flow with PKCE S256.
- The `/authorize` page requires `REL_AI_MCP_TOKEN` before issuing a short-lived, single-use authorization code.
- Access tokens expire after one hour and can be renewed with rotating refresh tokens.
- OAuth state is stored in the Rel.AI state directory with restricted file permissions.
- A public ChatGPT connection must use HTTPS.

### Local and automation clients: Bearer token

Local API clients may call the same `/mcp` endpoint with:

```text
Authorization: Bearer <REL_AI_MCP_TOKEN>
```

OAuth-issued access tokens are accepted by the same endpoint.

### Removed secret-in-URL routes

Secret-bearing MCP paths are not supported. `/mcp/<secret>`, `/sse/<secret>`, and `/messages/<secret>` do not grant access. Use OAuth or an Authorization header.

### Dashboard and API endpoints

`GET /dashboard` and `/api/*` routes require either:

- `Authorization: Bearer <REL_AI_MCP_TOKEN>`, or
- `?token=<REL_AI_MCP_TOKEN>` for the browser dashboard.

Set `REL_AI_MCP_ALLOW_NO_AUTH=1` only for local testing on a trusted machine.

## Workspace protections

- Workspace roots must be absolute project directories. System roots and common operating-system directories are rejected.
- File operations are resolved against the configured workspace root.
- Traversal, absolute-path injection, and symlink escape are blocked.
- Sensitive paths such as `.env`, `.ssh`, private keys, credential stores, and cloud configuration are blocked.
- Binary-looking files are rejected by text read and write paths.
- Read, snapshot, diff, process output, and HTTP request bodies are bounded.
- Exact replacement can use the SHA-256 returned by `relai_read`; stale hashes fail closed.
- Git push is restricted to workspace `allowedRemotes`.
- Git commit refuses secret-looking staged files unless the caller explicitly overrides that safeguard.
- Automatic session baselines distinguish current-session changes from a worktree that was already dirty.
- Untracked cleanup requires a short-lived tidy plan and revalidates file ownership, file type, and hash before deletion.
- Patch-shaped edits can require a clean worktree and can create a tracked-change backup before application.

## Remaining trust boundaries

Rel.AI MCP is a trusted local coding bridge, not a sandbox.

- Anyone who obtains `REL_AI_MCP_TOKEN` can authorize or call the server. Rotate the token and restart if it leaks.
- Validation commands execute code configured by the workspace. A malicious repository can cause system or data impact when tests, builds, or analyzers run.
- ChatGPT can modify any non-sensitive file inside a configured workspace through the active tools.
- Git push publishes to allowlisted remotes; review the diff before committing or pushing.

## Tool workflow

```text
inspect:  relai_repo_snapshot -> relai_read
change:   relai_edit / relai_write / relai_replace
validate: relai_run_checks
review:   relai_diff / relai_git_status
cleanup:  relai_restore_changes / relai_tidy_plan + relai_tidy_run
publish:  relai_git_commit -> relai_git_push -> relai_git_create_pr
```

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect, execute, and modify.
