# Security

## Authentication model

Rel.AI supports two public ChatGPT connection modes over protected MCP endpoints.

### Rel.AI Cloud: OAuth + device-bound pairing

The normal desktop path uses Rel.AI Cloud. ChatGPT authenticates against the hosted service, and the desktop separately proves possession of its locally generated device identity before it can receive routed requests.

- The private device key remains on the desktop and is protected with Electron `safeStorage`; only public identity material is registered remotely.
- Pairing and recovery values are short-lived or user-controlled credentials and must be treated as secrets.
- Revoked or unauthorized devices are not eligible for Cloud routing.
- The public client sends workspace aliases rather than absolute local paths as routing identifiers.
- Repository files, Git operations, commands, tests, builds, and managed processes remain on the selected desktop.
- Knowing the public endpoint, client protocol, or application source does not grant hosted-service authorization.

The hosted authorization, persistence, token lifecycle, routing, abuse controls, and deployment implementation are intentionally maintained outside this public repository.
### Advanced Direct: local OAuth approval token

Direct mode retains the original local OAuth server behind the managed HTTPS ngrok endpoint. In Direct mode only:

- ChatGPT discovers the local authorization server and uses authorization-code + PKCE S256.
- The local `/authorize` page requires the current approval token (`REL_AI_MCP_TOKEN`).
- Replacing that approval token revokes current Direct OAuth authorization/access/refresh state while preserving the registered client where possible.
- The public Direct endpoint must use HTTPS.

Cloud pairing, Cloud OAuth grants, and Direct approval-token rotation are separate security domains; rotating the Direct approval token is not a Cloud reauthentication or tool-schema refresh operation.

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
- `relai_changes` with `action:"diff"` and `redactSensitive:true` omits raw sensitive hunks. Environment-file summaries disclose only added, removed, changed key names, malformed line numbers, and status metadata; other sensitive files disclose path and status only.
- Automatic session baselines distinguish current-session changes from a worktree that was already dirty.
- Untracked cleanup requires a short-lived tidy plan and revalidates file ownership, file type, and hash before deletion.
- Patch-shaped edits can require a clean worktree and can create a tracked-change backup before application.

## Electron renderer and IPC boundary

- The dashboard, setup wizard, and failure-recovery renderer use context isolation with Node integration disabled. The local setup and recovery windows additionally run in Chromium's sandbox with web security enabled.
- Setup and recovery pages have a strict Content Security Policy and load through the restricted `relai-app://renderer` protocol rather than privileged `file://` URLs. Renderer permissions, downloads, attached webviews, popups, redirects, and navigation outside the configured renderer page are denied.
- Every desktop IPC channel checks the sending `BrowserWindow`. Setup actions are accepted only from setup, failure-recovery actions only from the fallback window, and routine settings, lifecycle, updater, diagnostics, restart, and stop actions only from the secured dashboard.
- Clipboard IPC accepts only known Rel.AI windows, removes NUL characters, and rejects payloads larger than 64 KiB. Advanced Direct setup external links require HTTPS and the exact `dashboard.ngrok.com` hostname.
- Passive Cloud gateway status sent to renderers excludes principal ID, private JWK, recovery secret, pairing poll token, and OAuth bearer material. Recovery/link values cross IPC only through explicit sender-scoped actions.
- The Direct ngrok account key remains write-only after initial entry. The renderer receives only whether one is configured; blank saves preserve it and nonblank saves replace it.
- Direct approval-token replacement saves the replacement before revocation, rolls the old token back when revocation fails, and returns the new token with restart guidance when only the service restart fails.

## Application update boundary

- Update discovery and downloads run only in the Electron main process. The sandboxed dashboard receives normalized status and invokes constrained actions through preload IPC.
- Update IPC rejects any sender other than the secured dashboard window.
- Installed Windows builds read release metadata from the configured GitHub Releases provider. Portable and development builds do not claim automatic update support.
- Candidate update metadata must contain a strictly formatted stable version that is newer than the installed version. Prefixed, prerelease, same-version, and downgrade candidates fail closed.
- The downloaded version must exactly match the version previously advertised. Installation remains disabled until electron-updater completes its SHA-512 release-metadata verification and the normalized state records `integrityVerified: true`.
- Downloads and installation are never automatic. The user explicitly starts the download and explicitly chooses restart-to-install.
- Restart-to-install is blocked while a Rel.AI tool call is active.
- Updater logs use the same bounded sanitized runtime-log path as other desktop diagnostics and do not include approval tokens, ngrok account keys, or dashboard credentials.
- GitHub releases include `SHA256SUMS.txt`, a CycloneDX SBOM, and GitHub provenance/SBOM attestations for the installer, portable executable, updater metadata, and blockmap.
- Release publication explicitly disables Windows certificate auto-discovery. Rel.AI-owned artifacts are currently unsigned and covered by SHA-256 checksums plus GitHub attestations; bundled ngrok retains upstream Authenticode verification.
- Electron fuses disable RunAsNode, `NODE_OPTIONS`, CLI inspection, and extra file-protocol privileges while requiring packaged code to load from the integrity-validated ASAR.

## Desktop lifecycle boundary

- Lifecycle state and startup settings are owned by Electron main; renderer access is constrained to the secured dashboard sender.
- `desktop-lifecycle.json` contains no approval token, ngrok credentials, workspace paths or contents, or OAuth grants.
- Installed Windows startup registration explicitly targets the packaged executable with `--background`; portable and development builds never register startup entries.
- Unclean-exit detection is diagnostic metadata only. It does not trigger destructive recovery or modify repository state.

## Remaining trust boundaries

Rel.AI MCP is a trusted local coding bridge, not a sandbox.

- Anyone who obtains the Direct `REL_AI_MCP_TOKEN` can authorize or call that Direct/local server; replace it if it leaks. Anyone who obtains a Cloud recovery code can attempt to recover that accountless principal, so store recovery material separately from routine logs/config exports and revoke unexpected devices.
- Validation commands execute code configured by the workspace. A malicious repository can cause system or data impact when tests, builds, or analyzers run. Child processes receive a minimal platform environment plus explicit configuration rather than the complete service environment.
- ChatGPT can modify any non-sensitive file inside a configured workspace through the active tools.
- Git push publishes to allowlisted remotes; review the diff before committing or pushing.

## Tool workflow

```text
inspect:  relai_snapshot -> relai_read
change:   relai_edit
validate: relai_validate action=checks
review:   relai_changes action=diff / relai_work action=status with workspace
recover:  relai_changes actions restore, reset, tidy_plan, and tidy_run
publish:  relai_publish action=commit -> relai_publish action=push
review text: relai_publish action=draft_pr
```

Keep workspace aliases pointed only at repositories you trust ChatGPT to inspect, execute, and modify.
