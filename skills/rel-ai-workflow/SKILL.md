---
name: rel-ai-workflow
description: Use when a request requires repository access or local execution through Rel.AI.
---

# Rel.AI Workflow

This is the routing skill and the only work-session owner for a repository objective. Open one `work_id` and keep using it until that objective is completed or explicitly cancelled. Specialized Rel.AI skills reuse the same work session.

## Runtime-calibrated workflow

Call `relai_work` with `action: "begin"` exactly once. After each successful work-scoped call, treat `workflow.recommendedActions` as the runtime-calibrated default for what is useful next and `workflow.avoidActions` as a guard against redundant or over-broad work. Hard runtime errors, authorization, containment, task integrity, and completion gates remain authoritative.

Do not mechanically execute every possible stage. Choose the shortest sufficient path that proves the user's objective:

- Documentation: `begin -> targeted read -> edit -> task-owned review if useful -> finish`.
- Bugfix: `begin -> reproduce/inspect -> coherent fix -> directly affected check -> task-owned review -> finish`.
- Feature: `begin -> inspect/design only as needed -> implement coherent slice -> risk-matched checks -> review -> finish`.
- Investigation: `begin -> search/inspect -> targeted evidence -> report/finish`; do not edit unless implementation is requested.
- Release: `begin -> inspect release boundary -> focused regression proof -> release-required checks/build/package gates -> review -> finish`.

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

Rel.AI exposes the complete 13-tool capability surface. Use the `relai://server/tool-surface` resource when exact action fields, execution classes, or native Task eligibility are needed; do not copy full schemas into skill instructions.

## Approved plan execution

When the user has approved a multi-task plan, continue through ordinary task boundaries without asking for status confirmation. Update plan checkboxes only as completion conditions are actually satisfied. After each task, consolidate accumulated implementation where that reduces duplication or unnecessary layers.

Stop mid-plan only for a genuine blocker, a material design change that invalidates the plan, a decision requiring user input, or an external/manual-only step the agent cannot perform.

## Definition of done

Runtime policy remains authoritative. Done means the requested behavior is implemented, required risk-based evidence is current, material task-owned changes are understood, and the shared work session is explicitly completed or cancelled. Runtime workflow guidance calibrates the route; it never overrides hard safety or completion authority.

Load [references/workflows.md](references/workflows.md) for uncommon worktree, publishing, recovery, migration, process, and plan-execution details.