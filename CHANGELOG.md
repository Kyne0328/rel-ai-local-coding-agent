# Changelog

## [0.13.1] — 2026-05-27

### Workflow friction fixes (from black-box audit)
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
