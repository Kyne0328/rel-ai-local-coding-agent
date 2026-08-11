---
name: rel-ai-verification
description: Use when repository work needs final verification, release readiness proof, a completion audit, or confirmation that a fix truly works.
---

# Rel.AI Verification

Reuse the active `work_id` opened by `rel-ai-workflow`. Do not call `relai_work` with `action: "begin"` when the same objective already has a work session.

Tests are risk controls, not a requirement to test every function, branch, query, component, or file.
Use runtime workflow guidance to calibrate verification scope. Reuse exact fresh passed evidence when the command, package cwd, and repository fingerprint still match; do not rerun a check merely because it ran earlier. `workflow.recommendedActions` may widen verification when the changed boundary or risk requires it, while task-integrity freshness remains authoritative.

1. Identify the concrete claims that must be proven before completion.
2. Run the narrowest existing checks that directly prove those claims.
3. Before adding a test, inspect existing coverage and name the meaningful regression or contract at risk. Prefer to extend, consolidate, or replace existing coverage instead of adding overlap.
4. Add a new test only when it protects a distinct meaningful concern such as business behavior, validation, security boundaries, transactions/concurrency, data integrity, external protocol compatibility, packaging/runtime contracts, platform behavior, or a meaningful UI regression.
5. Scale verification by changed boundary: `local UI -> state/runtime -> protocol/API -> packaging/platform/release`. Do not jump to release-scale checks for a local change unless the repository's actual gate requires it.
6. Inspect failures and incomplete checks; do not downgrade them to warnings without evidence. Broaden verification only when the touched boundary creates additional risk.
7. Review the task-owned diff and relevant repository status. Record what ran, what passed, what was intentionally not run, and any unresolved risk.
8. Return completion evidence to `rel-ai-workflow`. Do not complete or cancel the work session independently; `rel-ai-workflow` owns final session completion.
