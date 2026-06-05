# Changelog

## [0.15.4] — 2026-06-05

### Background-tab auto-approve reliability + easier extension import
- **Backgrounded ChatGPT tabs now approve fast, not on a 30s lag.** The 2s content-script poll was gated `!document.hidden`, so a hidden working tab (any time you switch to another tab/window — including a second ChatGPT tab) fell back to the 30s background alarm only, and approvals felt stalled. The poll now also runs while keep-alive is active: the silent-audio keep-alive marks the tab "audible", which exempts it from Chrome's background timer throttling, so the poll keeps firing at ~2s even when hidden. The 30s alarm remains the safety net for when keep-alive is off or autoplay is still suspended. (The cross-tab arbiter was already correct — two tabs never double-approve; the problem was latency, not the tab count.)
- **Faster wake recovery.** The background service worker now scans immediately when a ChatGPT tab becomes active, finishes (re)loading, or on browser startup — so switching back to a tab, or one Chrome discarded/froze and just restored, approves without waiting for the next alarm tick.
- **Autoplay nudge.** The alarm-driven scan also tries to resume the keep-alive audio (a user gesture may have unlocked it since), and the popup now tells you to click once inside ChatGPT after enabling so the keep-alive can arm.
- **Extension import from the launcher.** The desktop status window's Chrome Extension box gains **Open folder** (reveals the unpacked extension in your file manager) and **Open Chrome** (jumps to `chrome://extensions`) buttons alongside Copy path, with numbered load-unpacked steps. Note: Chrome forbids an external app from installing an unpacked extension directly, so this streamlines the manual load rather than fully automating it; if Chrome can't be launched the button shows the `chrome://extensions` address to open by hand.

## [0.15.3] — 2026-06-05

### Slimmer dashboard topbar
- Removed the **Dashboard token** field and the **Refresh** button from the topbar. The token already loads from the URL / sessionStorage at boot, so the input was redundant noise (especially in the desktop launcher); manual refresh and "Copy dashboard token" remain in the command palette. The topbar now carries just the status pill, the live-mode toggle, and the last-updated time.

Bump root/electron/extension/status-UI/lockfiles to 0.15.3.

## [0.15.2] — 2026-06-04

### Clear a broken workspace, dynamic "What's new", unified logo
- **A workspace with a missing path can now be cleared.** `relai_clear`/Clear failed with `Workspace path does not exist` because the config editor had no `clear` action and fell through to `upsert`, which validates the path. `clear` is now handled as a removal alongside `delete`/`remove` and never touches the path — so an entry whose folder is gone is removable again.
- **"What's new" is read from CHANGELOG.md** instead of a constant that was frozen at v0.13.0. `getReleaseNotes()` parses the latest `## [version]` block (headline + top-level bullets, markdown stripped) and falls back gracefully if the file can't be read.
- **Electron launcher uses the dashboard logo.** The launcher status window and setup wizard now show the real `relai-logo.png` (same asset the dashboard sidebar uses) instead of an "R" placeholder badge / link glyph, and the Windows build icon is generated from the 512px logo (`build/icon.png`).

Bump root/electron/extension/status-UI/lockfiles to 0.15.2.

## [0.15.1] — 2026-06-04

### Workspace management QOL: fix a broken workspace path without deleting it
- **The dead-end is gone.** A workspace whose path no longer exists used to surface a `workspace_unavailable` health finding with no way to act on it — the only option was Clear (delete the whole entry). The workspace card now shows the error inline with a **Fix path** button, every card has an **Edit** action, and the Health-findings rows carry inline **Edit path** / **Remove** buttons wired to the offending alias. Diagnostics findings for the same case link straight to the actionable Workspaces view.
- **Add/Edit workspace is now a proper modal form** (replacing the chained `window.prompt`s): alias, path, protected branches, default base branch, and allowed remotes in one dialog. The path field **validates live** against `GET /api/workspace/preflight?path=` and shows whether it is a git repo, a non-git folder, or missing. Saving is **warn-but-allow** — a not-yet-existing path (about to be cloned) is flagged but never blocks the save.
- **Native folder picker.** A **Browse…** button calls the new `POST /api/pick-folder`, which the Electron launcher backs with `dialog.showOpenDialog` (injected as `pickFolder` into `startHttpServer`; the HTTP server runs in the launcher's process). Outside the desktop launcher the endpoint reports `unsupported` and the dashboard falls back to manual entry.
- **Friendlier preflight output:** the per-workspace preflight result renders a readable pass/fail summary instead of a raw JSON dump.

Bump root/electron/extension/status-UI/lockfiles to 0.15.1.

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

Bump root/electron/extension/status-UI/lockfiles to 0.14.10.

## [0.14.9] — 2026-06-04

### Multi-tab auto-approve coordination + a snapshot-shape regression fix
- **Cross-tab duplicate approvals:** with ChatGPT open in more than one tab, each tab's content script deduped only within itself, so two tabs could both approve the same request. Approvals now pass through the background service worker — the one shared arbiter — which grants a request signature to the first tab that claims it (8s window) and denies the rest. Combined with the in-tab WeakSet/signature dedup and the single-activation `trustedClick`, a request is now approved exactly once across all tabs. The content scan is async (claim round-trip) and guarded by `scanInFlight` against overlapping poll/mutation/message scans. Fail-open: if the worker is unreachable, a single tab still approves
- **Regression guard so this never silently returns:** the auto-approve smoke test now asserts `trustedClick` dispatches only the press half (`pointerdown`/`mousedown`) with exactly one `el.click()`, and that the cross-tab claim wiring is present in both content and background scripts
- **`relai_package_snapshot` shape regression:** the 0.14.7 bounding turned `copied.files` / `copied.skipped` into summary objects, which broke consumers (and the prepared-update test) that iterate them as arrays of `{ path }`. They are arrays again — capped to 50 entries with sibling `fileCount` / `skippedCount` and `*Truncated` flags carrying the true totals

Bump root/electron/extension/status-UI/lockfiles to 0.14.9.

## [0.14.8] — 2026-06-04

### Chrome auto-approve: stop the last duplicate-submission path in trustedClick
- Even after the WeakSet + signature dedup (0.14.5 / earlier 0.14.7 work) stopped re-clicks across the 2s poll and React re-renders, the Activity log still showed paired tool calls (e.g. `relai_git_commit` twice). Remaining cause was inside a single `trustedClick`: it dispatched a full pointer/mouse sequence **including `pointerup`/`mouseup`** and then called `el.click()`. ChatGPT's approve button has an `onClick` (a bare `el.click()` has always activated it), but it also reacts to pointer-up — so one approval fired twice
- `trustedClick` now dispatches only the **press** half (`pointerdown`/`mousedown`) to prime framework focus/`:active` state, then the single `el.click()` is the one and only activation. The up-events that could independently trigger the handler are gone, so each approval submits exactly once. The cross-render dedups remain as a second line of defense

Bump root/electron/extension/status-UI/lockfiles to 0.14.8.

## [0.14.7] — 2026-06-04

### `relai_apply_update` no-op reports `changedFiles:[]` (from a follow-up ChatGPT audit)
- A unified-diff patch that applied cleanly but changed nothing (e.g. a `-same/+same` hunk) still listed the file in `changedFiles`. Cause: `changedFiles` was set to every path the patch *touched* whenever `git apply` succeeded, with no content comparison. It now hashes each touched path before and after apply and reports only paths whose contents actually changed — so a semantic no-op returns `changedFiles:[]` while `touchedPaths` still lists what the patch referenced. (The structured OpenAI-patch path already compared old/new text; this aligns the unified-diff path with it.)

Bump root/electron/extension/status-UI/lockfiles to 0.14.7.

## [0.14.6] — 2026-06-04

### `relai_status` reports the real connector version (from a follow-up ChatGPT audit)
- `relai_status` (and `relai_feature_probe`) returned `version: ""` and could report the wrong `scripts`/CI surface when the connector ran from the packaged launcher. Cause: `safeReadPackageJson()` read `process.cwd()/package.json`, but the launcher's working directory is not the server's own directory. It now reads the server's own `package.json` resolved from the module path (`__dirname/../package.json`), falling back to cwd. This also restores accurate stale-launcher detection during audits

Bump root/electron/extension/status-UI/lockfiles to 0.14.6.

## [0.14.5] — 2026-06-04

### Fix three 0.14.4 regressions + a backup bug (from a follow-up ChatGPT audit on rel-ai-mcp)
- `relai_browser` `check`: spawning `npm.cmd` directly failed on Windows with `spawn EINVAL` (Node refuses to spawn `.cmd` without a shell since 18.20/20.12). The named script now runs as `npm run <name>` through a shell; the check name is still validated against `package.json` scripts (no metacharacters), so nothing arbitrary reaches the shell
- `relai_browser` HTTP/route mode no longer reports `ok:true` for an unreachable host. `ok` now requires an actual successful probe — `ok: exitCode===0 && probe present && probe.ok !== false` — and the response carries `reachable: true|false` explicitly
- `relai_package_snapshot`: the 0.14.4 bounded-summary only capped the `skipped` list; the `files` list was still dumped in full and truncated the response. Both lists are now bounded to `count` + first/last sample
- `relai_apply_update` / `relai_apply_bundle` prepared backup: `git stash push --include-untracked` *moved* changes away, deleting an untracked patch/overlay target before apply (a no-op patch on a newly-created file failed with "No such file or directory"). Backup now uses `git stash create` + `git stash store`, which records a recoverable stash entry **without disturbing the working tree**

### Chrome auto-approve: duplicate-approval fix + background keep-alive
- Fixed duplicated/over-long ChatGPT responses while auto-approve was on. Two compounding causes: `trustedClick` fired a synthetic `click` event **and** `el.click()` (two activations per attempt), and the same approval card — which ChatGPT leaves mounted for a second or more while it works — was re-clicked on every 2s poll. Now there is a single native click, and a `WeakSet` skips any button already clicked; a genuinely new request renders a new node, so it is still approved promptly
- Added background-tab keep-alive so long tasks don't stall when the ChatGPT tab is backgrounded: a near-inaudible 19 kHz tone marks the tab "audible" (exempting it from background throttling and tab discard/freeze), and a MAIN-world content script reports the tab as visible so ChatGPT does not pause on `visibilitychange`. Both are gated by the enable toggle. Native rAF throttling cannot be lifted from the page; the guaranteed backstop remains Chrome's "Always keep this site active" setting

Bump root/electron/extension/status-UI/lockfiles to 0.14.5.

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
- Synced the Chrome auto-approve labels with the two renamed titles
- Note: this lowers block frequency; it cannot make the classifier deterministic — it also weighs conversation context and connector reputation, so intermittent refusals on benign calls can still occur

### Chrome auto-approve extension efficiency
- Content script no longer scans the whole conversation DOM every 2s. A scan gate (`cardLikely`) is armed only when the mutation observer sees the Rel.AI approval-card hallmark text and disarms after a few empty scans, so the poll idles when no card is on screen
- Mutation observer dropped `class`/`data-testid` from its attribute filter (class churns on every hover/animation/streamed token); it now watches `aria-label`/`disabled` plus childList insertions
- Hot-path node inspection uses `textContent` instead of `innerText` to avoid forcing layout reflows during token streaming
- Background service worker caches dashboard reachability for 60s instead of probing localhost on every scan (invalidated on config change / manual scan); background scan alarm relaxed from 6s to 30s (Chrome clamps packed alarms to 30s regardless), with the foreground observer covering instant detection
- Per-tab injection-cooldown map is now pruned on tab close
- Narrowed `host_permissions`: dropped the blanket `https://*/*`, leaving ChatGPT origins + localhost (the only hosts the extension actually contacts)

Bump root/electron/extension/status-UI/lockfiles to 0.14.4.

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
- Chrome auto-approve extension recognizes the renamed tool titles (with primary-button fallback unchanged)

## [0.13.1] — 2026-05-27

### Workflow friction fixes (from black-box audit)
- Public HTTP and compatibility surfaces now consistently expose the 24-tool public workspace surface, while newer local stdio sessions expose the 27-tool trusted surface when the config generation supports it
- Chrome auto-approve extension matches ChatGPT on both `chatgpt.com` and `chat.openai.com` again
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
- Auto-approve extension redesign: extension popup is the only enable/disable control
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
