---
name: rel-ai-debugging
description: Diagnose and fix a reproducible defect in a configured repository by capturing the failure, isolating the responsible path, applying the smallest correct change, and proving the regression is resolved. Trigger for errors, broken tests, crashes, regressions, or behavior that differs from its contract. Do not trigger for feature brainstorming or unrelated code review.
---

# Rel.AI Debugging

Reuse the active `work_id` opened by `rel-ai-workflow`. Do not call `relai_work` with `action: "begin"` when the same objective already has a work session.

1. Capture the exact failing behavior with the smallest bounded reproduction.
2. Trace the failure through searches, symbols, callers, state transitions, and tests.
3. Distinguish root cause from downstream symptoms.
4. Apply the smallest coherent fix through `relai_edit`.
5. Run the targeted regression first, then the relevant broader checks.
6. Review the diff for accidental behavior changes.
7. Never claim success from static inspection alone when the failure is executable.
8. Hand completion evidence to `rel-ai-verification` or finish through the core workflow.
