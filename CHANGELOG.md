# Changelog

## [0.23.0] — 2026-07-28

### Standards-compliant MCP lifecycle and recovery
- **Target MCP `2026-07-28` through the stable v2 SDK without breaking ChatGPT connection scans.** Native stdio and HTTP use `server/discover` plus per-request protocol metadata. The OAuth-protected HTTP endpoint also delegates frozen `2025-11-25` `initialize` and tool-discovery requests to the SDK's stateless compatibility path because ChatGPT still uses that lifecycle; Rel.AI keeps no legacy transport implementation, issues no `MCP-Session-Id`, and does not restore `/sse`, `/messages`, JSON-RPC batches, or tool aliases.
- **Keep transport connections separate from coding-task identity.** Every stateless request supplies its capabilities and authenticated principal; only the opaque `task_id` returned by `relai_start_task` owns logical work.
- **Detect and recover stale client state.** Rel.AI fingerprints the canonical tool manifest, serves the current list on every stateless request, invalidates stale credentials, and exposes explicit reconnect or host-action states in the dashboard.
- **Publish one 33-tool surface at tool-surface version 25.** Task-scoped schemas require a workspace-bound `task_id`, resolve the task workspace automatically, return compact repository bootstrap on task creation, and discover hierarchical `AGENTS.md` guidance.

### Task observability, privacy, and runtime integrity
- **Sanitize completion summaries before they enter task state.** One bounded sanitizer now covers credential-bearing headers, token/password assignments, cookies, secret URL fields, private-key blocks, and approval or authorization codes at completion input, tracker, activity, persistence, historical-read, dashboard, SSE, and copy/export boundaries.
- **Use one canonical task state machine.** New writes no longer emit `inactive` or `attention`; historical aliases normalize on read, terminal states share one predicate, stale updates cannot reopen terminal work, and terminal timestamps, reasons, counters, and partial progress are preserved.
- **Add explicit cooperative cancellation.** `relai_cancel_task` targets the exact task ID, is idempotent, preserves partial progress, bypasses the workspace lock, records a bounded reason, and signals supported process-backed operations without claiming every external side effect can be reversed.
- **Report real validation and diagnostics progress.** Known workflows establish a deduplicated denominator before execution, advance after every check, identify failures and timeouts, persist midpoint progress, and never present failed or cancelled work as successful 100% completion.
- **Detect repository/runtime skew.** Status, MCP discovery, dashboard data, and packaged metadata compare application, protocol, tool-surface, tool-count, schema, and manifest-hash values; incompatible schema-sensitive calls pause until the runtime is restarted or reconnected while safe control calls remain available.
- **Add production-path regression and acceptance infrastructure.** Security tests inspect raw persisted history and every dashboard projection, real Electron Chromium acceptance covers task states, keyboard reachability, 200%/400% zoom, and accessibility, and the machine-readable observability benchmark executes both backend and isolated Electron renderer workloads while failing incomplete runs.
- **Normalize historical state without destructive migration.** Existing `inactive`, `attention`, and related aliases remain readable through evidence-based mapping; sanitized canonical records are used in memory and on subsequent persistence.
- **Fail closed on native-task storage faults.** Request validation, task unavailability, record corruption, and filesystem failures now use separate typed errors; protocol responses never expose host paths, corrupt records move out of the active task directory, and pruning reports quarantined records.

### Durable local coding runtime
- **Add managed persistent processes.** ChatGPT can start, read, write to, stop, and list long-running commands through stable process IDs, cursor-based logs, process-tree termination, ownership checks, crash-safe metadata, and a dedicated dashboard Processes page.
- **Remove the proprietary deferred-operation surface.** The canonical catalog contains 33 tools; `defer`, `operationTaskId`, and the two operation polling tools are no longer public. Persistent commands use `relai_process_*`, while standards-based asynchronous interoperability is exercised through native MCP Tasks on HTTP.
- **Add managed Git worktrees.** Rel.AI creates isolated branches under its managed worktree root, registers dynamic workspace aliases, inherits workspace policy, refuses unsafe removal, and preserves branches by default.
- **Expand code intelligence and validation.** Private local hybrid semantic search, symbol/import/caller/test tracing, normalized diagnostics, signed change-aware validation plans, reverse-impact analysis, and affected-test selection are available through the public tool surface.

### Security, telemetry, and caching
- **Harden OAuth as an issuer-bound OAuth 2.1 flow.** Dynamic registrations, authorization codes, access tokens, and refresh tokens are bound to the active issuer and exact resource; redirects are exact, PKCE S256 is mandatory, scopes accumulate safely, refresh tokens rotate, reuse is rejected, public issuers require HTTPS, and approval-token replacement revokes registrations and grants. Authorization codes and bearer tokens are persisted under SHA-256 identifiers rather than plaintext map keys.
- **Add OpenTelemetry tracing with W3C propagation.** MCP requests, logical tasks, tools, workspace queues, managed processes, validation, and OAuth operations emit sampled, redacted spans without file contents, credentials, environment values, approval material, or full command lines. Active W3C trace context propagates into managed child processes.
- **Stop forwarding the service environment into repository commands.** A shared process-environment policy passes required platform variables, rejects `NODE_OPTIONS` and Electron Node mode, and requires explicit configuration for additional inherited values.
- **Add revision-aware private resource caching.** Discovery, tool, and resource responses use bounded TTLs and invalidate when configuration, workspace state, or the tool surface changes.

### Runtime and release modernization
- **Require Node.js 24 LTS and npm 11.** Root and Electron manifests declare the runtime policy, npm is pinned through `packageManager`, and CI uses immutable action commit SHAs.
- **Update and exact-pin the release-critical stack.** Electron remains at 43.2.0, electron-builder is pinned to 26.15.3, electron-updater is pinned to 6.8.9, MCP SDK packages are pinned to 2.0.0, and `globals` moves to 17.8.0.
- **Harden Electron packages before publication.** Setup and recovery pages use the restricted `relai-app://renderer` protocol; packaged binaries disable RunAsNode, `NODE_OPTIONS`, CLI inspection, and extra file-protocol privileges while requiring integrity-validated ASAR loading.
- **Make Windows releases signed and attributable.** Publication requires protected Authenticode credentials and valid signatures, generates a CycloneDX SBOM, and creates GitHub build-provenance and SBOM attestations.
- **Make generated assets and module direction enforceable.** CI regenerates and diffs color assets, browser UI source has an explicit ESM package scope, and a module-system audit prevents CommonJS growth or mixed modules before the coordinated backend and Electron hard cutover.
- **Make the native MCP Tasks interoperability canary permanently available on HTTP.** Stateless discovery advertises the Tasks extension, the canonical 33-tool catalog includes `relai_native_tasks_probe`, and HTTP recognizes task polling, update, cancellation, routing headers, and authenticated ownership.
- **Reduce the published npm package to an explicit runtime allowlist.** The package now ships only the CLI, service source, dashboard assets, examples, type boundaries, README, and license, reducing the dry-run artifact from 418 entries and about 4.09 MB to 194 entries and about 0.57 MB compressed.
- **Remove build-only SDK files from the Electron runtime.** Packaged MCP and telemetry dependencies exclude source, test, TypeScript, declaration, and source-map trees; final `resources/` size is 45.36 MiB and packaged connector acceptance verifies the reduced runtime.
- **Make dependency and package budgets release-blocking.** Production Knip models the shipped CLI, backend, dashboard, Electron main, and renderer entries; production npm audits must remain clean; the build-tool audit accepts only one expiry-bound build-only advisory graph; and package size fails above the strict 3% tolerance.
- **Publish one exact updater artifact contract.** Installer, portable, and blockmap names are version-derived and canonical; `latest.yml` must name the exact installer and match its SHA-512 bytes; `SHA256SUMS.txt` and the release asset list must cover the same basenames before publication.
- **Invalidate derived release evidence on every rebuild.** A completed Electron release promotion removes stale checksums, asset lists, SBOMs, and size reports before new evidence is generated, preventing old metadata from authenticating newly built executables.

### Color-system ESM hard cutover
- **Replace the temporary CommonJS color module with one build-time ESM manifest.** The generator imports `src/ui/colorTokens.mjs` directly; runtime CommonJS code consumes generated assets rather than an interop bridge.
- **Delete every legacy CSS alias.** Dashboard and Electron component styles now use semantic `--ui-*` properties directly, and automated checks reject the removed shorthand names.
- **Serve generated OAuth styling as a static asset.** Authorization and error pages link `/public/oauth.css`, removing duplicated inline CSS and runtime palette imports.
- **Keep release packaging lean.** The build-time manifest is not shipped as a backend resource; packaged verification requires the generated OAuth and Electron renderer styles instead.

### Verified first-run ngrok acquisition and antivirus isolation
- **Remove `ngrok.exe` from every Rel.AI application package.** The installer ships only a schema-v2 provenance manifest, reducing the package and preventing ngrok-specific signatures from being attributed to the Rel.AI installer.
- **Require explicit acquisition consent.** First-run and recovery setup identify the official ngrok component, require user approval, stream progress, and preserve that decision for verified repairs without requiring a separate installer or manual configuration.
- **Verify every byte before execution.** Rel.AI pins the immutable official archive URL, archive and executable sizes and SHA-256 values, exact version, Authenticode publisher, and certificate issuer; downloads use bounded retries and size limits, extraction rejects unexpected contents, and installation is atomic with rollback.
- **Fail closed on missing, modified, or quarantined agents.** Existing managed bytes are reused only while complete verification passes. Invalid bytes are never executed and can be reacquired through the same consented path; ngrok self-update checks and remote management remain disabled.
- **Exercise the real boundary in release automation.** Windows release validation downloads and verifies ngrok in a temporary directory, packaged verification rejects embedded copies, and the SBOM records the externally acquired component and archive provenance.
- **Document component-level antivirus triage.** Rel.AI-owned artifacts and the separately acquired ngrok executable are scanned independently; generic upstream ngrok PUA/PUP labels follow vendor submission rather than concealment, exclusions, or evasion.

### Active-controller build safety
- **Prevent development builds from deleting their own controller.** Electron records its live PID, executable, resource, application, and working-directory paths in a non-secret runtime marker; packaging and cleanup reject any target tree that contains those active files.
- **Centralize Electron packaging in a fail-closed wrapper.** `electron:build` and `electron:dist` run validation and electron-builder with `--publish never`, never execute generated installers or applications, and preserve an installed controller when it lives outside the build output.
- **Fix Windows packaging under Node 24.** The wrapper invokes pinned JavaScript CLI entrypoints through `process.execPath` instead of spawning `npm.cmd` or `npx.cmd`, avoiding the Windows `spawnSync ... EINVAL` failure without enabling a command shell.
- **Eliminate the combined-target executable rename race.** Release packaging creates `win-unpacked` once, validates it, then produces NSIS and portable artifacts sequentially with `--prepackaged`; parallel targets can no longer race to rename the same `electron.exe`.
- **Tolerate transient Windows build-directory locks.** Guarded cleanup uses bounded `fs.rmSync` retries before failing with an actionable lock diagnostic; it never kills processes or bypasses active-controller protection.
- **Stage release builds outside the VS Code workspace.** Electron Builder now works in an OS-temporary directory and atomically promotes completed artifacts into `dist`. A VS Code-held legacy `app.asar` is preserved, while the current unpacked application is published under `dist/unpacked-builds` and recorded in `dist/current-unpacked.json` instead of failing the release.
- **Make package verification follow the promoted build.** Fuse, layout, connector-acceptance, signature, and ngrok acquisition-boundary checks resolve the authoritative `current-unpacked.json` marker rather than validating a stale fixed directory.
- **Block production-identity installer lifecycle work while Rel.AI is active.** Install, update, uninstall, and replacement operations are reserved for an explicitly stopped controller or an isolated release machine.
- **Isolate development and test servers from the production connector profile.** Programmatic servers on an ephemeral port ignore saved launch state and cannot rewrite `connection.json`, preventing validation runs from repointing the active app or ChatGPT endpoint.

### Breaking upgrade behavior
- **Do not migrate old aliases, registrations, removed protocol routes, or color-token aliases.** Native clients must negotiate MCP `2026-07-28` and send current metadata on every stateless request. ChatGPT may negotiate the SDK-managed frozen `2025-11-25` HTTP lifecycle for connection and tool discovery; this exception does not restore any removed Rel.AI compatibility code or routes.

### Validation
- Workstream-specific release, dashboard, audit, updater, dependency, and benchmark tests passed; aggregate `npm run test:all` remains the final concurrent-workstream reconciliation gate
- `npm run audit:production` - zero production advisories
- `npm run audit:packaging` - only the expiry-bound reviewed build-only advisory graph accepted
- `npm run knip:production` - shipped runtime dependency model passed
- `npm run benchmark:observability` - 18/18 mandatory backend and renderer metrics passed
- `npm run release:check`
- `npm run electron:build`
- `npm run electron:dist` - canonical NSIS installer, portable executable, blockmap, update metadata, and promoted unpacked directory generated
- `npm run verify:packaged -- --dir <current-unpacked>` - packaged TypeScript/source exclusions verified
- Electron fuse verification passed against the packaged executable
- Packaged OAuth/MCP connector acceptance passed
- Strict 0.23.0 package-size baseline passed: 106.26 MiB installer, 95.39 MiB portable, 346.61 MiB unpacked, 45.36 MiB `resources/`
- CycloneDX SBOM generation passed
- `npm pack --dry-run` - 194 entries, 567,887 bytes compressed, 1,712,287 bytes unpacked

Bump root/electron/status UI/lockfiles to 0.23.0.

## [0.22.1] — 2026-07-28

### Static analysis and dependency integrity
- **Add repository-aware Knip analysis.** The configuration covers the Node.js service, dashboard module aliases, Tailwind source, Electron preload scripts, and renderer entry points without masking unresolved imports or unused files.
- **Gate dependency integrity in the standard test workflow.** Full, production-only, and dependency-only commands are available, while `npm run test:all` now rejects dependency drift and invalid Knip configuration.
- **Declare direct tooling dependencies explicitly.** `@electron/asar` is now a root development dependency instead of being resolved through Electron's transitive dependency tree.
- **Keep dead-code removal reviewable.** Existing unused-export and exported-type findings remain visible for a separate source-verified cleanup pass rather than being suppressed or automatically deleted.

### Dashboard activity layout
- **Use the full available Activity tab height for event log entries.** The route, event card, body, and table wrapper now expand through unused desktop viewport space while retaining page-level vertical scrolling, horizontal table overflow, and responsive behavior.
- **Add regression coverage for the full-height event log layout.** Activity scrolling, accessibility, responsive behavior, and the dashboard UI smoke suite verify the updated screen utilization.

### Accessible color-system consolidation
- **Centralize dashboard, Electron, OAuth, and startup-window colors in one canonical manifest.** Generated light and dark CSS now expose equivalent semantic roles for surfaces, text, borders, actions, focus, selection, statuses, disabled controls, overlays, scrollbars, and elevation.
- **Fix measured WCAG contrast failures without replacing the established Rel.AI identity.** Primary actions use theme-specific foregrounds, tertiary text is readable on primary and secondary surfaces, light warnings use an explicit accessible pair, and disabled controls no longer lose legibility through whole-control opacity.
- **Standardize operational meaning across every renderer.** Running and active states use information blue, approval and degraded states use warning amber, positive terminal states use success green, failures use danger red, and neutral terminal states remain non-alarming.
- **Remove color-only notification cues.** Toasts include a visible symbol and announced severity, while status pills retain readable labels and accessible tone descriptions.
- **Enforce the architecture automatically.** The new color test calculates representative contrast, checks theme parity and token aliases, rejects raw component colors, verifies Electron and OAuth integration, and validates deterministic dashboard, Electron, and SVG reference artifacts.

### Validation
- `npm run test:colors`
- `npm run knip:dependencies`
- `npm run test:all` — 120/120 test files passed

Bump root/electron/status UI/lockfiles to 0.22.1.

## [0.22.0] — 2026-07-27

### MCP SDK v2 hard cutover
- **Replace the custom JSON-RPC and transport implementation with MCP SDK v2.** Stdio framing, initialization, capability negotiation, tool and resource registration, schema validation, protocol errors, and Streamable HTTP now use `@modelcontextprotocol/server` and `@modelcontextprotocol/node`.
- **Remove the legacy MCP SSE transport.** `GET /sse`, `POST /messages`, custom session IDs, conversation-header hashing, and transport-derived task scopes are deleted; HTTP clients use the OAuth-protected `POST /mcp` endpoint.
- **Require exact logical task identity.** Each independent objective calls `relai_start_task` once and every later task-scoped call supplies the returned `task_id`. Rel.AI no longer selects or merges tasks by transport, ChatGPT conversation metadata, workspace, process, timestamp, or validation aliases.
- **Make task history current-version-only.** The first 0.22.0 history access deletes the previous sessions directory, writes `.task-history-v2`, and stores only explicit identity-v2 events. Existing audit logs remain activity records but are not reconstructed into task history.
- **Remove configuration compatibility.** Legacy `workflow`, `flow`, `cautionZone`, top-level `maxIndexFiles`, workspace `fastTask`, context `includePaths`, and patch `maxPatchBytes` values are ignored instead of migrated or written back.
- **Keep OAuth and managed ngrok as active product features.** OAuth discovery, dynamic client registration, authorization code plus PKCE, access/refresh tokens, revocation, connector recovery, static-domain delivery, and bundled ngrok remain supported.

### Release and packaging changes
- **Package the MCP SDK runtime explicitly in the Electron application.** The package allowlists the SDK, Hono adapter, Hono, and Zod dependencies, excludes source maps and the source Tailwind stylesheet, and verifies the packaged backend can initialize MCP from `resources/`.
- **Patch the SDK's Node adapter dependency.** `@hono/node-server` is overridden to 2.0.12, leaving the production dependency audit at zero known vulnerabilities.
- **Add packaged connector acceptance.** CI and release workflows launch the isolated packaged Node backend and verify OAuth/PKCE, tools and resources, explicit task calls, completion, reconnect rejection, and removal of the old MCP routes without installing or launching Electron.
- **Document the incompatible upgrade explicitly.** Release notes and architecture documentation identify discarded history, ignored configuration, removed routes, standard initialization requirements, exact task IDs, and new runtime dependencies.

### Codebase reduction
- **Bind tool definitions directly to executable handlers and delete the dispatch lookup module.** Registry annotations, behavior, dashboard metadata, and empty arrays now use centralized defaults.
- **Consolidate repeated UI behavior.** HTML escaping, duration formatting, hidden settings save rows, workspace alias/path handling, task-history event utilities, and ngrok authtoken validation each have one implementation.
- **Remove public legacy workspace helper exports while preserving MCP resource behavior through the internal status module.**

### Breaking upgrade behavior
- Back up any removed configuration values or old session-history files before upgrading if they are still needed.
- Clients must use stdio or `POST /mcp`, send standards-compliant initialization fields, call `relai_start_task`, and preserve the returned `task_id`.
- Old task-history sessions are intentionally discarded and are not converted.

- **Synchronize every release surface at 0.22.0.** Root and Electron manifests, both lockfiles, the desktop status badge, changelog, and release metadata now agree.

Bump all release surfaces to 0.22.0.

## [0.21.9] — 2026-07-26

### Tool-call latency overhaul
- **Read-only tools now share a per-workspace reader/writer lock instead of serializing behind the mutation queue, so a batch of relai_read, relai_search, relai_status, or relai_diff calls dispatched together runs concurrently while edits stay exclusive.**
- **Session-history writes use a prune fast-path and parsed-session cache, while history listings revalidate high-resolution file metadata so updates from the desktop app, connector server, or another process cannot remain stale.**
- **The workspace tree walk dropped one realpath syscall per file, taking relai_repo_snapshot and relai_code_inspect collection from ~70-94 ms to ~7 ms on a 350-file repository.**
- **relai_code_inspect gained per-file identifier and token sets so symbol, references, and related queries skip files that cannot match: warm queries went from ~102-124 ms to ~13-19 ms.**
- **config.json is parsed once per change instead of once per tool call, workspace root realpaths are memoized, and command discovery plus validation-check detection now share a manifest-signature cache.**
- **relai_repo_snapshot overlaps its git summary with the tree walk, and relai_git_commit overlaps its work-tree probe with the status read. relai_diff deliberately waits for canonical status classification before reading any diff so sensitive paths are never loaded speculatively.**
- **relai_read accepts ranges:[{path,startLine,endLine}] so several files with different line windows resolve in one call instead of one call per file (tool surface version 12).**
- **relai_status skips the package.json read and .github/workflows CI scan for connector calls, which strip both from the result anyway.**
- **Git status consumers now share NUL-delimited porcelain parsing, preserving filenames with spaces and non-ASCII characters across review, status, baseline ownership, tidy, and command mutation tracking. Unified-diff authorization now uses Git's own apply inspection rather than scraping `+++ b/` headers.**
- **The Sessions tab now uses blue for open logical tasks, amber for incomplete sessions where completion was not reported, green for completed sessions, and red only for actual errors.**

Bump root/electron/status UI/lockfiles to 0.21.9.

## [0.21.8] — 2026-07-26

### Security fixes and validation performance
- **Security: reject OAuth store lookups that resolve through Object.prototype. A bearer token of `constructor`, `__proto__`, `toString` or any other inherited key authenticated as a valid access token and returned the full tool surface, including `relai_exec`. The refresh grant could also mint real tokens from such a key, and an inherited `client_id` returned an unauthenticated 500 instead of `invalid_client`.**
- **Security: reject repository paths containing a drive or NTFS stream separator. `.env::$DATA` classified as an ordinary file and disclosed `.env` verbatim through `relai_read`; the same bypass applied to `id_rsa`, `*.pem` and `.npmrc`.**
- **Security: `relai_restore_paths` now rejects git pathspec patterns and passes `:(literal)` paths. `paths: ["*"]` previously discarded every uncommitted change without the RESET confirmation that `relai_reset_workspace` requires.**
- **Security: `relai_git_push` now requires a plain branch name. A refspec such as `:main` (delete remote branch) or `+HEAD:main` (force push) was passed straight to git.**
- **Performance: `npm run check` parses all 278 JavaScript files in one process instead of spawning `node --check` per file. Measured 11,983ms to 215ms on Windows, with identical pass/fail verdicts.**
- **Performance: `relai_code_inspect` no longer re-validates each indexed file through `resolveSafePath` on the cache-hit path, which `collectTextFiles` had already validated. Warm call measured 330ms to 138ms.**
- **Performance: `getVersion()` caches the CHANGELOG parse behind an mtime and size check instead of re-reading 112 KB on every call.**
- **Fix: the HTTP server no longer silently repoints the saved connector profile. It warns when the port changes and accepts `--no-profile-write` so tests and secondary instances leave `connection.json` alone.**

Bump root/electron/status UI/lockfiles to 0.21.8.

## [0.21.7] — 2026-07-26

### Tailwind editor diagnostics
- **Suppress VS Code's propertyIgnoredDueToDisplay false positive for Tailwind's intentional generated preflight rule.**
- **Apply the Tailwind language association to the source stylesheet across workspace paths while leaving runtime CSS unchanged.**

Bump root/electron/status UI/lockfiles to 0.21.7.

## [0.21.6] — 2026-07-26

### Windows test cleanup resilience
- **Retry and tolerate transient Windows EBUSY, ENOTEMPTY, and EPERM errors when removing temporary Git test repositories.**
- **Keep sensitive-file authorization and redacted-review coverage deterministic without weakening production cleanup behavior.**

Bump root/electron/status UI/lockfiles to 0.21.6.

## [0.21.5] — 2026-07-26

### Developer attribution and About page
- **Add a discoverable Settings About page with product version, developer, repository, and license details.**
- **Centralize application metadata so the dashboard, package manifests, and tests share one canonical attribution source.**
- **Open validated GitHub links in the system browser with native keyboard and focus behavior.**
- **Document Kyne as the developer without exposing a legal name.**

Bump root/electron/status UI/lockfiles to 0.21.5.

## [0.21.4] — 2026-07-26

### Native desktop window chrome
- **Use a platform-aware frameless Windows dashboard with accessible minimize, maximize, restore, and close controls.**
- **Synchronize native window state through a constrained Electron IPC bridge while preserving tray-close behavior and security boundaries.**
- **Give the custom desktop shell a single scroll owner with preserved route position.**
- **Standardize theme-aware, compact, and forced-colors-safe scrollbars across dashboard and Electron surfaces.**

Bump root/electron/status UI/lockfiles to 0.21.4.

## [0.21.3] — 2026-07-26

### Reliable live dashboard updates
- **Send an immediate dashboard snapshot whenever a live event stream connects.**
- **Keep live updates active in background windows and force a catch-up refresh when the dashboard becomes visible.**
- **Defer rerenders while selects, dropdowns, overlays, or unsaved settings are active, then flush the latest state safely.**
- **Fix General settings panel mounting and improve narrow settings and activity layouts.**

Bump root/electron/status UI/lockfiles to 0.21.3.

## [0.21.2] — 2026-07-26

### Scalable structured edits
- **Raise structured batch editing to 100 files with explicit payload, replacement, rollback, and aggregate byte limits.**
- **Compact large successful batch results while preserving actionable per-file failures and rollback diagnostics.**
- **Advertise tool surface version 11 with the expanded edit schema and limits.**

Bump root/electron/status UI/lockfiles to 0.21.2.

## [0.21.1] — 2026-07-26

### Workspace and task identity
- **Accept configured workspace aliases or exact configured absolute paths while rejecting ambiguous relative paths with structured diagnostics.**
- **Track only explicit logical tasks so rejected and taskless calls no longer create misleading sessions.**
- **Allow read-only tasks to complete without validation while retaining mandatory final validation after mutations.**
- **Clarify running and open task states throughout the dashboard.**

Bump root/electron/status UI/lockfiles to 0.21.1.

## [0.21.0] - 2026-07-25

### Logical task isolation and completion
- **Introduce explicit logical task identity for MCP clients.** `relai_start_task` creates an independent opaque `task_id`; clients must retain it and pass it to later task-scoped calls, and `relai_complete_task` now requires it. Calls without an ID are accepted only when one task can be resolved unambiguously.
- **Isolate concurrent ChatGPT work on shared connections and repositories.** Each logical task keeps separate activity, workspace-policy baselines, validation ownership, and completion state, so one conversation cannot overwrite or close another conversation's task.
- **Make validation and completion exact, atomic, and retry-safe.** Final `relai_run_checks` calls can use `complete:true` with a non-empty `summary`; standalone completion remains available after read-only review, rejects post-validation changes, and returns the original result for duplicate retries.
- **Detect shared-worktree interference before completion.** A task must revalidate when another logical task changes the same repository after its last passing validation, while unrelated tasks can continue or complete independently.
- **Persist auditable task identity.** Activity and history records retain request, client, server-instance, transport, and task-identity metadata without stitching explicit tasks together after reconnects or process restarts.

### MCP tool-surface consolidation
- **Publish tool-surface version 10 with 20 active tools and no compatibility aliases.** The machine-readable manifest, HTTP transport, OAuth transport, and dashboard catalog now expose the same callable surface.
- **Remove six deprecated compatibility tools.** Clients must migrate `relai_write` and `relai_replace` to `relai_edit`, `relai_browser` to `relai_http_probe` or `relai_ui_check`, `relai_restore_changes` to `relai_restore_paths` or `relai_reset_workspace`, `relai_git_status` to `relai_status`, and `relai_git_create_pr` to `relai_git_draft_pr`.
- **Use `relai_edit` as the single file-change contract.** It supports exact and occurrence-targeted replacements, multi-replacement edits, complete or staged file content, unified patches, atomic multi-file batches, and SHA-256 stale-write protection across direct and staged workflows.
- **Add live repository code inspection.** `relai_code_inspect` provides bounded lexical symbol definitions, references, call classification, related-file ranking, reverse-import impact, affected-test discovery, and diagnostic-command readiness from a fingerprint-invalidated on-demand index.
- **Return structured tool failures.** Policy and task errors now include stable codes, operation context, retryability, confirmation requirements, and allowed alternatives, while validation retains bounded failure tails instead of losing the most useful diagnostics to output limits.

### Sensitive repository operations
- **Apply operation-aware and content-aware sensitive-path policy.** Runtime environment files, credentials, and private keys remain blocked from raw access, while public environment templates, `known_hosts`, public certificates, and non-credential configuration are allowed when their contents are safe.
- **Prevent writes through outward symlink parents.** Safe-path resolution now evaluates the nearest existing real ancestor, blocking creation below links that escape the workspace while preserving links that remain inside it.
- **Add secret-safe environment management and review.** `relai_edit` can list, set, remove, and compare environment keys without returning values, and `relai_diff` can report metadata-only sensitive changes such as added, removed, or changed keys and malformed line numbers.
- **Require scoped authorization for sensitive commits.** `relai_git_commit` accepts an operation-specific `sensitiveAuthorization` object naming every approved path and reason; the legacy `allowSecretPaths` flag is limited to explicitly listed paths instead of authorizing an unrestricted add-all commit.

### Feature-first dashboard and Tailwind migration
- **Reorganize the dashboard around product features.** Overview, Sessions, Workspaces, Activity, Tools, onboarding, and Settings now own their UI modules under `src/ui/features`, while routing, API access, shared state, interaction safety, and reusable components remain centralized.
- **Replace the legacy dashboard stylesheet tree with one Tailwind CSS v4 source.** The build now compiles `src/ui/styles/app.css` into `public/dashboard.css`, and fourteen obsolete dashboard CSS files were removed instead of remaining as competing override layers.
- **Make Tailwind part of every supported workflow.** CSS compilation runs before HTTP startup, Electron development, Windows packaging, distribution builds, and the complete test suite.
- **Keep Tailwind CSS editor diagnostics accurate.** The repository now recommends the official Tailwind CSS IntelliSense extension, opens the dashboard stylesheet in Tailwind language mode, and suppresses the built-in CSS validator's false-positive unknown-at-rule warnings for directives such as `@apply`.
- **Document and enforce feature ownership.** A feature-structure guide and regression checks prevent the removed generic `sections` hierarchy and legacy stylesheet imports from returning.

### Desktop dashboard redesign and layout repair
- **Use the full Electron window instead of a narrow centered web-page column.** The application shell, typography, controls, cards, Settings rail, Activity table, Sessions list, Workspaces page, Connection path, and Overview hierarchy were resized for a desktop application surface.
- **Remove duplicated page headings and excessive nested decoration.** The top bar is the single page identity, routine cards remain flat, and feature pages use clearer status, supporting-fact, and action groupings.
- **Replace checklist-style readiness UI.** Workspace cards show one primary ChatGPT-access state with repository and validation facts, while Electron setup uses numbered principle cards instead of decorative checkmark rows.
- **Keep controls visibly interactive.** Add workspace, Quick navigation, page-owned workspace filters, search, selects, inputs, and secondary buttons retain explicit borders and stable dimensions across loading and responsive states.
- **Remove the redundant workspace jumper.** The top-bar Jump to workspace selector is gone; workspace management remains available through Workspaces and searchable Quick navigation.
- **Fix the full-width shell regression.** The fixed sidebar now follows the shared sidebar-width variable, while the main dashboard is explicitly placed in the second grid column and stretches across all remaining space without duplicate margin offsets at any breakpoint.
- **Open the desktop dashboard at an unmistakably windowed size.** First launch is centered at 80% of the active display work area and capped at 1180 by 760 pixels instead of using a fixed 1240 by 820 rectangle that nearly filled common laptop screens.
- **Persist restore geometry instead of maximized geometry.** Maximizing Rel.AI no longer saves a screen-sized rectangle that reopens as a nearly-fullscreen normal window; existing unversioned bounds migrate once to the smaller default, while closing still hides the dashboard to the tray.

### Durable sessions and smoother live updates
- **Persist session history independently from the bounded Activity tail.** Session summaries are stored separately, survive beyond the latest 200 audit events, retain up to 500 sessions, and merge validation and completion fragments into the same recorded session.
- **Make live connection state accurate.** The dashboard treats the server readiness event as a live connection, reports temporary transport failures as reconnecting instead of Offline, pauses connection work while hidden, and uses bounded exponential retry delays.
- **Replace dashboard polling with tool-activity updates.** Tool-call start, progress, and completion events schedule coalesced dashboard snapshots; unchanged route data is fingerprinted and skipped, and changed views keep their existing DOM visible until the lazy feature mount is ready instead of flashing an empty route container.
- **Use the Activity workspace effectively.** The event table now spans the available content width with explicit proportional columns instead of leaving the log compressed against the left edge.
- **Fix vertical scrolling on Activity.** The table continues to contain horizontal overscroll, while wheel and touch scrolling now pass vertically to the page instead of being trapped inside the table wrapper.
- **Make Diagnostics filters respond to their actual panel width.** Search, severity, source, live-tail, summary, and diagnostic header actions now use container-based breakpoints, preventing the search field from collapsing inside the nested Settings layout.
- **Keep dashboard connectivity truthful during stream recovery.** Electron EventSource requests include the dashboard session cookie explicitly, reconnects remain distinct from Offline, and the removed refresh interval settings can no longer imply that timer polling is the normal update path.
- **Repair the Sessions inspector.** Session history renders in bounded 50-row batches, the detail drawer keeps its header visible, removes the full-window blur, and presents changed files and tool events in structured, collapsible groups instead of an unformatted narrow column.
- **Make list ordering intentional and deterministic.** Sessions keep all ongoing work at the top and sort both the ongoing group and finished history by timestamp, newest first; completed, attention, and inactive sessions are not separated into artificial status groups. Activity remains newest-first, the Sessions drawer shows the latest tool events before an older-events disclosure, diagnostic logs remain chronological with the latest entry visible, findings prioritize severity, workspace selectors are alphabetical, changed files are deduplicated and sorted, and the Tools catalog groups capabilities before alphabetizing titles.
- **Expand regression coverage.** Persistent session storage, Tailwind-only styling, responsive shell placement, live-event recovery, activity-table width, visual hierarchy, and Electron behavior are covered by the complete validation suite.

### Usability validation and delivery hardening
- **Replace one-click installation with an explicit setup wizard.** The Windows installer now presents destination-folder selection and a deliberate Install step and creates Start menu and desktop shortcuts.
- **Offer current-user and all-users installation correctly.** Current-user installation remains the default without elevation; selecting all users requests Windows administrator approval when the installer is not already elevated.
- **Restore the optional post-install launch choice.** The Finish page includes a checked **Run Rel.AI MCP** option that users may clear before closing setup.
- **Remove the host-destructive installed-app harness.** Ordinary scripts, CI, and release automation no longer install, launch, repair, upgrade, or uninstall Rel.AI MCP; hidden packaged smoke flags and their IPC bypass were removed from production Electron code.
- **Verify packages without executing them.** Windows automation builds the unpacked application and checks the executable, ASAR, server, tool registry, configuration, CLI, dashboard, metadata, changelog, and bundled ngrok files through the read-only `verify:packaged` command.
- **Keep installer lifecycle checks isolated.** Installation, uninstall, first-run rendering, real ngrok, ChatGPT OAuth, token rotation, and previous-release updating are manual release checks on a disposable Windows VM or dedicated machine that is not hosting active Rel.AI work.
- **Prevent validation builds from entering electron-builder publish mode.** Unpacked builds and distribution builds pass `--publish never`, preventing GitHub Actions from requesting `GH_TOKEN` or uploading artifacts merely because `CI=true`; the explicit GitHub Release step remains the only publisher.

### Electron runtime, dependency, and package maintenance
- **Upgrade the supported desktop and build toolchain.** Electron moves from 31 to 43.2.0, electron-builder moves from 24.13.3 to an exact 26.15.3 pin, ESLint moves to 10.8.0, and both lockfiles are regenerated through the normal package-manager workflow.
- **Reduce avoidable Windows distribution payload.** The package now ships only the supported `en-US` Chromium locale, excludes production source maps, and minifies the generated dashboard CSS; against a same-source unoptimized control, the installer is 8.16% smaller and the unpacked application is 13.09% smaller.
- **Add package-size regression reporting.** `npm run electron:size` inventories final artifacts against a recorded Windows baseline, and the release workflow uploads a warning-only JSON report before the size budget is promoted to a blocking gate.
- **Audit dependency reachability explicitly.** The root and shipped Electron production dependency graphs report no npm audit findings; sixteen high-severity findings remain in transitive electron-builder development tooling and are documented as build-host and release-pipeline risk rather than installed runtime exposure.
- **Make linting part of the complete validation gate.** `npm run test:all` now runs ESLint with zero warnings allowed in addition to syntax checks, TypeScript boundary checks, release consistency, and the repository test suite.

### Security and updater completion
- **Isolate local Electron renderers.** Setup and failure-recovery windows now run sandboxed with strict content security policies, denied permissions and downloads, blocked webviews and popups, and navigation locked to their configured local files.
- **Bind every desktop IPC action to its owning window.** Setup, recovery, dashboard, clipboard, notification, service, and external-link channels reject unexpected renderers; clipboard payloads are bounded and setup links allow only the exact HTTPS ngrok dashboard host.
- **Keep the ngrok account key write-only.** Connection settings report only whether a key exists. Leaving the replacement field blank preserves the stored key, and the renderer never receives the saved value after setup.
- **Make approval-token rotation recoverable.** OAuth-revocation failures restore the original token when possible, while restart-only failures still return the newly persisted token and explicit restart guidance.
- **Fail closed on update metadata.** The updater accepts only a newer stable version, requires the downloaded version to match the advertised version exactly, and enables installation only after electron-updater reports verified SHA-512 release metadata.
- **Publish independent checksums without overstating trust.** Releases now include `SHA256SUMS.txt` and require SHA-512 updater metadata. Windows artifacts are currently unsigned, so checksums detect byte changes but do not establish publisher identity.

### Navigation and interaction safety
- **Canonicalize dashboard navigation.** One route policy now normalizes current and legacy paths, sends unknown routes to a clean Overview state, validates page-specific filter parameters, and stores only canonical destinations.
- **Keep credentials out of route state.** Credential-like query keys are stripped before hashes reach the address bar or local storage, while workspace aliases, filter enums, duplicate keys, and transient focus markers are bounded and validated.
- **Protect unsaved edits.** Advanced and Tools & validation settings plus workspace add, edit, and path-repair dialogs now mark dirty state; route changes, reloads, Escape, backdrop clicks, and Cancel warn before discarding user input.
- **Respect overlay ownership.** Quick navigation no longer replaces an active modal or drawer, and accepted route changes close stale detail drawers before the new page becomes interactive.
- **Use accessible application confirmations.** Workspace removal and partial diagnostic clearing now use the shared focus-trapped confirmation dialog, while successful saves clear dirty state before programmatic close and full diagnostic reset keeps typed `RESET` protection.

### Diagnostics and recovery completion
- **Filter one diagnostic view.** Search and severity filters cover structured findings and logs, while source filtering narrows service and failed-activity streams; filtered totals update in place.
- **Follow service events intentionally.** An opt-in live tail refreshes the sanitized aggregate report every two seconds and stops automatically after navigation or refresh failure.
- **Persist sanitized service logs.** The installed app keeps a bounded JSON-lines log in its private diagnostics directory, hydrates it after restart, and truncates the same file when logs are cleared.
- **Export and inspect local state.** Desktop users can export a secondarily sanitized JSON diagnostic snapshot and open the constrained diagnostics folder; browser users receive an equivalent JSON download without filesystem access.
- **Guard destructive maintenance.** Partial history and log clears remain available, while clearing all diagnostic data requires typing `RESET` and is blocked during active Rel.AI tool calls. Workspace and connection configuration remain untouched.

### Workspace management completion
- **Rename safely from Workspace settings.** Workspace name and project-folder changes are persisted in one atomic update while existing validation, context, and Git safeguards remain intact.
- **Reject duplicate configuration.** The form reports conflicting names and folders immediately, and the configuration layer enforces the same normalized-path rules before writing.
- **Use a dedicated path-repair flow.** Unavailable repositories open a focused repair dialog that changes only the folder and preserves workspace identity.
- **Surface recent workspaces.** The dashboard keeps a bounded local list of five recent workspaces, updates it after rename or removal, and presents it on the Workspaces page.
- **Keep workspace filtering where it is used.** Sessions and Workspaces own accessible Tailwind listbox menus, while Activity retains its page-specific filter controls; the top bar no longer carries a global native selector.

### Settings information architecture remediation
- **Use five task-based Settings categories.** General, Connection, Tools & validation, Diagnostics, and Advanced replace the competing Dashboard and Desktop app categories.
- **Keep related controls together.** General owns appearance, notifications, startup, and updates; Connection owns status, endpoint credentials, and approval-token security; Advanced owns patch safeguards and resource limits.
- **Preserve saved links.** Legacy `#settings/desktop` and `#settings/dashboard` routes normalize to Connection and Advanced without restoring duplicate settings surfaces.
- **Constrain desktop settings IPC.** Credential reads, saves, approval-token replacement, notifications, lifecycle, and updater actions are accepted only from the secured dashboard window.
- **Expose validation ownership explicitly.** Tools & validation summarizes the tool surface, workspace validation readiness, and the existing Workspaces and Tools destinations.

### Installed-app lifecycle hardening
- **Add launch at sign-in for the installed Windows app.** Desktop app settings control a native Windows login item; portable and development builds remain explicitly unsupported.
- **Keep sign-in startup unobtrusive.** Windows starts the packaged executable with `--background`, bringing up the tray, local service, public endpoint, and updater without opening the dashboard.
- **Record version transitions and clean exits.** A bounded non-secret lifecycle file tracks the current and previous version, launch count, timestamps, running marker, and last clean shutdown.
- **Report post-update success and interrupted exits.** Desktop app settings distinguish a successful first launch after an update from recovery after the previous process ended without a clean marker.
- **Constrain lifecycle authority.** Startup changes and lifecycle reads are accepted only from the secured dashboard preload; failures use stable codes and never alter Connection health.
- **Preserve honest UI state.** The launch-at-sign-in switch re-syncs to the main-process result and rolls back visually when Windows rejects the change.
- **Bound the implementation.** Lifecycle ownership lives in a dedicated Electron module with explicit source budgets, unit coverage, packaging assertions, and baseline version 14.

### Installed application updates
- **Add an explicit installed-app updater.** Packaged Windows installer builds check GitHub Releases at most once per day through `electron-updater`; development and portable builds show a manual-update path instead of pretending self-update support exists.
- **Require user consent for disruptive steps.** Automatic checks do not download files, and downloaded updates do not install on an unrelated application exit. The user explicitly starts the download and explicitly chooses restart-to-install.
- **Protect active repository work.** Restart-to-install is refused while any Rel.AI tool call is active, leaving the downloaded update ready until the user retries.
- **Expose one normalized update state.** Desktop app settings and the tray share unsupported, idle, checking, up-to-date, available, downloading, downloaded, installing, and error states without contaminating Connection health.
- **Show useful progress and recovery.** The Desktop app page displays the installed version, download percentage and byte progress, stable update error codes, Diagnostics recovery, and a GitHub Releases fallback.
- **Constrain update authority.** Update actions are handled in Electron main and accepted only from the secured dashboard window through the sandboxed preload bridge.
- **Publish real updater metadata.** Electron packaging declares the GitHub provider, bundles the updater runtime, and the release workflow now requires both Windows executables, `latest.yml`, and an installer blockmap before creating a release.
- **Keep the architecture bounded.** Desktop settings ownership is extracted from `electron/main.js`, updater persistence and state normalization live in dedicated modules, and source budgets plus unit and smoke coverage lock the boundaries.

### Visual hierarchy and interface-density refinement
- **Reserve elevation for meaningful focus.** Sidebar, Topbar, dialogs, Electron setup, and the recovery hero retain depth; routine cards, tools, metrics, workspace panels, and secondary recovery cards are flat.
- **Group summary information.** Workspace, Sessions, Diagnostics, recovery health, readiness, operational, and policy facts now share bordered containers with separators instead of rendering as card grids inside cards.
- **Clarify primary actions.** Add workspace is explicitly primary, while secondary actions and advanced repository controls remain quieter.
- **Reduce redundant status decoration.** Routine state dots no longer glow or pulse, Connection layers use one compact textual state instead of another pill, and diagnostics use slim severity rails rather than full colored borders.
- **Hide completed setup instructions.** Once ChatGPT readiness is ready, the three-step connection guide collapses under a disclosure and remains available for reconnection.
- **Remove meaningless metadata.** Sessions no longer display Not published when no commit, push, or draft pull request exists.
- **Tighten Settings and Tools.** Settings introductions use restrained accent rules, active navigation uses a low-emphasis tint, and tool cards reduce padding, shadows, and chip decoration.
- **Preserve responsive grouping.** Shared metric and health panels switch to row separators when stacked, retaining the Phase 10 touch, focus, safe-area, and high-contrast behavior.
- **Add dedicated regression coverage.** Visual elevation, grouped facts, status restraint, connection disclosure, session metadata, and Electron hierarchy are locked by an automated smoke test.

### Accessibility and responsive hardening
- **Contain overlay interaction correctly.** Modals and drawers now share one focus trap, make background content inert, lock page scrolling, close with Escape where allowed, and restore focus to the initiating control.
- **Announce state without noise.** Dashboard routes, loading failures, and meaningful recovery-window status changes use live regions, while clock-only updates no longer repeat announcements.
- **Use correct control semantics.** Quick navigation follows combobox/listbox behavior, Activity filters expose pressed state and result counts, and each Activity row has one explicit keyboard target instead of duplicated focus stops.
- **Make compact layouts operational.** Mobile navigation and Electron windows respect safe-area insets, common controls expand to 44-pixel targets, forms and actions stack, overlays use dynamic viewport height, and long values wrap rather than clip.
- **Keep Settings readable.** The five-page Settings rail scrolls horizontally at narrow widths instead of compressing every label into an unusable column.
- **Respect system accessibility modes.** Reduced-motion behavior remains intact, and forced-colors mode adds explicit active-state outlines.
- **Expose only the active setup step.** Electron onboarding hides inactive steps from both layout and assistive technology, and recovery notifications announce meaningful state changes once.
- **Add dedicated regression coverage.** Accessibility, focus containment, semantics, safe areas, touch sizing, high contrast, reduced motion, and Electron step visibility are now locked by an automated smoke test.

### Faster navigation and dashboard quality of life
- **Add searchable quick navigation.** The top bar and `Ctrl+K` / `Cmd+K` open one keyboard-friendly launcher for pages, Settings sections, common actions, and configured workspaces.
- **Jump directly to workspace cards.** Quick navigation opens the scoped Workspaces route, focuses the requested card after rendering, and removes the temporary focus marker from the saved route.
- **Make status actionable.** The top connection status now links directly to the canonical Connection page instead of acting as a dead indicator.
- **Preserve Activity filters in the URL.** Search, time range, tool, status, task, and workspace scope survive refreshes and can be bookmarked or shared without remounting the page on every keystroke.
- **Route history controls correctly.** Sessions now opens Diagnostics for history management, matching the ownership established by the diagnostics redesign.
- **Keep compact layouts usable.** The command launcher becomes icon-only on narrow displays, and page-owned workspace menus expand to the available width.

### Structured diagnostics and recovery
- **Return actionable errors.** HTTP and desktop failures now use stable error codes with a title, recovery guidance, direct action, and retryability state.
- **Consolidate Diagnostics.** One authenticated endpoint aggregates health, connection state, stale validation, protected configuration activity, failed tool activity, and desktop runtime logs.
- **Sanitize before display or copy.** Diagnostic objects, service logs, failed activity, and copied reports redact bearer credentials, approval tokens, OAuth values, passwords, API keys, ngrok account keys, and similar secret fields.
- **Expose bounded service logs.** The Electron main process keeps a small in-memory log buffer shared by dashboard Diagnostics and the failure-only recovery fallback.
- **Move reset ownership to Diagnostics.** Session/activity history and service-log clearing live on one page, with active tool calls protected and desktop-only controls disabled in browser mode.
- **Handle malformed requests correctly.** Invalid JSON and oversized request bodies return structured client errors instead of generic HTTP 500 responses.
- **Preserve the single-window policy.** Routine troubleshooting remains in the dashboard; the recovery renderer only exposes logs when the dashboard itself cannot load.

### Simplified workspace management
- **Focus cards on readiness.** Each workspace now exposes ChatGPT access, repository state, and validation readiness without front-loading every Git field.
- **Reduce routine actions.** Workspace settings, Run validation, and Open folder remain visible; Sessions, Activity, policy data, and removal move under Repository and safety details.
- **Add a useful empty state.** The page explains the minimum workspace setup and provides a direct Add workspace action.
- **Simplify the add flow.** Users choose the project folder first, and Rel.AI suggests a workspace name from the folder while checking Git and validation availability.
- **Use progressive disclosure for safeguards.** Protected branches, default base branch, and allowed remotes retain safe defaults under Git and safety settings.
- **Preserve backend policy.** Existing configuration normalization and safety enforcement remain unchanged.

### Single first-run onboarding
- **Remove the duplicated dashboard wizard on desktop.** Completing the Electron setup no longer triggers the generic five-step browser onboarding modal.
- **Hand off directly to Connection.** First launch opens `#settings/connection` with a compact guide for the two remaining application tasks: connect ChatGPT and add a workspace.
- **Persist the handoff explicitly.** Onboarding state records the desktop setup source and remains visible until dismissed; later restarts do not reopen a modal.
- **Preserve browser onboarding.** Browser-hosted dashboards still receive the full onboarding sequence when no prior onboarding state exists.
- **Keep recovery separate from first run.** Editing a failed connection through the recovery wizard does not reset or recreate onboarding.

### Single-window desktop operation
- **Make the secured dashboard the only routine configured-desktop window.** Settings, Connection, Diagnostics, and service actions stay in one application surface after first-run setup.
- **Remove the compatibility settings renderer.** `electron/renderer/settings.html`, its script, obsolete CSS, launcher edit branches, and packaged renderer smoke path are gone.
- **Limit the status renderer to genuine fallback use.** It opens only when the local service or dashboard cannot start or load, identifies itself as a dashboard fallback, and never hides a healthy dashboard.
- **Keep failure recovery usable without restoring a settings window.** Edit connection reuses the setup wizard in fallback-only mode, loads existing credentials through sender-constrained IPC, preserves the approval token, and returns to the fallback when cancelled.
- **Route normal troubleshooting through Diagnostics.** The tray now opens dashboard Diagnostics, and the Connection page no longer exposes Recovery details.
- **Remove routine fallback IPC.** The dashboard preload and IPC registry no longer provide an Open recovery action.
- **Separate dashboard-load failure handling.** A dedicated load-error callback opens the fallback without treating unrelated external-link failures as dashboard outages.

### Approval-token replacement and authentication recovery
- **Make token replacement a dedicated security operation.** Users must type `REPLACE`; the Electron main process generates the new token and ordinary connection-settings saves preserve the current token.
- **Revoke active ChatGPT grants immediately.** Replacement clears pending authorization codes and all OAuth access and refresh tokens before saving the new approval token.
- **Preserve the existing app and endpoint.** Registered ChatGPT clients and the permanent MCP URL remain unchanged, so users retry and reapprove the existing app instead of deleting and recreating it.
- **Persist and surface reapproval state.** Desktop status reports ChatGPT readiness as Approval required until a successful OAuth authorization clears the marker.
- **Add explicit recovery guidance.** Desktop app settings show the exact consequences, new-token copy flow, and reapproval steps; Connection shows the same existing-app recovery path.
- **Close the legacy generation path.** Token replacement is available only through the secured dashboard workflow; the compatibility settings renderer has been removed.

### Four-layer Connection status
- **Replace the generic desktop-connection card with four explicit states.** The Connection page now separates Local service, Public endpoint, ChatGPT readiness, and Dashboard updates so an event-stream interruption is not presented as a ChatGPT outage.
- **Use one connection presentation model throughout the dashboard.** Overview, the top status, and Connection consume the same normalized state instead of independently interpreting raw service and tunnel flags.
- **Add contextual recovery controls.** Desktop restart, Desktop app settings, status refresh, and dashboard Diagnostics are shown where they apply.
- **Remove token-bearing dashboard URLs from routine surfaces.** The authenticated connection API and startup logs report token configuration without returning or logging the token in a URL.
- **Expand the responsive Settings layout.** The compact settings rail now accommodates all five settings pages, and the four connection layers collapse cleanly on narrow displays.

### Dashboard-owned desktop settings
- **Move routine desktop configuration into the main dashboard.** Settings now includes a Desktop app page for the local port, permanent ngrok domain, ngrok account key, approval-token replacement, and desktop notifications.
- **Focus one settings surface.** Tray Settings and legacy Settings actions deep-link the existing secured dashboard to `#settings/desktop` instead of opening another routine window.
- **Keep desktop secrets off the HTTP surface.** Credentials move only through the constrained Electron preload IPC bridge and are not stored in URLs or browser storage.
- **Keep the initiating dashboard alive during restart.** Saving settings restarts the local service and public endpoint without destroying the window that submitted the change.

### Desktop navigation and terminology
- **Use one product vocabulary across the dashboard and desktop surfaces.** Activity, Tools, Connection, Approval token, Sessions, and Workspace name replace competing primary labels.
- **Give every route a visible identity.** The top heading and document title now follow the active page, and active navigation exposes `aria-current="page"`.
- **Keep Tools reachable at compact widths.** Mobile navigation now includes all six primary destinations.
- **Adopt canonical routes without breaking saved links.** `#tools` and `#settings/connection` are primary, while `#reference` and `#settings/connector` continue to resolve.

### Desktop UX architecture baseline
- **Define one shared desktop connection-state contract.** Local service, public endpoint, ChatGPT readiness, and dashboard live updates now have separate normalized states for the upcoming Connection redesign.
- **Add stable error codes for recovery workflows.** Authentication, service, endpoint, configuration, workspace, settings, diagnostics, reset, and update failures can be handled without parsing exception text.
- **Record the current desktop surface baseline.** Architecture documentation, a machine-readable navigation/window fixture, existing dashboard screenshots, type boundaries, and regression tests establish the Phase 0 starting point.

Bump root/electron/status UI/lockfiles to 0.21.0.

## [0.20.7] - 2026-07-23

### Context-rich repository search
- **Make adaptive search context the default without adding another tool.** `mode:"auto"` selects focused, moderate, or broad context budgets from the total match count, while explicit `compact` and `context` modes remain deterministic overrides.
- **Prioritize likely implementation files in auto mode.** File-path relevance and bounded match density decide which matched files receive context first; the raw match list remains available separately.
- **Merge overlapping and adjacent result windows by default.** Callers can disable merging, request flat ranges, and cap files, ranges per file, lines per range, and returned context bytes.
- **Make contextual results safe to reuse.** Each returned file includes its SHA-256 digest, line count, source byte count, match count, and explicit context truncation metadata.
- **Preserve broad-search observability.** Raw `matchCount` and `truncated` remain separate from `contextMatchCount`, omitted files, omitted ranges, and `contextTruncated`.

### One-shot commands and project guidance
- **Add `relai_exec` as the nineteenth connector tool.** ChatGPT can run bounded one-shot project commands with workspace-relative working directories, environment overrides, explicit output limits, and complete nonzero-exit diagnostics.
- **Track command side effects conservatively.** Command calls invalidate workspace caches, report changed files, redact sensitive audit details, and never replace the final structured validation requirement.
- **Load persistent repository instructions automatically.** Workspace inspection reads `REL_AI.md` and `.relai/instructions.md` with explicit precedence, bounded UTF-8-safe payloads, cache invalidation, and path hardening.
- **Keep the current runtime scope focused.** Repository context, one-shot commands, and project instructions are included; persistent processes, managed worktrees, task plans, and independent workers remain deferred.
- **Update documentation, desktop behavior, connector registration, type boundaries, and regression coverage for the new runtime capabilities.**

Bump root/electron/status UI/lockfiles to 0.20.7.

## [0.20.6] — 2026-07-21

### Live dashboard refresh and settings controls
- **Fix manual and live dashboard refreshes.** Aggregate dashboard reads now bypass the short client cache, the refresh action is directly visible, overlapping requests remain collapsed, and the control keeps its icon and loading state.
- **Preserve scroll position and focused controls across live remounts.** The router holds the current section height while asynchronous content remounts, then restores the exact view only when the route and render generation still match.
- **Add a Dashboard settings section.** Refresh intervals, the automatic-validation card visibility, and stored history controls are grouped separately from appearance, connector, and diagnostics settings.
- **Make automatic-validation status optional and neutral when unavailable.** Workspace cards can hide the validation summary and panel; otherwise missing commands are shown as not configured rather than as a warning.
- **Show Clear filters only when Activity filters differ from their defaults.**
- **Replace the Sessions history-load counter with explicit completion count and add guarded history reset.** Clearing removes current and rotated audit history plus waiting desktop sessions, but refuses while any Rel.AI tool call is active.
- **Improve the settings layout with a sticky navigation rail, clearer section names, responsive four-section navigation, and asynchronous mount completion.**

### Repository context policy
- **Replace the misleading per-workspace `fastTask` configuration with a focused `context` policy.** The active settings are now `snapshotMaxFiles`, `includeRoots`, and `excludePaths`; the unused changed-file and small-task flags are removed.
- **Raise the default initial repository map from 750 files to 3,000 files without restricting later investigation.** `relai_search` and direct `relai_read` calls remain available for relevant files outside the initial map or include roots.
- **Migrate existing configuration automatically.** Legacy workspace `fastTask.maxIndexFiles` and top-level `maxIndexFiles` values are accepted on read, converted to `context.snapshotMaxFiles`, and no longer written back.
- **Make connector guidance task-shaped instead of rigid.** Repository overview and search calls are optional when the file location is already known, while final validation and explicit completion remain required.
- **Add regression coverage for context migration, the 3,000-file default, snapshot scoping, and unrestricted on-demand search and direct reads.**
- **Document the next runtime phases in `docs/CHATGPT_CODING_RUNTIME_ROADMAP.md`.** The roadmap specifies unrestricted one-shot commands, persistent interactive processes, project instructions, managed worktrees, optional task plans, and independent model workers with exact integration and test requirements.

### Portable ChatGPT connector identity
- **Let an existing ChatGPT connector recover on another computer without deleting and recreating the app.** When the same static MCP URL moves to a fresh Rel.AI installation, the OAuth authorization page accepts the previously issued Rel.AI client ID as a recovery candidate and persists it only after successful dashboard-token approval.
- **Constrain connector recovery.** Recovery requires the Rel.AI-generated client-ID format, an HTTPS redirect URI, PKCE S256, and the current computer's dashboard token; old access and refresh tokens are not trusted or imported.
- **Document multi-computer handoff.** The same static ngrok domain can move between computers, but only one Rel.AI tunnel may claim it at a time and workspace paths remain local to each computer.

### First-run configuration recovery
- **Create the core Rel.AI configuration automatically during desktop setup and server startup.** Fresh installed applications no longer depend on the repository-only `npm run init-config` command.
- **Make dashboard onboarding safe to skip.** Completing or skipping onboarding now guarantees an empty valid `config.json`, allowing workspaces to be added later without leaving the dashboard in an initialization error state.
- **Recover existing affected installations.** A laptop that already has connection/ngrok settings but no core config repairs itself on the next application restart without overwriting an existing configuration.

### Connector workspace discovery
- **Expose configured workspace aliases in compact `relai_status` responses.** ChatGPT now receives the sorted alias list alongside `workspaceCount`, including when a requested alias is invalid, so it can select the exact workspace instead of probing likely names.
- **Add regression coverage for status generation and connector compaction.** Tests verify all aliases remain visible while paths and verbose server metadata stay omitted.

### Onboarding persistence and workspace picker
- **Keep onboarding dismissed after completion or Skip for now.** The status endpoint now treats both states as acknowledged instead of reopening the modal on the next launch.
- **Migrate existing configured installations automatically.** When an older installation has one or more workspaces but no onboarding marker, Rel.AI records it as already configured instead of presenting first-run setup after an upgrade.
- **Add the native folder picker to the onboarding workspace step.** Desktop users can select the repository with Browse… using the same no-timeout picker behavior as the main workspace form, while browser-only use retains manual path entry.

### GitHub release reliability and analysis cleanup
- **Make the release preflight use the GitHub REST API instead of `gh release view` exit codes.** HTTP 404 is now the only expected “release does not exist” result; HTTP 200 blocks duplicates and any other response fails with the actual status.
- **Remove SonarQube-specific GitHub instructions and annotations.** The repository keeps its project-owned maintainability regression checks without depending on SonarQube naming, directives, or workflow integration.
- **Allow failed release attempts to recover without another version bump.** Changes to the release workflow and manual dispatches can retry the current package version; existing tags or releases now produce a successful no-op instead of a failed job.

Bump root/electron/status UI/lockfiles to 0.20.6.

## [0.20.4] — 2026-07-19

### Connector session tracking repair
- **Fix every connector tool call appearing as a separate one-call work session.** Weak ChatGPT transport and session identifiers are now classified separately from stable conversation identifiers.
- **Repair the poisoned-session state caused by multiple waiting transport fragments.** A new weak transport call selects the most recent compatible workspace task and absorbs older weak waiting siblings instead of refusing to reconnect forever.
- **Retroactively stitch existing one-call audit groups in the dashboard.** Legacy opaque MCP scopes from the same process and workspace are grouped inside the five-minute window, while different stable ChatGPT conversation scopes remain separate.
- **Keep live state attached when the active task is one of the stitched fragment IDs.** The dashboard now shows the combined session as working or waiting rather than rendering each persisted event as inactive.
- **Prevent audit-log write failures from replacing the original tool error.** Audit persistence is best-effort on failure paths, with diagnostics emitted only when debug logging is enabled.
- **Add regression coverage for overlapping transport calls, permanent fragmentation recovery, legacy history repair, active-session matching, and stable-conversation isolation.**

Bump root/electron/status UI/lockfiles to 0.20.4.

## [0.20.2] — 2026-07-19

### Electron-only packaging and release integrity
- **Fix released installers shipping without the bundled ngrok agent, which made tunnels fail on clean machines. CI and the release workflow now fetch the ngrok seed before packaging.**
- **Add a packaging preflight (npm run verify:ngrok) that refuses to build an installer without a valid ngrok seed, and assert the seed in the packaged-app smoke test.**
- **Make the release consistency gate itself reject a missing or truncated Windows ngrok seed, and fetch that seed before the release test suite runs.**
- **Bundle only the build platform's ngrok binary, cutting packaged resources from roughly 83 MB to 33 MB.**
- **Remove the pre-Electron CLI launcher, the npx-based Cloudflare/localtunnel providers, and the manual install scripts, so no path requires installing Node, npm, or ngrok by hand.**
- **Rewrite the README and setup docs around the desktop installer instead of npm run oneclick.**

### Desktop workflow reliability
- **Fix Activity event JSON copying in the sandboxed Electron dashboard by routing clipboard writes through the main process, with browser clipboard and legacy-copy fallbacks.**
- **Recover safe passed validations when ChatGPT rotates connector or task identity before calling relai_complete_task, while still rejecting every successful workspace mutation made after that validation.**
- **Keep one waiting workspace session grouped across connector reconnects, extend the grouping window to five minutes, merge recovered completion history, and let a later successful validation supersede an earlier failed attempt.**
- **Remove release-validation flakiness by allocating an available HTTP test port and writing unpacked validation builds to a dedicated directory that is not locked by a running installed app.**
- **Remove stale launcher metadata, obsolete Cloudflare setup material, outdated tool counts, and legacy one-click/tunnel validation aliases from normalized workspace configuration.**

Bump root/electron/status UI/lockfiles to 0.20.2.

## [0.20.1] — 2026-07-19

### Connector result integrity fixes
- **Raised the default MCP tool-result ceiling from 120,000 bytes to 512 KiB.** Connector reads up to the active-session 256 KiB budget now retain their full `items` payload instead of collapsing into the generic outer truncation summary.
- **Streamed `git grep` output inside `relai_search`.** Searches larger than the generic process-output budget now preserve their earliest matches and report the complete visible `matchCount` without buffering the entire result.
- **Added regression coverage for a 256 KiB connector read and more than 1 MiB of search output.**

Bump root/electron/status UI/lockfiles to 0.20.1.

## [0.20.0] — 2026-07-19

### Connector speed improvements
- **Added relai_search: git-grep-backed workspace text search (18-tool surface).**
- **relai_repo_snapshot now inlines a git summary (branch, ahead/behind, changed files).**
- **Connector relai_read defaults to 128KB with a line-range hint on truncation.**
- **Connector snapshot replaces the skipped-entry list with a count.**
- **Snapshot walk skips the binary sniff for known text extensions.**
- **Initialize instructions and recommendedFlow now advertise the search-first, one-call edit workflow.**

Bump root/electron/status UI/lockfiles to 0.20.0.

## [0.19.8] — 2026-07-18

### Reliability, safety, and release hardening
- **Make workspace mutations transactional and accurately observable.** Batch edits and structured patches now preflight all targets, roll back previously applied files after runtime failures, avoid journals and staging payloads during dry runs, serialize operations per workspace, and record returned `ok: false` results as real failures.
- **Tighten session ownership and Git safety.** Workspace sessions are scoped to the active task, failed baseline capture is explicit and untrusted, completion clears ownership state, Git discovery is centralized across supported platforms, and secret-path commit refusal restores the original index.
- **Harden HTTP, OAuth, and process lifecycle behavior.** Async routes are awaited, OAuth state uses locked atomic persistence, quiet SSE connections receive heartbeats, timed-out Unix checks terminate their process groups, and large UTF-8 output is truncated without corrupting characters.
- **Improve dashboard and Electron reliability.** Manual refresh bypasses stale request cache, overlapping refreshes collapse safely, refresh controls always recover after errors, workspace filtering uses a focused accessible control, live polling responds to configuration changes, and packaged Electron smoke coverage now exercises refresh and workspace selection interactions.
- **Improve review and repository boundaries.** Untracked file contents are included in review diffs, safe replacements preserve file permissions where supported, literal escaped newlines remain unchanged, runtime state directories are excluded from snapshots, and managed ngrok accepts only the configured public domain.
- **Make session tool events directly inspectable.** Persisted events in the Sessions drawer now link to the matching Activity entry, preserve workspace and task filters, highlight the selected row, and open its exact detail drawer with packaged Electron interaction coverage.
- **Keep validation comprehensive without redundant execution.** Standard validation follows transitive npm-script aliases instead of rerunning covered checks, MCP smoke tests share one process harness, overlapping validation-strategy suites are consolidated into a single table plus Git integration test, and the complete gate passes all 62 focused test files.
- **Align CI with supported Node.js releases.** The required test matrix now covers Node.js 22 and 24 LTS, removes end-of-life Node.js 18 and 20 jobs, and declares Node.js 22.13 as the minimum supported runtime to match the current toolchain.
- **Move GitHub Actions off their deprecated Node.js 20 runtime.** CI and release workflows now use `actions/checkout@v6` and `actions/setup-node@v6`, with a repository-health guard rejecting older majors that still execute on Node.js 20.

Bump root/electron/status UI/lockfiles to 0.19.8.

## [0.19.7] — 2026-07-18

### HTTP, dashboard, and MCP read performance
- **Move dynamic JSON compression off the main thread.** Large responses now use asynchronous level-4 gzip above a configurable size threshold, respect `gzip;q=0`, preserve cache-variant headers, and leave small responses uncompressed.
- **Remove redundant dashboard work during startup and live updates.** The dashboard uses its embedded bootstrap state without immediately refetching it, SSE begins with a lightweight readiness event, repeated audit parsing is consolidated, and expensive workspace Git state is briefly cached while live task activity remains current.
- **Add bounded MCP file reads.** `relai_read` now accepts `startLine` and `endLine`, reports the returned range and byte count, and truncates UTF-8 content without returning broken characters.
- **Eliminate duplicate file I/O and repeated hashing.** File SHA-256 values are calculated from the already-read buffer, and active-session cache entries retain digest and source-size metadata for subsequent reads.
- **Reduce connector payload size before serialization.** Connector reads default to compact write guidance, support explicit `full`, `compact`, or `none` modes, and retain compatibility for clients that need the complete guidance object.
- **Fix cached text reads being misclassified as binary files and add regression coverage for compression, SSE startup, Git-state caching, ranged reads, CRLF preservation, UTF-8 truncation, schema discovery, and cache metadata.** The complete release gate passes all 60 test files.

Bump root/electron/status UI/lockfiles to 0.19.7.

## [0.19.6] — 2026-07-11

### Electron startup and task completion regression fixes
- **Fix the 0.19.5 packaged-app crash `Cannot access 'dashboardWindowManager' before initialization`.** The dashboard window manager and tray controller are now initialized before the task-activity runtime emits its synchronous initial status update.
- **Keep Rel.AI task identity stable when ChatGPT rotates MCP transport sessions.** Conversation identifiers now take precedence over `Mcp-Session-Id`, allowing `relai_complete_task` to find the successful final validation from the same conversation.
- **Add regression assertions for launcher initialization order and task completion across rotated MCP transport sessions.**
- **Make the installed-app smoke test derive its expected tool count from the current public schema, confirming that the packaged 17-tool surface includes `relai_complete_task`.**
- **Revalidate the complete release suite and Windows Electron package after these corrections.**

Bump root/electron/status UI/lockfiles to 0.19.6.

## [0.19.5] — 2026-07-11

### Desktop window consolidation
- **Made the Electron dashboard the primary configured-launch window, removing the separate launcher window from the normal taskbar flow.**
- **Opened the dashboard as soon as the local service is ready while the public ngrok tunnel continues connecting in the background.**
- **Added live desktop service and tunnel status plus settings, restart, recovery, and stop controls directly to the dashboard.**
- **Converted the former launcher status window into an on-demand connection recovery surface and kept persistent lifecycle controls in the system tray.**
- **Changed dashboard close behavior to hide the application to the tray and added startup, restart, focus, packaging, and live-status regression coverage.**

Bump root/electron/status UI/lockfiles to 0.19.5.

## [0.19.4] — 2026-07-11

### Explicit validated task completion
- **Add `relai_complete_task` as the final workflow signal ChatGPT can call after the coding work is finished, increasing the unified MCP surface to 17 tools.**
- **Advertise the completion contract through MCP initialization instructions and the tool description: run one final `relai_run_checks`, then call `relai_complete_task` exactly once as the final Rel.AI tool.**
- **Reject completion when the current work session has no successful validation, when code changed after the latest passed validation, or while another Rel.AI tool call remains active.**
- **Record explicit completion with `completionKnown: true`, an `explicit_completion` end reason, validation metadata, changed files, and a concise ChatGPT-provided summary.**
- **Show confirmed completion distinctly from inactivity throughout Sessions, Overview, audit-derived history, and the Electron status window; restore desktop completion notifications only for this explicit validated signal.**
- **Make successful validation results consistently expose `validated` and `validationStatus`, and add end-to-end regression coverage for missing validation, changed-after-validation refusal, explicit completion persistence, and trusted completion notifications.**

Bump root/electron/status UI/lockfiles to 0.19.4.

## [0.19.3] — 2026-07-11

### Deterministic tool-session observability
- **Stop presenting a 60-second inactivity timeout as proof that ChatGPT completed a task. Rel.AI now distinguishes exact running tool calls, waiting sessions with no active call, and sessions closed only as inactive after the grouping window.**
- **Track each active operation with its own identifier, tool, workspace, start time, human-readable action, and live progress text; validation now reports the exact command currently running.**
- **Persist operation descriptions in the audit log and surface them throughout the dashboard session list, session drawer, Overview activity card, and Electron status window.**
- **Rename the dashboard Tasks navigation to Sessions and replace completion-oriented copy with explicit statements about what Rel.AI can observe and what remains unknown about ChatGPT reasoning or overall request completion.**
- **Remove successful task-completion notifications. Desktop notifications now fire only for observed failed tool calls and identify the failed operation and workspace.**
- **Keep the 60-second window only as a grouping boundary for related calls, with `completionKnown: false` and an `inactivity_window` end reason instead of a fabricated completed state.**

Bump root/electron/status UI/lockfiles to 0.19.3.

## [0.19.2] — 2026-07-11

### Dashboard task grouping and compact sidebar fixes
- **Fix the intermediate-width Electron dashboard sidebar by assigning the compact rail its own 82-pixel grid column, stacking its contents vertically, centering the brand mark, preventing horizontal clipping, and removing the duplicate main-content offset.**
- **Make Tasks represent grouped work instead of duplicating the Activity log by assigning task IDs to local and stdio tool calls as well as HTTP connector calls, then retaining related follow-up calls within the existing 60-second idle window.**
- **Infer time-bounded task groups for older audit entries that do not contain task IDs, so existing history can consolidate related calls rather than rendering every event as a one-call task.**
- **Track all active tool calls separately from connector-only calls, preserving accurate task status while keeping Electron's system-sleep blocker limited to authenticated connector activity.**
- **Add regression coverage for compact sidebar layout, local task tracking, and legacy audit grouping; the complete validation suite passes all 58 test files.**

### Workspace dashboard cleanup
- **Replace the crowded workspace badge and button wall with a structured card showing repository identity, branch and worktree state, last validation, recent activity, automatic validation commands, repository policy, and a smaller set of useful actions.**
- **Remove the separate Rename, Context settings, context-mode toggle, Git preflight, Save detected tests, and stale-test controls from the workspace UI; rename Clear to Remove workspace and keep repository files explicitly untouched.**
- **Show the exact standard validation commands that Rel.AI will execute instead of legacy configured-test counts, and hide Run validation when no executable validation plan is detected.**
- **Make the saved workspace index limit control the default repository overview size, and refresh command discovery when any supported project manifest changes rather than watching only package.json.**
- **Hide the global workspace selector on pages where it has no effect, hide desktop-only folder actions in the browser, clear stale workspace filters after removal, scope health metrics to the selected workspace, and direct missing-token diagnostics to relevant connector guidance.**

Bump root/electron/status UI/lockfiles to 0.19.2.

## [0.19.1] — 2026-07-11

### Unified dashboard and desktop experience
- **Redesign the dashboard Overview and Electron status window around connection readiness, the ChatGPT MCP endpoint, focused metrics, actionable warnings, explicit loading and retry states, and compact technical details.**
- **Replace the five-page launcher flow with a four-step setup experience that combines local-service configuration, validates fields live, supports Enter-key navigation, protects the ngrok account key with show/hide controls, and presents a clearer launch summary.**
- **Add responsive product navigation with icons, an intermediate sidebar rail, mobile bottom navigation, consistent action feedback, and a substantially more capable Activity log with filters, automatic event merging, and structured event details.**
- **Simplify the dashboard by removing the unused top workspace jump and command launcher, replacing the dense tool table with searchable capability cards, and removing misleading connector and workflow-mode settings that did not change tool availability.**
- **Add persistent appearance preferences with system, dark, and light themes plus comfortable and compact density modes, including reduced-motion-safe transitions and matching system appearance in the desktop launcher.**
- **Improve desktop operations with remembered disclosure panels, copyable diagnostics, optional native connection notifications, semantic status output, and accessibility and Sonar maintainability cleanup.**
- **Fix normal launcher startup by importing the shared window-size limits used by the wizard and status windows, and extend packaged-app verification to boot both renderer surfaces so window-creation regressions fail before release.**
- **Rename milestone-oriented UI files and tests to responsibility-based production names.**

### Single 16-tool workspace surface
- **Remove the archive and bundle subsystem, direct clear-file API, hidden tool aliases, feature probe, refactor audit, session-summary tool, manual session-policy tool, and hidden Git fetch/merge/abort orchestration.**
- **Replace the public/internal dual registry with one 16-tool schema, handler map, MCP list, dashboard metadata source, and packaged-application contract.**
- **Retain structured patch deletion and the bounded tidy plan/run path while removing obsolete general-purpose deletion plumbing.**
- **Replace prepared-workflow and bundle settings with focused patch safeguards for backup, clean-git enforcement, and maximum update size.**
- **Add an obsolete-surface residue scan and validate the release with JavaScript checks, TypeScript boundary checks, release consistency checks, 57 regression files, and the installed Windows application smoke test.**
- **Make `npm test` delegate to the authoritative `test:all` runner, avoiding duplicate Windows child-process chains.**
- **Prevent system sleep only while an authenticated connector tool call is executing, using one reference-counted Electron `prevent-app-suspension` blocker for overlapping calls while still allowing the display to turn off.**
- **Add native task-completion notifications after 10 seconds of connector inactivity, aggregate chained tool calls into one alert, distinguish successful completion from failures, and connect the existing desktop notification toggle to background alerts.**
- **Redesign the Electron status window around live ChatGPT activity, separate local/public connection health, persistent last-task results, contextual recovery actions, and a true desktop-notification switch.**
- **Replace wizard-based configuration editing with a dedicated Settings screen for connection, access-token, and notification preferences, and preserve the user’s window position during content-driven resizing.**
- **Open the full dashboard inside a sandboxed Electron window by default while preserving the existing browser route, inject dashboard authorization only for the exact loopback origin, block native permissions and cross-origin navigation, and remove the launch token from browser history.**
- **Share live grouped task state with the web dashboard so Overview and the top bar show active, wrapping-up, completed, and attention-required ChatGPT work in both desktop and browser hosts.**
- **Persist connector task identity into audit events and add a Tasks view with duration, tool events, changed files, validation outcomes, failures, commit/push state, and workspace-scoped drill-down into the Activity log.**
- **Replace the unreliable single global 10-second task bucket with per-MCP-session task scopes, multiple concurrent task records, parallel JSON-RPC batch handling, and one renewable 60-second idle lease so normal ChatGPT reasoning and approval gaps stay grouped into the same task.**
- **Harden the Windows installed-application smoke test by keeping NSIS on the runner's real Windows profile while isolating only the launched application, and run the installer as the current user to avoid hosted-runner access violations.**
- **Remove ambient `PATH` lookup from dashboard Git-state inspection; Rel.AI now invokes Git only from fixed trusted installation directories and reports Git as unavailable otherwise.**
- **Resolve the new dashboard Sonar findings for nested conditionals/templates, in-place sorting, unnecessary `void`, default-value reassignment, and cognitive complexity, with a regression scan for the reported new-code patterns.**
- **Add a global workspace scope across Overview, Tasks, Workspaces, Activity, and Diagnostics; enrich workspace cards with branch, ahead/behind, dirty/session-owned files, validation history, recent activity, native folder opening, and direct validation.**
- **Reorganize dashboard navigation around Overview, Tasks, Workspaces, Activity log, and Settings, move tool schemas into secondary Reference navigation, and add explicit Live, Reconnecting, Paused, and last-event indicators.**
- **Replace the Electron dashboard bearer-header bridge with a single-use bootstrap exchange and HttpOnly SameSite session cookie, persist dashboard bounds and the last route, and redesign Diagnostics around severity, impact, recommendations, direct actions, and disclosed technical details.**

Bump root/electron/status UI/lockfiles to 0.19.1.

## [0.18.2] — 2026-07-08

### Sonar security and accessibility cleanup
- **Harden CLI-controlled path handling in product UX flows by validating relative input, canonicalizing with `fs.realpathSync()`, and checking separator-terminated base directories before use.**
- **Tighten local HTTP security by removing request-controlled CORS policy construction and fixed-PATH Git subprocess hotspots.**
- **Clear remaining Sonar maintainability findings across optional chaining, nested ternaries, redundant test blocks, unsafe test logging, and Electron contrast styling.**
- **Validate the release with `npm run check`, `npm test`, and `npm run test:all` after the cleanup from f629da1402398c27a1a1d3f73a4836fc35afcbc2.**

Bump root/electron/status UI/lockfiles to 0.18.2.

## [0.18.1] — 2026-07-08

### Lint pass and code-quality cleanup
- **Add ESLint config and clear all lint errors across source and tests.**
- **Remove unused imports, variables, and dead functions; prefix required-but-unused callback params with `_`.**
- **Attach `cause` to re-thrown JSON-parse and clear-files errors so the original error is preserved.**
- **Drop an unnecessary regex escape and dead constant-condition test code without changing behavior.**

Bump root/electron/status UI/lockfiles to 0.18.1.

## [0.18.0] — 2026-07-06

### Session ownership safety and leaner connector output
- **Auto-start a workspace session on the first edit and capture the pre-edit baseline, so status/diff correctly separate this session's changes from pre-existing dirty files.**
- **relai_tidy_plan refuses to plan deletions when no session baseline exists, closing a path where pre-existing untracked user files could be treated as disposable session artifacts.**
- **Compact tool results on the ChatGPT connector: drop always-default policy objects, internal telemetry, duplicated arrays, full manifest text, and per-file write-guidance blobs.**
- **Remove the dead dashboard Current work card, fix state-dir fallbacks that dirtied the running repo, and correct docs to match real session behavior.**
- **Add auto-session, tidy-fence, and connector-compaction regression tests.**

Bump root/electron/status UI/lockfiles to 0.18.0.

## [0.17.1] - 2026-06-30

### Dashboard refresh and status polish
- **Dashboard refresh no longer breaks active work.** Background connector events update shared state, shell status, and Activity rows without re-mounting the current page, so settings drafts, open modals/drawers, filters, and scroll position are preserved.
- **Live mode is automatic.** The top-bar **Start live** control was removed; the dashboard connects to server-sent events on load and keeps **Refresh** only as a manual fallback.
- **Server-sent dashboard events are change-gated.** The server now emits dashboard snapshots only when config or audit state changes instead of pushing repeated no-op refreshes.
- **Workspace mutations refresh in place.** Add/edit workspace, save detected tests, rename, clear, context changes, and stale-test cleanup trigger an in-page dashboard refresh rather than a full page reload.
- **Diagnostics is now product-facing.** The page is presented as **System status**, hides release-readiness/temp-resource noise, renames raw output to **Details**, and reframes command/caution checks as validation commands and protected config changes.
- **Activity wording and state are clearer.** The table uses **Freeze list** instead of pause-live wording and preserves search/time filters across re-renders.

Bump root/electron/status UI/lockfiles to 0.17.1.

## [0.17.0] - 2026-06-30

### Workflow reliability
- **Workflow contract tightened.** Public guidance favors the unified edit flow before fallback tools.
- **Stale hash edits now fail closed.** Exact replacements refuse mismatched expected file hashes.
- **Batch edit wording is safer.** Planner responses report preflight-only atomicity.

Bump root/electron/status UI/lockfiles to 0.17.0.

## [0.16.9] — 2026-06-30

### Electron and dashboard UI polish
- **Electron setup now uses a cleaner card-based wizard flow.** The setup screen has improved spacing, typography, progress treatment, input styling, and review copy while preserving the existing launcher IDs and behavior.
- **Electron status now presents the cloud connection state more clearly.** The status window has a stronger header, clearer local service and public tunnel cards, and a more readable ChatGPT MCP endpoint copy area.
- **Dashboard styling now matches the desktop launcher more closely.** The dashboard gets a product-polish CSS layer for tighter spacing, deeper card surfaces, improved sidebar/topbar treatment, cleaner metrics, and better responsive behavior.

Bump root/electron/status UI/lockfiles to 0.16.9.

## [0.16.8] — 2026-06-30

### Bundled managed ngrok + HTTPS-first connection guidance
- **Rel.AI MCP now ships a managed ngrok agent so users no longer install npm, Node, or ngrok by hand.** The launcher copies a bundled seed binary (`vendor/ngrok/<platform>/`) into the user's writable state folder on first launch, runs the managed copy from there, and lets it self-update on a weekly interval.
- **Authtoken handling is validated and stored privately.** The ngrok authtoken is normalized (non-empty, no spaces, minimum length) and written to a `0600` config in the managed state dir; the wizard guides ngrok account setup.
- **Connection UI emphasizes the HTTPS requirement for the ChatGPT integration.** Connection handling and wizard messaging now make clear that ChatGPT requires an HTTPS public URL.

Bump root/electron/status UI/lockfiles to 0.16.8.

## [0.16.7] — 2026-06-30

### Safer public workspace tidy workflow
- **Replaced the public direct cleanup surface with a two-step tidy plan/run workflow.** ChatGPT now sees `relai_tidy_plan` and `relai_tidy_run` instead of the direct public `relai_clear_files` path; the server selects bounded session-owned untracked candidates and the apply step only accepts a short-lived plan ID.
- **Tidy plans are expiry-bound and hash-checked before they change the workspace.** Plans expire after 15 minutes, are tied to the workspace alias/root, and each candidate must still be session-owned, untracked, file-shaped, and SHA-matching before it is touched.
- **Kept the lower-level clear primitive internal instead of leaving dead code.** `relai_clear_files` remains available on the full local/stdin surface and is still used by trusted internals such as obsolete-file retirement and the tidy runner, but it is no longer advertised on the public ChatGPT connector surface.
- **Validation is harder to misread.** `relai_run_checks` now reports `validationStatus: "not_run"` with `ok:false` when no checks are detected, and build-only/frontend package projects now run `npm run build` instead of looking validated when nothing ran.
- **Batch edits are preflight-first.** `relai_edit` batches now validate all requested edits before writing; if any edit fails, zero edits are applied.
- **Regression coverage now locks down the new behavior.** Added workspace tidy tests for plan/run success and SHA-mismatch refusal, plus updated public tool-count and smoke coverage for the new 18-tool connector surface / 29-tool full surface.

Bump root/electron/status UI/lockfiles to 0.16.7.

## [0.16.6] — 2026-06-29

### Folder picker fixes (desktop launcher)
- **Fixed the "Browse" folder picker timing out after ~8 seconds.** The dashboard fetch layer aborted every request at 8s, including the picker POST that blocks on user input. Requests can now opt out of the timeout; the folder picker waits indefinitely until you pick or cancel.
- **Fixed the picker opening behind the browser and flashing the taskbar.** The dashboard runs in the external browser, so the native dialog had no parent window and Windows refused to bring it to the foreground. The picker now opens against a focused anchor window so it surfaces on top instead of blinking the taskbar icon.

Bump root/electron/status UI/lockfiles to 0.16.6.

## [0.16.5] — 2026-06-29

### Dashboard auth fix
- **Fixed "Unauthorized. Send Authorization: Bearer <REL_AI_MCP_TOKEN>" shown after dashboard mutations (add workspace, save detected tests, rename, clear, context changes).** The boot script strips `?token` from the URL after reading it, so the post-mutation `location.reload()` re-requested the token-gated `/dashboard` route with no credentials and got a 401. Reloads now re-attach the token (and preserve the current section hash); the boot script strips it again on the next load.

Bump root/electron/status UI/lockfiles to 0.16.5.

## [0.16.4] — 2026-06-11

### Tool surface, settings, and dashboard improvements
- **Connector tool surface trimmed from 24 to 17: relai_edit is the primary write path (exact replace, full-file write, diff, or a batch of edits in one approval), with relai_write/relai_replace kept as fallbacks.**
- **relai_edit gains batch edits (edits:[...]), runChecks, and returnDiff so a change-validate-review loop is a single tool call, plus staged updateText (stage start/append/commit) for large diffs.**
- **Niche tools (apply_update, feature_probe, git_fetch, git_merge_*, git_abort_merge, remove_file, refactor_audit) moved off the ChatGPT surface but remain callable over stdio.**
- **All public tools advertise a uniform safe annotation set to reduce connector classifier friction; the real boundary stays server-side.**
- **Security: relai_git_push/fetch now enforce the workspace allowedRemotes allowlist, blocking git ext:: command-execution transports.**
- **Dashboard performance: audit log rotates at 5 MB and is tail-read, command-availability and command-discovery are cached, and cleanup now covers stale journals and staged payloads.**
- **Removed the dead dashboardEnabled setting; settings API now rejects unknown productUx/release keys.**
- **What's-new card now renders in the packaged app (CHANGELOG bundled) and no longer mangles snake_case tool names.**
- **Local MCP state directory is gitignored and no longer dirties the repo during tests; tunnel npx fallback works on Windows.**
- **All server guidance now matches the 17-tool surface.** Snapshot write guidance, error-recovery hints, status tool groups, the MCP help resource, README, docs, and dashboard copy steer ChatGPT to relai_edit instead of tools that are no longer publicly visible; relai_edit patch errors get the same format guidance as the old apply_update.
- **relai_git_fetch reports a clear error when no configured remote matches allowedRemotes instead of a hollow success.**

Bump root/electron/status UI/lockfiles to 0.16.4.

## [0.16.3] — 2026-06-11

### Audit fixes
- **Fix multi-byte UTF-8 request bodies corrupted when split across network chunks (emoji/CJK content in relai_write payloads).**
- **Fix relai_apply_update crash: ensureGitRepo was not exported from gitOps, breaking the prepared patch flow.**
- **Kill the full process tree when a check times out on Windows so npm/node children no longer linger.**
- **Refuse relai_git_commit when staged files look like secrets (.env, keys) unless allowSecretPaths: true.**
- **Prune stale OAuth dynamic-registration clients so oauth-store.json no longer grows unbounded.**
- **Compare the dashboard query token in constant time.**
- **test:all now auto-discovers every test file via test/run-tests.mjs; twenty unit test files were silently never running in CI.**
- **Cache dashboard SSE config reads by file mtime to cut per-tab polling cost.**

Bump root/electron/status UI/lockfiles to 0.16.3.

## [0.16.2] — 2026-06-05

### MCP audit fixes and release hardening
- **Public tool metadata now matches real connector behavior.** Read-only, write, destructive, and open-world hints are no longer collapsed into one misleading safe-looking annotation, and the dashboard now derives its 24 public tool list from the actual schemas.
- **Workspace mutation paths now have safer dry-run and no-op behavior.** Prepared patch and bundle applies can preview without changing files, clear-file dry runs report `wouldClear` separately from `cleared`, scoped dry-run commits no longer imply add-all, and empty PR drafts are refused with a clear warning.
- **Dashboard, Electron, and setup guidance are easier to follow.** Public tunnel wording replaces ngrok-specific labels where appropriate, ChatGPT setup instructions point to the current Apps flow, and stale removed-tool guidance no longer lists active tools.
- **Regression coverage now locks down the audit fixes.** The smoke suite covers tool counts, auth gating, dry-run patching, empty PR drafts, tunnel wording, one-click routing, release-level `test:all` detection, and git workflow safety.

Bump root/electron/status UI/lockfiles to 0.16.2.

## [0.16.1] — 2026-06-05

### Rel.AI MCP usage instruction quality-of-life pass
- **Dashboard connector instructions now follow the whole ChatGPT app flow.** The Connector page walks users through copying the `/mcp` endpoint, creating the ChatGPT app, choosing OAuth, approving with the dashboard token, selecting the app in chat, and starting with a read-only workspace check.
- **Dashboard onboarding now teaches safer first prompts.** The setup modal explains workspace aliases, recommends `relai_git_status` plus `relai_repo_snapshot` before edits, and shows the same ChatGPT app/OAuth setup flow in context.
- **Electron launcher guidance is clearer at the moment users need it.** The setup wizard and status window now explain the token's OAuth role, show persistent ChatGPT app setup steps, and give copy buttons immediate copied-state feedback.

Bump root/electron/status UI/lockfiles to 0.16.1.

## [0.16.0] — 2026-06-05

### Real OAuth authentication for the ChatGPT connector
- **ChatGPT now connects with real OAuth 2.1, not "No Authentication".** The server is its own OAuth authorization server: it serves `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, supports dynamic client registration at `/register`, and runs the authorization-code + PKCE (S256) flow via `/authorize` and `/token`.
- **A protected `/mcp` endpoint drives the OAuth handshake.** `POST /mcp` without a valid credential now returns `401` with a `WWW-Authenticate: Bearer resource_metadata=…` challenge so ChatGPT auto-discovers the auth endpoints; OAuth-issued access tokens (and the existing local bearer token) are accepted.
- **The OAuth login is gated by your Rel.AI dashboard token.** The `/authorize` sign-in page validates the existing `REL_AI_MCP_TOKEN` before minting a single-use authorization code, so no new password store is introduced; tokens persist to a `0600` `oauth-store.json` so ChatGPT need not re-auth on every restart.
- **Connector UX, banner, and docs now say OAuth.** The dashboard connector steps, launcher banner, connection summary, and SECURITY.md describe the OAuth flow.
- **The legacy secret-in-URL no-auth path is removed, along with all of its plumbing.** `/mcp/<secret>`, `/sse/<secret>`, and `/messages/<secret>` are no longer special routes (they return 401/404); access to `/mcp` requires OAuth or a Bearer token. The `REL_AI_MCP_CHATGPT_SECRET` env var, the `chatgpt-secret` state file, `resolveChatGPTSecret`/`getChatGPTSecretPath`, the `--chatgpt-secret`/`--reset-chatgpt-secret` CLI flags, and the secret fields in the connection summary/diagnostic are all gone. The launcher advertises the plain `/mcp` URL.

Bump root/electron/status UI/lockfiles to 0.16.0.

## [0.15.8] — 2026-06-05

### HTTP auth disclosure hardening
- **Public MCP diagnostics no longer reveal the ChatGPT secret.** `GET /mcp` now returns a redacted `/mcp/<secret>` value unless the caller already proves access with bearer auth or the secret path, while secret-path and bearer POST clients keep working as before.
- **Dashboard token bootstrapping cleans up the address bar.** The dashboard still accepts `?token=` for launch links, then moves the credential into session storage and removes the query token from the visible URL.
- **Regression coverage and docs now pin the safer behavior.** HTTP smoke/auth tests assert redaction and token-sync boundaries, and ChatGPT/security/setup docs explain the redacted diagnostic behavior.

Bump root/electron/status UI/lockfiles to 0.15.8.

## [0.15.7] — 2026-06-05

### Security, dashboard consistency, and release metadata audit
- **Workspace upsert now matches the UI promise for not-yet-cloned repos.** The settings form already warned that a missing path could still be saved, but the server rejected it. Upsert now allows absolute missing paths so users can save a workspace before cloning; actual tool calls still fail safely until the path exists.
- **Dashboard and connector diagnostics now agree on stale commands.** The shared stale-command helper now covers both `commands` and `testCommands`, so `relai_status` and the Diagnostics “Command aliases” card classify stale entries the same way instead of one surface saying “stale” while the other said “All consistent.”
- **Connector setup steps no longer duplicate themselves.** The dashboard’s Connector card keeps the fixed three core ChatGPT setup steps, then renders only real `payload.nextSteps` as extra numbered guidance instead of falling back to duplicate copies of steps 1–3 as steps 4–6.
- **Tool counts are now runtime-derived instead of hardcoded.** Dashboard data exposes `toolCount` from the public tool schema list, Workspaces uses that value, and the Home section’s unused `visibleToolCount` fallback was removed so the UI cannot drift from the real public tool count.
- **Dashboard refresh cadence and live-event wiring are now consistent.** `productUx.dashboardRefreshSeconds` drives the fallback polling interval, `_toggleLive()` no longer re-registers the event system on every toggle, and `initEvents()` itself is idempotent so visibility listeners cannot stack if called again later.
- **Dead or misleading release/settings knobs were cleaned up or wired.** `minimumReadinessScore` now appears in release readiness with `meetsMinimum`, `requireHttpToken` is honored as the default when the query param is absent, and the dead release endpoint/probe-timeout settings were removed from normalization defaults.
- **State export now honors `productUx.enableStateExport`.** When the flag is false, `stateExport()` fails with a clear message instead of exporting anyway.
- **CI, response, and connector-contract cleanup.** CI workflow scanning now resolves `.github/workflows` from the project root instead of `process.cwd()`, the misspelled `cleard` response alias was removed in favor of `cleared`, and identical tool annotation constants were collapsed into one documented connector-safe hint constant.

Bump root/electron/status UI/lockfiles to 0.15.7.

## [0.15.6] — 2026-06-05

- **`relai_status` stale-command misclassification fixed.** It checked `!discovered[cmd]` (indexing the discovered map by the command *string*) instead of `!discovered[key]`, so it flagged commands stale differently from the dashboard diagnostic. Both now use one shared `staleCommandKeys(configured, discovered)` helper.
- **Dashboard no longer shows a bare "v".** Release notes fell back to an empty version when CHANGELOG.md couldn't be read (packaged launcher); the fallback now uses the package version, and the "What's new" card renders "Latest" instead of a lone "v" if the version is ever empty.

Bump root/electron/status-UI/lockfiles to 0.15.6.

## [0.15.5] — 2026-06-05

### Dashboard consistency pass (live controls, dead settings, logo)
- **Refresh is back in the topbar.** 0.15.3 removed it; restored next to the live toggle. (The token field stays gone — it loads from the URL/sessionStorage.)
- **Activity "Pause live" renamed to "Pause updates"** with a tooltip. It only freezes that table so rows don't shift while you read — it is *not* the same as the top-bar live toggle (which starts/stops the whole dashboard's live stream). The two shared the word "live" and looked redundant; they aren't.
- **Tray icon uses the dashboard logo.** The system-tray icon loaded a stale `icon.ico`; it now uses `build/icon.png` (the same `relai-logo.png` art the dashboard and launcher window show), resized for the tray. The unused `icon.ico` was removed.

Bump root/electron/status-UI/lockfiles to 0.15.5.

## [0.15.4] — 2026-06-05


## [0.15.3] — 2026-06-05

### Slimmer dashboard topbar
- Removed the **Dashboard token** field and the **Refresh** button from the topbar. The token already loads from the URL / sessionStorage at boot, so the input was redundant noise (especially in the desktop launcher); manual refresh and "Copy dashboard token" remain in the command palette. The topbar now carries just the status pill, the live-mode toggle, and the last-updated time.

Bump root/electron/status-UI/lockfiles to 0.15.3.

## [0.15.2] — 2026-06-04

### Clear a broken workspace, dynamic "What's new", unified logo
- **A workspace with a missing path can now be cleared.** `relai_clear`/Clear failed with `Workspace path does not exist` because the config editor had no `clear` action and fell through to `upsert`, which validates the path. `clear` is now handled as a removal alongside `delete`/`remove` and never touches the path — so an entry whose folder is gone is removable again.
- **"What's new" is read from CHANGELOG.md** instead of a constant that was frozen at v0.13.0. `getReleaseNotes()` parses the latest `## [version]` block (headline + top-level bullets, markdown stripped) and falls back gracefully if the file can't be read.
- **Electron launcher uses the dashboard logo.** The launcher status window and setup wizard now show the real `relai-logo.png` (same asset the dashboard sidebar uses) instead of an "R" placeholder badge / link glyph, and the Windows build icon is generated from the 512px logo (`build/icon.png`).

Bump root/electron/status-UI/lockfiles to 0.15.2.

## [0.15.1] — 2026-06-04

### Workspace management QOL: fix a broken workspace path without deleting it
- **The dead-end is gone.** A workspace whose path no longer exists used to surface a `workspace_unavailable` health finding with no way to act on it — the only option was Clear (delete the whole entry). The workspace card now shows the error inline with a **Fix path** button, every card has an **Edit** action, and the Health-findings rows carry inline **Edit path** / **Remove** buttons wired to the offending alias. Diagnostics findings for the same case link straight to the actionable Workspaces view.
- **Add/Edit workspace is now a proper modal form** (replacing the chained `window.prompt`s): alias, path, protected branches, default base branch, and allowed remotes in one dialog. The path field **validates live** against `GET /api/workspace/preflight?path=` and shows whether it is a git repo, a non-git folder, or missing. Saving is **warn-but-allow** — a not-yet-existing path (about to be cloned) is flagged but never blocks the save.
- **Native folder picker.** A **Browse…** button calls the new `POST /api/pick-folder`, which the Electron launcher backs with `dialog.showOpenDialog` (injected as `pickFolder` into `startHttpServer`; the HTTP server runs in the launcher's process). Outside the desktop launcher the endpoint reports `unsupported` and the dashboard falls back to manual entry.
- **Friendlier preflight output:** the per-workspace preflight result renders a readable pass/fail summary instead of a raw JSON dump.

Bump root/electron/status-UI/lockfiles to 0.15.1.

## [0.15.0] — 2026-06-04

### Dashboard + Electron UI revamp (dark-only, unified design system)
- **Web dashboard** evolved on its existing Hallmark token system: deeper bluer surface ramp, a three-rung elevation scale, and new motion/gradient/glow tokens. Sidebar and topbar now carry depth (topbar blurs on scroll), the active nav item shows an accent-gradient fill with a glowing left bar, and route content fades up on mount. Metric cards lift on hover with a status-colored accent bar; live status-pill dots pulse and glow; a single `.primary` accent-gradient button (the live toggle) carries the main CTA while other buttons stay quiet.
- **Light theme removed.** The dashboard is now dark-only — the light token block, the `data-theme` apply path in `dashboard.js`, and the Settings color-theme toggle are all gone.
- **Electron launcher** (`status.html`) and **setup wizard** (`wizard.html`) rebuilt on the dashboard's exact palette and tokens: gradient brand badge, glowing status dot, gradient primary buttons, an SVG link icon (no emoji), and matching radius/spacing. Every element id/class the renderer JS drives is preserved, so `status.js`/`wizard.js` are unchanged.

## [0.14.10] — 2026-06-04

### Cleanup-by-path for untracked files + tool-group metadata fix (from a follow-up ChatGPT audit)
- `relai_restore_changes` could not clean an **untracked** disposable file by path: paths-mode ran only `git restore`, which knows tracked paths only, so an untracked file failed with a pathspec error (a recurring audit cleanup pain). Paths-mode now honors `clean: true` — it additionally runs `git clean -fd` scoped to the given paths and treats the restore pathspec-miss as non-fatal when clean handled it. So `clean: true` + `paths` reverts tracked edits **and** removes untracked files; without `clean` the tracked-only behavior is unchanged
- `relai_status` / `relai_feature_probe` tool grouping: the internal-only `relai_session_summary` was hard-listed in `toolGroups.audit`, so it appeared under both `audit` and `internal`. It is removed from the public `audit` group; internal tools now appear only under `toolGroups.internal`
- Regression tests added: git-workflow smoke covers `clean: true` removing an untracked file (and tracked restore still working); the ChatGPT compat smoke asserts `relai_session_summary` is absent from `toolGroups.audit` and present under `toolGroups.internal`

Bump root/electron/status-UI/lockfiles to 0.14.10.

## [0.14.9] — 2026-06-04

- **`relai_package_snapshot` shape regression:** the 0.14.7 bounding turned `copied.files` / `copied.skipped` into summary objects, which broke consumers (and the prepared-update test) that iterate them as arrays of `{ path }`. They are arrays again — capped to 50 entries with sibling `fileCount` / `skippedCount` and `*Truncated` flags carrying the true totals

Bump root/electron/status-UI/lockfiles to 0.14.9.

## [0.14.8] — 2026-06-04

- Even after the WeakSet + signature dedup (0.14.5 / earlier 0.14.7 work) stopped re-clicks across the 2s poll and React re-renders, the Activity log still showed paired tool calls (e.g. `relai_git_commit` twice). Remaining cause was inside a single `trustedClick`: it dispatched a full pointer/mouse sequence **including `pointerup`/`mouseup`** and then called `el.click()`. ChatGPT's approve button has an `onClick` (a bare `el.click()` has always activated it), but it also reacts to pointer-up — so one approval fired twice
- `trustedClick` now dispatches only the **press** half (`pointerdown`/`mousedown`) to prime framework focus/`:active` state, then the single `el.click()` is the one and only activation. The up-events that could independently trigger the handler are gone, so each approval submits exactly once. The cross-render dedups remain as a second line of defense

Bump root/electron/status-UI/lockfiles to 0.14.8.

## [0.14.7] — 2026-06-04

### `relai_apply_update` no-op reports `changedFiles:[]` (from a follow-up ChatGPT audit)
- A unified-diff patch that applied cleanly but changed nothing (e.g. a `-same/+same` hunk) still listed the file in `changedFiles`. Cause: `changedFiles` was set to every path the patch *touched* whenever `git apply` succeeded, with no content comparison. It now hashes each touched path before and after apply and reports only paths whose contents actually changed — so a semantic no-op returns `changedFiles:[]` while `touchedPaths` still lists what the patch referenced. (The structured OpenAI-patch path already compared old/new text; this aligns the unified-diff path with it.)

Bump root/electron/status-UI/lockfiles to 0.14.7.

## [0.14.6] — 2026-06-04

### `relai_status` reports the real connector version (from a follow-up ChatGPT audit)
- `relai_status` (and `relai_feature_probe`) returned `version: ""` and could report the wrong `scripts`/CI surface when the connector ran from the packaged launcher. Cause: `safeReadPackageJson()` read `process.cwd()/package.json`, but the launcher's working directory is not the server's own directory. It now reads the server's own `package.json` resolved from the module path (`__dirname/../package.json`), falling back to cwd. This also restores accurate stale-launcher detection during audits

Bump root/electron/status-UI/lockfiles to 0.14.6.

## [0.14.5] — 2026-06-04

### Fix three 0.14.4 regressions + a backup bug (from a follow-up ChatGPT audit on rel-ai-mcp)
- `relai_browser` `check`: spawning `npm.cmd` directly failed on Windows with `spawn EINVAL` (Node refuses to spawn `.cmd` without a shell since 18.20/20.12). The named script now runs as `npm run <name>` through a shell; the check name is still validated against `package.json` scripts (no metacharacters), so nothing arbitrary reaches the shell
- `relai_browser` HTTP/route mode no longer reports `ok:true` for an unreachable host. `ok` now requires an actual successful probe — `ok: exitCode===0 && probe present && probe.ok !== false` — and the response carries `reachable: true|false` explicitly
- `relai_package_snapshot`: the 0.14.4 bounded-summary only capped the `skipped` list; the `files` list was still dumped in full and truncated the response. Both lists are now bounded to `count` + first/last sample
- `relai_apply_update` / `relai_apply_bundle` prepared backup: `git stash push --include-untracked` *moved* changes away, deleting an untracked patch/overlay target before apply (a no-op patch on a newly-created file failed with "No such file or directory"). Backup now uses `git stash create` + `git stash store`, which records a recoverable stash entry **without disturbing the working tree**


Bump root/electron/status-UI/lockfiles to 0.14.5.

## [0.14.4] — 2026-06-04

### Fewer "blocked by OpenAI's safety checks" refusals on benign tools
- Root cause (from a ChatGPT session that hit it on `relai_browser`): OpenAI's connector tool-call safety classifier scores the advertised tool surface (name, title, description, arguments) and refuses calls **before dispatch** — the call never reaches the MCP server, so there is no Activity-log entry and no server error. This is ChatGPT-side platform behavior, not a server bug; the lever is reducing the capability signals the classifier keys on (the same approach that calmed the git tools in 0.14.0)
- `relai_browser`: retitled `Browser/UI Check` → `UI Route Check`; description no longer says "fetch a URL" or "run a local browser check such as Playwright" (it now describes loading a configured workspace route). The free-form `url` argument is stripped from the **public** connector schema (the strongest SSRF/arbitrary-fetch signal) — ChatGPT drives UI checks via the configured route/check; the server still honors `url` for internal/stdio callers
- `relai_browser` server-side is now a bounded validation bridge: the `check` argument runs **only declared `package.json` scripts** via `npm run <name>` (no arbitrary shell); an unknown check returns the available script list. HTTP/route mode returns a structured probe (status, final URL, byte count, title) instead of raw output
- `relai_run_checks` retitled `Run Workspace Checks` → `Workspace Checks` and reworded to drop the imperative/command-execution phrasing while keeping the "validation checks" contract
- `relai_status` now reports the public tool surface (`PUBLIC_HTTP_TOOL_NAMES`) rather than the full internal bridge list
- Small correctness fixes alongside: `relai_git_merge_remote_branches_plan` excludes a bare remote name (not a branch); `relai_remove_file` errors are reworded from `relai_clear_files`; `relai_package_snapshot` returns a bounded skipped-file summary instead of the full list
- `relai_apply_update` / `relai_apply_bundle`: "run checks afterward" → "validate afterward"; `relai_package_snapshot`: dropped "on the MCP host"
- `connector-wording` smoke test now scans **every** tool's title + description and fails on high-risk capability verbs (playwright, fetch, browser, execute, shell, terminal, arbitrary), so the standard is enforced across the whole surface going forward
- Note: this lowers block frequency; it cannot make the classifier deterministic — it also weighs conversation context and connector reputation, so intermittent refusals on benign calls can still occur

- Mutation observer dropped `class`/`data-testid` from its attribute filter (class churns on every hover/animation/streamed token); it now watches `aria-label`/`disabled` plus childList insertions
- Hot-path node inspection uses `textContent` instead of `innerText` to avoid forcing layout reflows during token streaming
- Per-tab injection-cooldown map is now pruned on tab close
Bump root/electron/status-UI/lockfiles to 0.14.4.

## [0.14.3] — 2026-05-30

### run_checks output is now inspectable (from follow-up ChatGPT audit)
- `relai_run_checks` output was abbreviated even with `fullOutput: true`. Cause: each command's full log was returned, then the whole result hit the server result-size cap (`MAX_TOOL_RESULT_CHARS`) and was head-truncated — cutting the failing tail. `fullOutput` (which raised the per-command buffer to 16 MB) made it worse
- `run_checks` now returns a bounded **tail** of each command's stdout/stderr (where failures and summaries live): ~4 KB per stream by default, ~40 KB with `fullOutput: true`, with a marker noting how much was dropped. The result stays under the server cap so the useful end survives
- Added a regression test asserting the tail keeps the end of output and that `fullOutput` keeps a larger tail

Note: `relai_clear_files` responses appearing "abbreviated" in ChatGPT are the ChatGPT UI folding small JSON payloads, not server-side truncation — the full data is present in the tool result.

## [0.14.2] — 2026-05-30

### Staged-write fallback safety + merge dry-run fix (from follow-up ChatGPT audit)
- **Critical:** the 0.14.1 staged-write fallback picked the most-recent staged payload by mtime, which could commit the wrong/stale file — including resurrecting an abandoned staged write to an unrelated tracked file during what should have been a cleanup call. The fallback now never guesses: it resolves an exact `writeId`, else the unique staged write for a supplied `path`, else the single in-flight staged write; when several are pending it refuses and lists the candidates (`writeId → path`) so the caller picks one
- Staged payloads are now age-bounded: fallback ignores payloads older than 6h, and payloads older than 24h are pruned on access, so stale orphans cannot be resurrected
- `relai_write` append/commit accept `path` to disambiguate which staged write to resolve
- Fixed `relai_git_merge_branch` dry-run returning `ok: false` on an already-up-to-date merge: it now only runs `git merge --abort` when a merge actually started (MERGE_HEAD present)
- Added regression tests for multi-pending refusal, path disambiguation, and already-up-to-date merge dry-run

## [0.14.1] — 2026-05-30

### Staged-write reliability fix (from full ChatGPT usability audit)
- Fixed `relai_write` staged commit failing with `No staged relai_write payload found for writeId...` when ChatGPT dropped or mistyped the opaque `writeId` between the separate `start`/`append`/`commit` tool calls. Append and commit now fall back to the most recent staged write for the workspace when `writeId` is missing or unknown, so the model no longer has to round-trip the id perfectly
- Clarified `relai_write` description: direct write has no size cap and is preferred; staged mode is only for transports that cap a single message
- Improved the not-found error to point back to direct write
- Fixed a stale, Windows-only assertion in the tunnel-manager smoke test (custom command plans split argv on win32) and wired the new staged-write fallback test into `test:all`

## [0.14.0] — 2026-05-30

### Connector moderation friction fixes (from full ChatGPT usability audit)
- Public workspace tools now advertise `readOnlyHint: true` / `destructiveHint: false` so the ChatGPT connector classifier does not flag ordinary repo work (status, diff, reads) as risky operations; the real safety boundary stays server-side in `safety.js` / hard-boundary checks
- Neutralized trigger-word tool titles that primed the classifier: git tools (`Git Status` → `Repository State`, `Git Push` → `Publish Branch`, etc.) and destructive tools (`Clear Local Repo Files` → `Discard Workspace Files`, `Remove File` → `Retire Obsolete File`, `Restore Workspace Changes` → `Revert To Saved State`)
- Read-only tools now state "Read-only" up front in their descriptions
- Removed free-form command-string inputs (`check` / `checks` / `checksText`) from the public connector schema for `relai_run_checks`, `relai_apply_update`, and `relai_apply_bundle` so ChatGPT never sees a command-execution surface; the server still honors these fields for internal/stdio callers
- `relai_apply_update` / `relai_apply_bundle` now expose `requireCleanGit` on the public schema, and the workflow default flips to `requireCleanGit: false` so prepared updates apply on the always-dirty real repos ChatGPT operates on (a backup stash is still taken)

## [0.13.1] — 2026-05-27

### Workflow friction fixes (from black-box audit)
- Public HTTP and compatibility surfaces now consistently expose the 24-tool public workspace surface, while newer local stdio sessions expose the 27-tool trusted surface when the config generation supports it
- Added first-class git workflow tools for status, fetch, commit, push, merge planning, merge abort, and PR drafting
- Added semantic residue scanning via `relai_refactor_audit` and explicit single-file cleanup via `relai_remove_file`
- README and connector docs now describe the current public-vs-internal tool split accurately
- `relai_apply_update` now accepts OpenAI patch format (`*** Begin Patch / *** Update File / *** End Patch`) in addition to git unified diff; converted patches report `sourceFormat: "openai-patch"` and `converted: true`
- `relai_replace` / `relai_edit` errors gain actionable fallback guidance: 0-match → re-read hint, duplicate matches → occurrence hint, URL/IPv6 client-transport errors → workaround list, byte-limit overflow → staged-write hint
- `relai_apply_update` patch-format errors now show both accepted format examples (unified diff + OpenAI patch)
- `relai_clear_files` safety-block errors clarify the accepted call shapes (`path` and `paths` both work)
- `relai_set_policy` captures `git status --short` baseline on session start; `policyResolver.baselineDirty` persists pre-existing dirty files
- `relai_diff` splits worktree status into `sessionChangedFiles` vs. `baselineChangedFiles` so ownership of pre-existing dirty files is unambiguous
- `relai_run_checks` accepts `fullOutput: true` to lift the per-command output truncation for long error logs
- `relai_diff` `path` arg now echoed back in the result for clarity

### Tests
- `test/openai-patch-format-unit.mjs` — Update/Add/Delete File conversion, multi-file blocks, pass-through behavior
- `test/baseline-tracking-unit.mjs` — git status baseline capture, session persistence, status ownership split, rename handling
- `test/error-enhancer-unit.mjs` — fallback hints for replace/edit/apply_update/clear_files error patterns

## [0.13.0] — 2026-05-27

### Trusted Workspace Agent Mode
- New trusted local-agent policy model (`policyResolver`) with session metadata file (workspace + createdAt + taskHint)
- `relai_set_policy` tool to activate/clear session policy; `relai_session_summary` to review files touched, checks run, planner decisions
- Execution planner (`relai_edit`) auto-selects between localized replace, full-file write, staged write, and prepared multi-file update
- Canonical command alias normalization for validation checks (`commandNormalizer`)
- Risk-based validation strategy: `minimal` / `focused` / `broad` / `extended` selected from change surface
- Session cache (LRU + mtime invalidation) and trusted budget multiplier for context loading
- Caution-zone classifier (mass clear, bundle apply, multi-file update, workspace config writes) surfaced in workspace badge, home metric, diagnostics card
- Hard boundaries reinforced: secret-bearing paths, traversal, absolute paths, history-rewriting ops blocked
- Audit payload enriched with plannerPath, plannerReason, validationLevel/Reason, aliasNormalizations, policySessionActive, cautionLevel/Reason
- Dashboard: workspace card shows session policy badge + taskHint; diagnostics page adds alias consistency + caution summary cards
- `GET /api/alias-diagnostics` and `GET /api/caution-summary` endpoints

## [0.11.35] — 2026-05-25

### Changes
- Normalized workflow config to `standard`/`prepared` terminology (replaces `conservative`/`aggressive`)
- Prepared workspace update and bundle tools now always available without mode gating
- Softened `relai_run_checks` connector-facing wording to describe validation checks
- HTTP auth hardening: comprehensive auth test coverage added
- Windows archive command construction fixed and tested
- Safety test expansion: secret paths, traversal, symlinks, archive overlay
- Electron smoke test fixed for Windows ESM import
- Stale tool names now return helpful errors naming the replacement tool
- Dashboard wording aligned with prepared workspace terminology
- Docs and README updated to match current terminology

### Migration
- Old config `workflow.mode: "aggressive"` → automatically migrated to `"prepared"`
- Old config `flow.mode: "fast"` → automatically migrated to `"prepared"`
- Old tool names (relai_verify, relai_reset, relai_delete, relai_apply_patch, relai_apply_archive, relai_snapshot_archive) → return helpful stale-tool errors with new name
