---
name: rel-ai-verification
description: Use after repository changes, fixes, or release work when the task needs proof of completion, including targeted regression checks, final verification, release readiness, completion audits, or confirmation that implemented behavior works. Do not use for open-ended architecture or feasibility investigation before implementation.
---

# Rel.AI Verification

Reuse an active `work_id` when verification belongs to an existing durable work session. Otherwise run verification directly against the authorized workspace; validation does not require a synthetic task.

Tests are risk controls, not a requirement to test every function, branch, query, component, or file.
Calibrate verification scope from the changed boundary and concrete risks. Reuse exact fresh passed evidence when the command, package cwd, and repository fingerprint still match; do not rerun a check merely because it ran earlier. Rel.AI's freshness state is authoritative as a factual statement about what a prior result still proves, not as a generic completion permission.

1. Identify the concrete claims that must be proven before completion.
2. Run the narrowest existing checks that directly prove those claims.
3. Before adding a test, inspect existing coverage and name the meaningful regression or contract at risk. Prefer to extend, consolidate, or replace existing coverage instead of adding overlap.
4. Add a new test only when it protects a distinct meaningful concern such as business behavior, validation, security boundaries, transactions/concurrency, data integrity, external protocol compatibility, packaging/runtime contracts, platform behavior, or a meaningful UI regression.
5. Scale verification by changed boundary: `local UI -> state/runtime -> protocol/API -> packaging/platform/release`. Do not jump to release-scale checks for a local change unless the repository's actual gate requires it.
6. Inspect failures and incomplete checks; do not downgrade them to warnings without evidence. Broaden verification only when the touched boundary creates additional risk.
7. Review the task-owned diff and relevant repository status. Record what ran, what passed, what was intentionally not run, and any unresolved risk.
8. Return the evidence and any remaining risk to the calling workflow. If a durable work session exists, its owner may close it; verification itself does not require or own a session.
