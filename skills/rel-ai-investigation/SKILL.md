---
name: rel-ai-investigation
description: Use for read-only repository questions that need evidence, including architecture audits, feasibility studies, dependency or caller tracing, impact analysis, implementation-status checks, and proof of how something works. Do not use to implement fixes or for final completion or release verification of changes already made.
---

# Rel.AI Investigation

Reuse the active `work_id` opened by `rel-ai-workflow`. Do not call `relai_work` with `action: "begin"` when the same objective already has a work session.
Use runtime workflow guidance after every Rel.AI call to decide whether another search, read, measurement, or broader boundary is actually useful. `workflow.recommendedActions` is the default calibration; current evidence and the investigation question determine when proof is sufficient.

1. State the question and define what would count as sufficient proof before gathering more context.
2. Escalate evidence in this order: `bootstrap -> search/inspect -> targeted reads -> bounded measurement -> broader reads only if required`.
3. Prefer symbol, reference, caller, search, runtime, or package evidence over broad file dumps. Reuse evidence that is still current.
4. Read only the files and ranges needed to verify the claim. Use bounded one-shot commands for reproducible measurements; never start a managed process for an audit command.
5. Stop when the required proof exists. More available context is not a reason to continue investigating.
6. Classify conclusions as observed, verified, inferred, or unresolved. Tie inferences to the evidence that supports them.
7. This skill does not edit. If implementation is also requested, hand the verified findings to `rel-ai-workflow` or `rel-ai-debugging` instead of restarting the investigation.
