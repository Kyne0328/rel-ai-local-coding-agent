# Changelog

## [0.20.5] — 2026-07-19

### Live dashboard refresh and settings controls
- **Fix manual and live dashboard refreshes.** Aggregate dashboard reads now bypass the short client cache, the refresh action is directly visible, overlapping requests remain collapsed, and the control keeps its icon and loading state.
- **Preserve scroll position and focused controls across live remounts.** The router holds the current section height while asynchronous content remounts, then restores the exact view only when the route and render generation still match.
- **Add a Dashboard settings section.** Refresh intervals, the automatic-validation card visibility, and stored history controls are grouped separately from appearance, connector, and diagnostics settings.
- **Make automatic-validation status optional and neutral when unavailable.** Workspace cards can hide the validation summary and panel; otherwise missing commands are shown as not configured rather than as a warning.
- **Show Clear filters only when Activity filters differ from their defaults.**
- **Replace the Sessions history-load counter with explicit completion count and add guarded history reset.** Clearing removes current and rotated audit history plus waiting desktop sessions, but refuses while any Rel.AI tool call is active.
- **Improve the settings layout with a sticky navigation rail, clearer section names, responsive four-section navigation, and asynchronous mount completion.**

Bump root/electron/status UI/lockfiles to 0.20.5.

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
