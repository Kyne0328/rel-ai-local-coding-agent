---
name: rel-ai-workflow
description: Use when work must inspect, read, edit, test, build, debug, validate, review, or publish a configured repository through Rel.AI, including local UI or process execution. Do not use when the request needs no repository or local runtime access.
---

# Rel.AI Workflow

This is the routing skill for repository work. A durable `work_id` is optional: open one when ownership, recovery, task-scoped review/publication, or durable history is useful. Otherwise use supported tools directly against the authorized workspace or resource. Specialized Rel.AI skills reuse an existing work session when one is already active; they do not create one merely to satisfy a tool call.

## Evidence-driven workflow

Rel.AI supplies repository facts, execution results, optional durable task evidence, and hard runtime constraints; the agent chooses the next action and appropriate validation. Authorization, containment, resource ownership, stale-write/collision protection, sensitive-path controls, and defined destructive approvals remain authoritative. Validation and durable task state are evidence and coordination features, not generic permission gates.

Do not mechanically execute every possible stage. Choose the shortest sufficient path that proves the user's objective:

- Documentation: `targeted read -> edit -> review if useful`; add a durable work session only when its ownership/recovery benefits matter.
- Bugfix: `reproduce/inspect -> coherent fix -> directly affected check -> review`.
- Feature: `inspect/design only as needed -> implement coherent slice -> risk-matched checks -> review`.
- Investigation: `search/inspect -> targeted evidence -> report`; do not edit unless implementation is requested.
- Release: `inspect release boundary -> focused regression proof -> release-required checks/build/package gates -> review/publish`; a durable work session is useful when publication must be task-scoped.

If fresh evidence already proves a recommendation, use the next distinct recommendation instead of repeating the same read, check, review, or process start.

## Route only when needed

- Simple localized change with a clear implementation path: stay in this workflow.
- Non-trivial feature, refactor, migration, or dependent multi-stage work: use `rel-ai-planning`.
- Architecture audit, feasibility study, dependency tracing, or evidence question: use `rel-ai-investigation`.
- Reproducible error, crash, broken test, regression, or contract failure: use `rel-ai-debugging`.
- Persistent service, watcher, preview runtime, or interactive CLI: use `rel-ai-dev-process`.
- Completion proof, release readiness, or explicit final verification: use `rel-ai-verification`.

Specialists return conclusions to this workflow instead of reopening the objective or repeating evidence that is still sufficient and current. Invoking every specialist for every objective is an anti-pattern.

## Tool shape

Use `relai_edit` for repository changes. Tests, builds, linters, source checks, and release gates are one-shot commands; run them with `relai_exec` or `relai_validate` as appropriate. Use `relai_process` only for persistent services, watchers, previews, or interactive programs. For browser-rendered UI work, keep the local app running with `relai_process`, then use `relai_ui` to inspect, interact, capture visual evidence, check console/network failures, and stop the UI session when verification is complete. Prefer semantic UI targets over brittle selectors when both are available. Use `relai_changes` for task-owned review and widen to workspace scope only when the objective requires it.

Rel.AI exposes its current public capability surface through the server. Use the `relai://server/tool-surface` resource when exact action fields, execution classes, or native Task eligibility are needed; do not copy full schemas or hard-coded tool counts into skill instructions.

## Approved plan execution

When the user has approved a multi-task plan, continue through ordinary task boundaries without asking for status confirmation. Update plan checkboxes only as completion conditions are actually satisfied. After each task, consolidate accumulated implementation where that reduces duplication or unnecessary layers.

Stop mid-plan only for a genuine blocker, a material design change that invalidates the plan, a decision requiring user input, or an external/manual-only step the agent cannot perform.

## Definition of done

The agent decides when the requested behavior is complete from current evidence. Rel.AI reports what was changed, what validation passed/failed/is stale/not run, and any real hard-boundary violations. If a durable work session was opened, close or cancel that session when appropriate; its lifecycle must not force validation that the objective does not require.

Load [references/workflows.md](references/workflows.md) for uncommon publishing, recovery, migration, process, and plan-execution details.
Load [references/safety.md](references/safety.md) before restore/reset, commit/push, sensitive authorization, or any other destructive or approval-gated operation.