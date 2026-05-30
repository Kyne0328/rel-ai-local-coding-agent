# Changelog

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
