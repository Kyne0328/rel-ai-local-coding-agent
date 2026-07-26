# Security

## Authentication model

Rel.AI MCP exposes one protected MCP endpoint at `POST /mcp`.

### ChatGPT connector: OAuth 2.1 with PKCE

ChatGPT connects with **OAuth**. Rel.AI MCP acts as both authorization server and resource server:

- Unauthenticated `POST /mcp` returns `401` with a Bearer challenge pointing to `/.well-known/oauth-protected-resource`.
- ChatGPT discovers the authorization server, dynamically registers a client, and uses the authorization-code flow with PKCE S256.
- The `/authorize` page requires the current approval token (`REL_AI_MCP_TOKEN`) before issuing a short-lived, single-use authorization code.
- Access tokens expire after one hour and can be renewed with rotating refresh tokens.
- OAuth state is stored in the Rel.AI state directory with restricted file permissions.
- When the same static MCP URL moves to another computer, an existing Rel.AI-issued client ID can be restored only through a fresh approval-token authorization. Recovery accepts only Rel.AI client-ID format, requires an HTTPS redirect URI, and does not import old access or refresh tokens.
- Replacing the approval token revokes pending authorization codes plus all issued access and refresh tokens, while preserving registered ChatGPT clients so the existing app can be approved again.
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
- Sensitive paths are classified by reason separately from structural path validation. `known_hosts` is public trust metadata. Existing `.npmrc` and `.pypirc` files are accessible only when content inspection finds no credential assignments; certificate-only or public-key PEM files are accessible, while private-key PEM remains blocked. Files in ambiguously named `secret` or `credentials` locations may be accessed only when bounded text inspection finds no credential material. Raw reads, full writes, replacements, review, and deletion remain denied by default. `relai_edit` supports narrow `.env` operations for listing key names, setting one key, removing one key, and comparing key names with a public template; these operations never return values or raw secret-bearing lines. A narrowly scoped Git commit may include sensitive paths only through `sensitiveAuthorization:{ operation:'commit', paths:[...], reason:'...' }`; every staged sensitive path must match the authorization. The legacy `allowSecretPaths:true` form is accepted only with explicit `paths` during migration. Public environment templates remain ordinary repository files.
- Binary-looking files are rejected by text read and write paths.
- Read, snapshot, diff, process output, and HTTP request bodies are bounded.
- Exact replacement can use the SHA-256 returned by `relai_read`; stale hashes fail closed.
- Git push is restricted to workspace `allowedRemotes`.
- Git commit requires exact path-scoped authorization for sensitive staged files.
- `relai_diff` with `redactSensitive:true` omits raw sensitive hunks. Environment-file summaries disclose only added, removed, changed key names, malformed line numbers, and status metadata; other sensitive files disclose path and status only.
- Automatic session baselines distinguish current-session changes from a worktree that was already dirty.
- Untracked cleanup requires a short-lived tidy plan and revalidates file ownership, file type, and hash before deletion.
- Patch-shaped edits can require a clean worktree and can create a tracked-change backup before application.

## Electron renderer and IPC boundary

- The dashboard, setup wizard, and failure-recovery renderer use context isolation with Node integration disabled. The local setup and recovery windows additionally run in Chromium's sandbox with web security enabled.
- Setup and recovery pages have a strict Content Security Policy. Renderer permissions, downloads, attached webviews, popups, redirects, and navigation to any file or URL other than the configured local page are denied.
- Every desktop IPC channel checks the sending `BrowserWindow`. Setup actions are accepted only from setup, failure-recovery actions only from the fallback window, and routine settings, lifecycle, updater, diagnostics, restart, and stop actions only from the secured dashboard.
- Clipboard IPC accepts only known Rel.AI windows, removes NUL characters, and rejects payloads larger than 64 KiB. Setup external links require HTTPS and the exact `dashboard.ngrok.com` hostname.
- The ngrok account key is write-only after initial entry. The renderer receives only `ngrokAuthtokenConfigured`; a blank save preserves the existing key and a nonblank save replaces it.
- Approval-token replacement saves the replacement before revocation, rolls the old token back when OAuth revocation fails, and returns the new token with restart guidance when only the service restart fails.

## Application update boundary

- Update discovery and downloads run only in the Electron main process. The sandboxed dashboard receives normalized status and invokes constrained actions through preload IPC.
- Update IPC rejects any sender other than the secured dashboard window.
- Installed Windows builds read release metadata from the configured GitHub Releases provider. Portable and development builds do not claim automatic update support.
- Candidate update metadata must contain a strictly formatted stable version that is newer than the installed version. Prefixed, prerelease, same-version, and downgrade candidates fail closed.
- The downloaded version must exactly match the version previously advertised. Installation remains disabled until electron-updater completes its SHA-512 release-metadata verification and the normalized state records `integrityVerified: true`.
- Downloads and installation are never automatic. The user explicitly starts the download and explicitly chooses restart-to-install.
- Restart-to-install is blocked while a Rel.AI tool call is active.
- Updater logs use the same bounded sanitized runtime-log path as other desktop diagnostics and do not include approval tokens, ngrok account keys, or dashboard credentials.
- GitHub releases include `SHA256SUMS.txt` for the installer, portable executable, `latest.yml`, and blockmap. These checksums detect byte changes but do not prove publisher identity.
- Windows release artifacts are currently unsigned. Users may see an unidentified-publisher warning until a Windows code-signing certificate and protected signing workflow are configured.

## Desktop lifecycle boundary

- Lifecycle state and startup settings are owned by Electron main; renderer access is constrained to the secured dashboard sender.
- `desktop-lifecycle.json` contains no approval token, ngrok credentials, workspace paths or contents, or OAuth grants.
- Installed Windows startup registration explicitly targets the packaged executable with `--background`; portable and development builds never register startup entries.
- Unclean-exit detection is diagnostic metadata only. It does not trigger destructive recovery or modify repository state.

## Remaining trust boundaries

Rel.AI MCP is a trusted local coding bridge, not a sandbox.

- Anyone who obtains `REL_AI_MCP_TOKEN` can authorize or call the server. Use **Settings > Connection > Replace approval token** if it leaks; the operation revokes existing OAuth grants and restarts the connection.
- Validation commands execute code configured by the workspace. A malicious repository can cause system or data impact when tests, builds, or analyzers run.
- ChatGPT can modify any non-sensitive file inside a configured workspace through the active tools.
- Git push publishes to allowlisted remotes; review the diff before committing or pushing.

## Tool workflow

```text
inspect:  relai_repo_snapshot -> relai_read
change:   relai_edit
validate: relai_run_checks
review:   relai_diff / relai_status with workspace
recover:  relai_restore_paths / relai_reset_workspace / relai_tidy_plan + relai_tidy_run
publish:  relai_git_commit -> relai_git_push
review text: relai_git_draft_pr
```

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect, execute, and modify.
