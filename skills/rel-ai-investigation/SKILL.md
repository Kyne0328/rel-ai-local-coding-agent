---
name: rel-ai-investigation
description: Investigate or audit a configured repository using evidence from bounded reads, searches, symbols, references, runtime metadata, tests, and package artifacts. Trigger for architecture audits, feasibility studies, dependency tracing, or questions that require proving how the repository works. Do not trigger for unrelated research or direct implementation without investigation.
---

# Rel.AI Investigation

Reuse the active `work_id` opened by `rel-ai-workflow`. Do not call `relai_work` with `action: "begin"` when the same objective already has a work session.

1. State the question and required proof.
2. Use the bootstrap before additional reads.
3. Prefer `relai_search` and `relai_inspect` before broad file reads.
4. Read only the files and ranges needed to verify each claim.
5. Use bounded one-shot commands for reproducible measurements. Never use a managed process for an audit command.
6. Separate observed, verified, inferred, and unresolved conclusions.
7. Do not edit unless the user separately requested implementation.
8. Finish the shared work session only after the requested report or evidence is complete.
