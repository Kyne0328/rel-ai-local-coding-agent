---
name: rel-ai-verification
description: Verify that repository work is complete and release-ready using executed checks, contract evidence, package or runtime smoke tests, and final change review. Trigger for final verification, release readiness, completion audits, or requests to confirm that a fix truly works. Do not trigger for early planning or unimplemented proposals.
---

# Rel.AI Verification

Reuse the active `work_id` opened by `rel-ai-workflow`. Do not call `relai_work` with `action: "begin"` when the same objective already has a work session.

1. Identify the claims that must be proven.
2. Run the narrowest checks that directly prove each claim.
3. Add integration, package, platform, or release checks when the changed boundary requires them.
4. Inspect failures and incomplete checks; do not convert them into warnings without evidence.
5. Review the final diff and repository status.
6. Record what ran, what passed, what was not run, and any remaining risk.
7. Complete the shared work session only when its integrity and validation requirements are satisfied.
