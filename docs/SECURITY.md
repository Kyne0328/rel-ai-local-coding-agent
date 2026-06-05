# Security

## Authentication model

Rel.AI MCP exposes three auth modes for its HTTP server.

### `/mcp/<secret>` — secret-path authentication (ChatGPT "No Authentication" flow)

The secret segment of the URL acts as a shared credential. Any client that knows the full URL can POST JSON-RPC without sending an `Authorization` header. This is the correct mode for ChatGPT's "No Authentication" connector.

- Treat the URL like a password. Do not share it in screenshots, logs, or public issues.
- Rotate `REL_AI_MCP_CHATGPT_SECRET` if it is exposed.
- Only publish this URL over a stable HTTPS tunnel; never over plain HTTP on a public interface.
- Public `GET /mcp` browser diagnostics redact this secret. The full URL is shown only to callers that already have the bearer token or are using the secret path.

### `POST /mcp` (plain) — Bearer token authentication

Requires `Authorization: Bearer <REL_AI_MCP_TOKEN>` on every request. Intended for local API clients, Claude Code, and automation that can pass a bearer header.

### Dashboard and API endpoints

`GET /dashboard`, `GET /api/settings`, `GET /api/dashboard/v10`, and all other `/api/*` routes require either:

- `Authorization: Bearer <REL_AI_MCP_TOKEN>` header, or
- `?token=<REL_AI_MCP_TOKEN>` query parameter (used by the browser dashboard).

`GET /api/local-connect` is a public reachability/discovery endpoint for local tools, but it only returns the bearer token when the caller already proves it has the bearer/query token. Unauthenticated callers receive the base URL without token material.

Set `REL_AI_MCP_ALLOW_NO_AUTH=1` only for local-only testing on a trusted network.

## Security protections (what the server defends against)

- **Accidental sensitive path reads** — workspace path check rejects access to `.env`, `.ssh`, and credential files.
- **Workspace path escape** — all file operations resolve against the configured workspace root; symlinks and traversal sequences (`../`) are blocked.
- **Binary-looking file reads/writes** — tools decline to read or write files that appear to contain binary content.
- **Oversized output overload** — snapshot and read tools enforce byte caps on returned file content.
- **Stale exact replacements** — `relai_replace` accepts an optional content hash; if provided and the file has changed, the replacement is rejected rather than silently applied to the wrong content.
- **Unreviewed changes through diff/restore loop** — `relai_diff` and `relai_restore_changes` are discrete tools; restoration requires an explicit call, not an automatic side-effect.
- **Oversized request bodies** — the HTTP server enforces `REL_AI_MCP_MAX_BODY_BYTES` (default 10 MB) and rejects requests that exceed it.
- **Public diagnostic redaction** — browser-facing MCP diagnostics and local discovery avoid returning the ChatGPT secret or bearer token to unauthenticated callers.

## Limits (what it does NOT protect against)

- **User exposing `/mcp/<secret>` URL** — once the secret URL is known to a third party, that party has full workspace-tool access. Rotate the secret and restart.
- **Unsafe workspace configuration** — pointing a workspace alias at a system directory (e.g. `C:\Windows` or `/etc`) is not prevented; only add paths you trust ChatGPT to modify.
- **Asking ChatGPT to run destructive validation checks** — `relai_run_checks` executes the commands you configured. Malicious or mistaken prompt engineering can trigger them.
- **Leaving extension approval enabled unsupervised** — the Chrome auto-approve extension approves MCP tool calls automatically. Disable it when not actively working.
- **Malicious code already inside the workspace** — if the repository contains code that harms your system when executed, running `relai_run_checks` on it can trigger that harm.

## Tool surface

```text
inspect:  relai_repo_snapshot -> relai_read
change:   relai_replace / relai_write / relai_apply_update / relai_apply_bundle / relai_clear_files
validate: relai_run_checks
review:   relai_diff
restore:  relai_restore_changes
```

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect and modify.
