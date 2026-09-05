---
name: rel-ai-debugging
description: Use when repository behavior is reproducibly wrong and needs causal diagnosis or repair, including errors, broken tests, crashes, regressions, failed contracts, or incorrect runtime behavior. Do not use for general audits or final verification when no active defect is being diagnosed.
---

# Rel.AI Debugging

Reuse an active `work_id` when the objective already has a durable work session. Otherwise debug directly at workspace/resource scope; do not create a work session merely to unlock tools.
Choose the next repository action from the observed failure, current repository evidence, and hard runtime constraints. Rel.AI supplies facts and enforcement; the agent retains debugging judgment and should stop when the demonstrated root cause is fixed and verified.

Use this causal sequence: `observable failure -> smallest reproduction -> causal path -> root cause -> coherent fix -> targeted regression -> broader checks only when the changed boundary requires them`.

1. Capture the exact failing behavior with the smallest bounded reproduction that still demonstrates the defect.
2. Trace callers, state transitions, ownership, data flow, and relevant tests until the causal path is plausible and evidence-backed.
3. Separate the root cause from downstream symptoms. If several symptoms share one state, lifecycle, ownership, or architectural flaw, prefer one shared root-cause fix over independent patches.
4. Make no speculative edits before the causal path is understood well enough to explain why the proposed change should fix the failure.
5. Apply the smallest coherent fix through `relai_edit`. Do not bundle unrelated cleanup into the repair.
6. Run the targeted regression first. Add broader checks only when the changed boundary creates additional meaningful risk.
7. Never claim an executable defect is fixed from static inspection alone when bounded executable proof is available.
8. Hand the reproduced failure, root cause, changed behavior, targeted regression, and touched boundaries to `rel-ai-verification` or back to `rel-ai-workflow`.
