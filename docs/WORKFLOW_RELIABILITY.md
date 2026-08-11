# Workflow reliability

Rel.AI exposes one 12-tool public surface and derives bounded workflow guidance from the repository facts it already owns. There is no mandatory numbered workflow. The correct path is the shortest path that proves the current objective without weakening safety, integrity, or completion authority.

## Runtime calibration

Start one logical repository objective with `relai_work` using `action:"begin"`, then reuse the returned `work_id`. Successful work-scoped results may include a bounded `workflow` snapshot. Treat `workflow.recommendedActions` as the default calibration for what is useful next and `workflow.avoidActions` as a warning against redundant or over-broad work.

Workflow guidance is advisory. Authorization, workspace containment, sensitive-file policy, stale-write checks, task-integrity generations, workspace conflicts, Git safety, and explicit completion remain authoritative. A recommendation never bypasses a hard runtime error.
### Hybrid authority table

| Concern | Authority | Workflow role |
| --- | --- | --- |
| Authorization, principal identity, workspace containment, sensitive-file policy | Existing runtime safety/authorization modules | Advisory only; cannot widen access or bypass a denial |
| Task-owned mutations, mutation generations, validation freshness, workspace conflicts, completion readiness | `src/taskIntegrity.js` and existing completion gates | Reads current facts and recommends the cheapest useful next action |
| Repository topology, package boundaries, check catalog | `src/workflow/topology.js` and `src/workflow/checkCatalog.js` | Derived discovery used to calibrate scope/cost; not a safety boundary |
| Safe evidence receipts and workflow snapshots | Existing durable task history | Observational/advisory persistence; never a second completion authority |
| Process ownership and lifecycle | Existing managed-process runtime | May reuse only an exact same-task process; cannot cross principal/workspace/task boundaries |
| Dashboard workflow stage/risk/next action | Sanitized projection only | Informational UI; raw receipts and recommendation args remain internal |

## Shortest-path examples

These are shapes, not required sequences. Skip any stage that current evidence already satisfies.

### Docs-only

`begin -> targeted read -> edit -> task-owned review if useful -> finish`

Documentation-only work normally does not justify package builds, repository-wide tests, Knip, security scans, or release checks unless repository policy or the changed documentation specifically requires them.

### Local bug fix

`begin -> reproduce or inspect -> coherent fix -> directly affected check -> task-owned review -> finish`

Prefer the smallest check that proves the defect is fixed. Broaden only when the affected boundary or risk justifies it.

### Feature slice

`begin -> inspect/design only as needed -> implement coherent slice -> package-relevant checks -> review -> finish`

Do not validate after every tiny edit. Validate at a meaningful implementation boundary and reuse exact fresh evidence when nothing relevant has changed.

### Investigation

`begin -> search/inspect -> targeted reads or measurements -> report -> finish`

Investigation does not imply mutation or validation. Read and inspection evidence can be sufficient when the objective is explanatory.

### Risky release

`begin -> inspect release boundary -> focused regression proof -> required release/build/package checks -> review -> finish`

Release-wide validation is reserved for release, repository, cross-package, migration, dependency, contract, or other genuinely high-risk boundaries. It is not the default conclusion of a local source edit.

## Nested packages and repository topology

Rel.AI discovers package manifests below the configured repository root even when the root itself has no manifest. Nested packages receive stable path-qualified identities such as `npm:front-end` and `npm:back-end`.

Structured validation units carry both a command and package-relative `cwd`. A frontend-only change therefore runs frontend checks from the frontend package directory instead of silently invoking backend checks from the repository root. Identical command names in different package directories remain distinct validation units.

Topology discovery is bounded by depth, manifest count, and excluded generated/sensitive directories. Manifest metadata is cached by a repository-topology fingerprint rather than rescanned without limit on every tool call.

## Boundary and risk

Validation breadth is derived from the changed boundary and risk, not from file count alone. Many files inside one package can still be package-local. Shared contracts, dependency manifests, security/configuration surfaces, release workflows, migrations, and cross-package changes can widen the boundary or raise risk.

The workflow model uses the shared boundary/risk classifier for advisory decisions. Existing task-integrity and safety owners remain the hard authorities.

## Evidence reuse and freshness

Rel.AI stores safe evidence receipts in the existing durable task-history record. Receipts contain identifiers, outcomes, generations, safe paths, timing/status metadata, and repository fingerprints; they do not persist raw stdout/stderr, environment values, headers, credentials, or full tool arguments.

A passed validation result is reusable only when all of these still match exactly:

- structured check identity or command identity;
- normalized command;
- package-relative `cwd`;
- current repository fingerprint.

A changed repository fingerprint makes prior validation evidence stale. Mutation generation also separates retry epochs: repeated failures are counted only within the same task mutation generation. A new mutation resets the repeated-failure strategy.

When an exact passed receipt is fresh, Rel.AI reuses the proof without re-executing the command or replaying its old output. Connector results report executed and reused units separately.

Read evidence may also record bounded file hashes and line ranges. Search/context gathering can avoid rereading the same proven range only while the file hash still matches; it never uses that optimization as an access boundary or hard search filter.

## Edits and validation cadence

Edit shape and validation cadence are separate decisions. Use `relai_edit` for repository mutations and choose exact replacement, content replacement, patch text, or a bounded multi-file batch according to the change shape.

`runChecks` remains explicit. Rel.AI may recommend validation after a behavior-changing edit, but it does not universally force validation after every edit. Documentation-only or otherwise low-risk changes can proceed directly to review or completion when hard repository policy permits it.

For changed source, prefer directly affected tests first, then the cheapest package-relevant lint/type/test/build evidence needed for the boundary. Migration commands are never auto-selected as validation checks.

## Review scope

Task-scoped review defaults to files authoritatively owned by the current `work_id`. Ambient dirty files remain visible as excluded workspace changes but are not mixed into the task diff. Use `scope:"workspace"` only when the objective intentionally requires workspace-wide review.

Sensitive-file review keeps the existing redaction rules. Workflow guidance does not weaken them.

## Persistent processes

Use `relai_process` only for persistent services, watchers, previews, or interactive programs. One-shot tests, builds, linters, and scripts belong in `relai_exec` or `relai_validate`.

Rel.AI may reuse an active managed process only when the workspace, logical `work_id`, principal, normalized command, `cwd`, and environment key set match exactly. A reused result returns `reused:true` and current readiness state. Process reuse never crosses logical tasks, workspaces, principals, commands, directories, or environment-key shapes.

## Repeated failures

Rel.AI fingerprints safe failure facts such as tool/action identity, normalized command, `cwd`, error code, and safe target. If the same failure repeats within one mutation generation, workflow guidance switches from blind retry to a `repair` strategy such as impact inspection or root-cause diagnosis.

After a new mutation, the retry epoch resets and the smallest relevant check can become appropriate again.

## Inactivity and resumption

`inactive` is a non-terminal, resumable work-session state. A quiescent session keeps the same `work_id`, title, objective, counters, task-integrity state, task-owned changes, validation generations, and durable safe evidence. It receives `inactiveAt` but no terminal `endedAt`, `completedAt`, or `cancelledAt` timestamp.

A valid same-`work_id` call from the authorized principal in the bound workspace implicitly resumes the logical task into an active state. This is distinct from:

- explicit cancellation, which is terminal;
- explicit completion, which is terminal;
- a true terminal failure, which is terminal.

Historical records that used `inactivity_window` as cancellation/failure are normalized to resumable `inactive` when there is no explicit terminal action. Terminal sessions never reopen through inactivity handling.

## Completion authority

Validation evidence and workflow stage do not complete a task by themselves. `src/taskIntegrity.js` remains the authority for task-owned mutations, validation freshness, and workspace conflicts.

After the last relevant mutation, use current structured validation only when the boundary requires it. Do not rerun an unchanged exact check simply to create a second "final" verification. Once the required evidence is current and review is sufficient, complete once with `relai_work` using `action:"finish"`, or close atomically from a validating call with `complete:true` and a non-empty summary.

`relai_exec { command:"npm test" }`, a running development process, a completed plan checklist, or an advisory `workflow.stage === "complete"` does not independently satisfy hard completion requirements.

## Observability and privacy

Workflow guidance is attached to task-scoped results and persisted as a bounded snapshot. The dashboard receives only a projection: workflow stage, risk level, boundary level, top recommended-action text, fresh/stale evidence counts, and repeat count. Raw evidence receipts, recommendation arguments, repository paths, command output, environment values, and secrets are not exposed through the dashboard projection.

Ordinary workflow assembly consumes existing authority facts and cached topology. It must not spawn a fresh global `git status` process after every read or other ordinary tool call.

## Recovery and publishing

Use `relai_changes` restore/reset/tidy actions only for the requested recovery scope. Publishing remains explicit through `relai_publish`; workflow guidance never commits, pushes, or widens a protected branch/remote policy automatically.

When executing an approved multi-task plan, keep the same work session, verify each completion condition, and update its checklist only when evidence proves the task complete. Consolidate accumulated implementation as the plan advances instead of layering duplicate owners or compatibility paths.