# Task observability architecture

## Scope

Rel.AI MCP exposes one canonical logical-task snapshot and one canonical activity-event shape to the dashboard. The implementation extends the existing tool tracker, snapshot-based Server-Sent Events transport, JSON session store, and dashboard modules. It does not add a second task orchestrator, event bus, polling loop, or realtime protocol.

## End-to-end flow

```text
MCP tools/call
→ src/tools.js resolves workspace and explicit task_id
→ src/toolActivity.js creates or acquires the logical task
→ src/tools/execution.js enters the workspace queue and tool handler
→ process, repository, validation, Git, or approval layer executes
→ src/taskObservability.js derives a safe structured outcome
→ the lifecycle event is updated by stable operation/event ID
→ src/taskHistoryStore.js upserts the canonical task snapshot and event
→ src/http/dashboard.js reconciles persisted activity with the audit tail
→ an ordered dashboard snapshot is sent over the existing SSE stream
→ public/dashboard.js rejects duplicate or stale snapshots
→ task, session, activity, and elapsed-time views render canonical state
```

## Ownership

| Concern | Canonical owner |
| --- | --- |
| Task identity | `src/toolActivity.js`; explicit `task_id` remains the protocol identity |
| Task title and objective | `src/taskObservability.js` derivation plus optional `relai_start_task` input |
| Task status, current stage, call counters, and terminal outcome | `src/toolActivity.js` |
| Activity event shape, safe summaries, targets, results, errors, and progress | `src/taskObservability.js` |
| Queue-wait activity | `src/tools/execution.js` through the current tool activity context |
| Audit enrichment | Existing audit pipeline; merged by operation ID without adding a second call count |
| Persistence | `src/taskHistoryStore.js` and `src/taskHistoryStorage.js` |
| Snapshot ordering | `src/http/dashboard.js` stream ID and sequence |
| Duplicate/stale snapshot rejection | `src/ui/snapshot-order.js` |
| Presentation-only current time | `src/ui/clock.js` |
| Task progress rendering | `src/ui/components/task-progress.js` |

## Canonical task semantics

A task snapshot includes a meaningful sanitized title, optional objective, canonical status, current stage, latest meaningful activity, tool-call counters, progress, timestamps, summary/error fields, correlation-compatible task/session IDs, current operations, and ordered activity events.

Canonical statuses are:

- `queued`
- `planning`
- `running`
- `waiting_for_approval`
- `blocked`
- `validating`
- `completed`
- `completed_with_warnings`
- `failed`
- `cancelled`

Historical `working`, `waiting`, `settling`, `attention`, and `inactive` values remain display-compatible where encountered, but new tracker and persistence writes use the canonical statuses.

## Task titles

Title resolution is deterministic and local:

1. explicit `relai_start_task.title`;
2. structured objective;
3. current operation;
4. tool-specific safe title;
5. workspace-based fallback.

Raw prompts, unrestricted command output, file contents, and credentials are never used as titles. Generic labels such as `Task`, `Request`, and `Tool call` are rejected as final titles.

## Activity lifecycle

Each tool invocation owns one stable `operationId`, which is also the activity `eventId` and tool invocation ID. The event is created in `running` state and updated in place to `succeeded`, `failed`, `blocked`, or `cancelled`. Persistence upserts by `eventId`, so lifecycle updates do not create repetitive rows.

Audit events with the same `operationId` enrich the canonical lifecycle record but do not increment the task's tool-call count a second time.

Each event can expose:

- category and action;
- state;
- title and structured summary;
- start, completion, and duration;
- tool name and operation;
- workspace-relative target or sanitized resource URI;
- outcome, affected-item count, and warning count;
- normalized safe error;
- allow-listed metadata.

## Progress policy

Progress is never inferred from elapsed time or log volume.

- **Determinate:** used when the tool has a known path batch, check set, workflow total, plan total, or native total.
- **Indeterminate:** used while exploring, planning, waiting for the next step, or executing an operation without a stable denominator.
- **Complete:** used only for successful terminal task completion and always resolves to 100%.

Failed and cancelled tasks preserve any defensible completed-unit information but never convert it into a successful 100% state. Parent/child progress is not aggregated unless a future workflow provides non-overlapping measurable units.

## Realtime consistency

The existing snapshot-based SSE transport remains authoritative.

Every snapshot includes:

```json
{
  "streamId": "process-scoped UUID",
  "sequence": 1,
  "generatedAt": "ISO timestamp",
  "modelVersion": 3
}
```

Rules:

- sequence is monotonic within one server process;
- each SSE snapshot carries an event ID derived from stream and sequence;
- a new connection receives an immediate canonical catch-up snapshot;
- duplicate or lower sequence numbers in the same stream are ignored;
- a new stream ID establishes a new ordering domain after server restart;
- persisted terminal state rejects older running updates;
- canonical events are idempotent by stable event ID.

## Persistence and compatibility

The session-store schema marker is v3. Creating the marker no longer deletes the session directory. Older records remain readable and receive safe fallbacks for title, progress, counters, current stage, and current activity. Missing information is marked unavailable rather than fabricated.

Malformed files remain isolated by the existing storage reader. The explicit history-clear operation remains destructive by design; normal schema initialization is not.

## Security and privacy

Activity metadata is allow-listed. Sensitive key patterns are excluded, including tokens, secrets, passwords, authorization data, cookies, credentials, private keys, approval data, environment values, raw headers, prompt/content fields, stdout, stderr, and unrestricted output.

Displayed file targets are normalized to workspace-relative paths. URLs lose username, password, query, and fragment data. The Activity details drawer and Copy JSON action use a safe projection and do not expose raw tool arguments or raw output.

OpenTelemetry and dashboard activity remain independent consumers of the same logical identifiers. Dashboard operation does not require telemetry to be enabled.

## Frontend clock

`src/ui/clock.js` owns one shared one-second timer for presentation-only time values.

- Time-sensitive nodes opt in with `data-clock-elapsed-start`, optional `data-clock-elapsed-end`, or `data-clock-relative`.
- The timer updates only those nodes; it does not re-render the dashboard or depend on backend events.
- The timer pauses while the document is hidden, recomputes from source timestamps when visible again, and is cleaned up on page exit.
- Completed durations remain anchored to completion timestamps.
- Wall-clock timestamps and elapsed durations are kept separate.

## Accessibility

Determinate progress uses native `progress[value]` with a valid accessible label. Indeterminate progress omits a fabricated numeric value. Compact list progress is not an aggressive live region; the selected task state can expose a restrained status announcement. Status text accompanies color. Timeline links remain keyboard accessible, and indeterminate animation is disabled under reduced-motion preferences.

## Performance characteristics

- One shared clock interval replaces per-row intervals and does not trigger full-dashboard renders.
- One lifecycle event is stored per tool invocation and updated in place.
- Session events are capped at 200 records.
- Dashboard snapshots merge by stable event ID.
- High-frequency backend activity continues through the existing coalesced snapshot scheduler.
- No event-processing framework, database watcher, or secondary realtime transport was introduced.

## Verification

Coverage includes deterministic titles, sanitization, progress calculation, terminal behavior, lifecycle event upserts, audit deduplication, historical fallback, non-destructive migration, stale terminal protection, tool correlation, SSE sequence ordering, duplicate snapshot rejection, clock fake timers, visibility resume, cleanup, dashboard rendering, generated CSS, and live HTTP/SSE delivery.
