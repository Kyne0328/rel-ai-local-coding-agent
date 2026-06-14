# Security

## Authentication model

Rel.AI MCP exposes three auth modes for its HTTP server.

### `POST /mcp` with OAuth 2.1 — the ChatGPT connector flow (real authentication)

ChatGPT connects with **Authentication: OAuth**. The server acts as its own OAuth 2.1 authorization server and resource server:

- `POST /mcp` without a valid token returns `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
- ChatGPT discovers endpoints via `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, registers a client at `/register` (RFC 7591), and runs the authorization-code flow with **PKCE (S256, required)** via `/authorize` and `/token`.
- The `/authorize` sign-in page requires the **`REL_AI_MCP_TOKEN`** (your dashboard token) before it mints a single-use authorization code. That token is the human approval step — keep it private.
- Authorization codes are single-use and short-lived (5 min). Access tokens expire (1 h) and are renewed with rotating refresh tokens. Issued tokens persist to a `0600` `oauth-store.json` in the state dir so ChatGPT need not re-authorize on every restart.
- OAuth requires the server to be reachable over **HTTPS** (use a stable public URL/tunnel). Never expose the authorization endpoints over plain HTTP on a public interface.

### `POST /mcp` (plain) — Bearer token authentication

Requires `Authorization: Bearer <REL_AI_MCP_TOKEN>` on every request. Intended for local API clients, Claude Code, and automation that can pass a bearer header. The same endpoint also accepts OAuth-issued access tokens.

### `/mcp/<secret>` — legacy secret-path (removed)

The unauthenticated secret-in-URL path has been **removed**. `/mcp/<secret>`, `/sse/<secret>`, and `/messages/<secret>` are no longer special routes and return `401`/`404`. Access to `/mcp` is granted only by OAuth (ChatGPT) or a `Bearer` token (local/API clients) — there is no unauthenticated entry path. `REL_AI_MCP_CHATGPT_SECRET` is no longer used for access.

### Dashboard and API endpoints

`GET /dashboard`, `GET /api/settings`, `GET /api/dashboard/v10`, and all other `/api/*` routes require either:

- `Authorization: Bearer <REL_AI_MCP_TOKEN>` header, or
- `?token=<REL_AI_MCP_TOKEN>` query parameter (used by the browser dashboard).

Set `REL_AI_MCP_ALLOW_NO_AUTH=1` only for local-only testing on a trusted network.

## Security protections (what the server defends against)

- **Accidental sensitive path reads** — workspace path check rejects access to `.env`, `.ssh`, and credential files.
- **Workspace path escape** — all file operations resolve against the configured workspace root; symlinks and traversal sequences (`../`) are blocked.
- **Binary-looking file reads/writes** — tools decline to read or write files that appear to contain binary content.
- **Oversized output overload** — snapshot and read tools enforce byte caps on returned file content.
- **Stale exact replacements** — `relai_replace` accepts an optional content hash; if provided and the file has changed, the replacement is rejected rather than silently applied to the wrong content.
- **Unreviewed changes through diff/restore loop** — `relai_diff` and `relai_restore_changes` are discrete tools; restoration requires an explicit call, not an automatic side-effect.
- **Oversized request bodies** — the HTTP server enforces `REL_AI_MCP_MAX_BODY_BYTES` (default 10 MB) and rejects requests that exceed it.
- **Public diagnostic redaction** — browser-facing MCP diagnostics avoid returning the ChatGPT secret or bearer token to unauthenticated callers.

## Limits (what it does NOT protect against)

- **User exposing the dashboard token** — the `REL_AI_MCP_TOKEN` approves ChatGPT's OAuth sign-in and authenticates local/API bearer calls. Anyone who obtains it can complete the OAuth flow or call `/mcp` directly. Rotate the token (`--reset-token`) and restart if it leaks.
- **Unsafe workspace configuration** — pointing a workspace alias at a system directory (e.g. `C:\Windows` or `/etc`) is not prevented; only add paths you trust ChatGPT to modify.
- **Asking ChatGPT to run destructive validation checks** — `relai_run_checks` executes the commands you configured. Malicious or mistaken prompt engineering can trigger them.
- **Malicious code already inside the workspace** — if the repository contains code that harms your system when executed, running `relai_run_checks` on it can trigger that harm.

## Tool surface

```text
inspect:  relai_repo_snapshot -> relai_read
change:   relai_edit (exact replace / full-file / patch / batch) / relai_apply_bundle / relai_clear_files
validate: relai_run_checks
review:   relai_diff
restore:  relai_restore_changes
```

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect and modify.
