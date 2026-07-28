# ChatGPT coding runtime roadmap

## Purpose

This document defines the implementation path from the current Rel.AI MCP repository bridge to a broader local coding runtime for ChatGPT.

Phases 1, 2, 3, 4A, and 4B are included in the 0.23.0 build. Phase 4C remains deferred as a generic optional task ledger, and Phase 5 remains deferred as a separate model-worker layer. The runtime also includes durable deferred operations, semantic search, structured diagnostics, change-aware validation plans, output schemas, OAuth hardening, OpenTelemetry, and revision-aware resource caching.

The target is not to reproduce Claude Code's user interface. The target is to remove the practical runtime limitations that matter during complex coding work:

- run any development command required by the repository;
- keep development servers and other long-running processes alive;
- provide persistent project instructions and isolated Git worktrees;
- optionally coordinate independent model workers with separate contexts.

The authenticated Rel.AI connection and configured workspace root remain the primary boundary. Later phases should not reintroduce command allowlists or named-script-only execution. Output limits, timeouts, logs, and lifecycle controls exist to keep the transport reliable, not to reduce command capability.

---

## Current architecture

Use these files as the authoritative integration points:

| Concern | Current implementation |
| --- | --- |
| Tool definitions and input schemas | `src/tools/registry.js`, `src/tools/schema.js` |
| Stable tool output schemas | `src/tools/outputSchemas.js` |
| Tool handlers and execution orchestration | `src/tools/handlers.js`, `src/tools/execution.js`, `src/tools.js` |
| One-shot child processes and process-tree termination | `src/process.js`, `src/bridge/exec.js` |
| Managed persistent processes and log cursors | `src/processManager.js` |
| Durable deferred operations | `src/operationTasks.js`, `src/tools/operationTaskHandlers.js` |
| Logical task observability and activity | `src/taskObservability.js`, `src/toolActivity.js` |
| Workspace resolution and configuration | `src/config.js`, `src/configEditor.js` |
| Managed Git worktrees | `src/worktreeManager.js` |
| Git operations | `src/repo/gitOps.js` |
| Lexical trace, semantic search, diagnostics, and validation plans | `src/bridge/codeIntelligence.js`, `src/bridge/semanticSearch.js`, `src/bridge/diagnosticsRunner.js`, `src/bridge/validationPlan.js` |
| MCP request context, approvals, results, and HTTP transport | `src/mcp/context.js`, `src/mcp/approval.js`, `src/mcp/results.js`, `src/http/mcp.js`, `src/mcpServer.js` |
| OAuth authorization server | `src/oauthProvider.js` |
| OpenTelemetry tracing | `src/telemetry.js` |
| Resource generation and cache revisions | `src/resources.js` |
| Electron application lifecycle | `electron/main.js` |
| Dashboard sections and actions | `src/ui/features/` |
| Boundary types | `types/boundaries.d.ts` |
| Test discovery | `test/run-tests.mjs` |

Every new public tool must be added through the registry and handler system rather than through a parallel tool table.

---

## Phase 1 — repository context policy

### Status

Implemented.

### Delivered behavior

- Replaced the misleading per-workspace `fastTask` object with `context`.
- Removed the unused `skipIndexForSmallTasks` and `preferChangedFiles` settings.
- Renamed the active per-workspace limit to `context.snapshotMaxFiles`.
- Increased the initial repository map default to 3,000 files.
- Kept generated/cache exclusions and `.relaiignore` handling.
- Confirmed that snapshot limits and `includeRoots` do not restrict direct reads or text search.
- Made repository overview and search optional when the relevant path is already known.
- Added `relai_code_inspect` with a fingerprint-invalidated live index for symbol definitions, references and calls, structurally related files, reverse-import impact, affected tests, and diagnostic-command readiness.
- Kept the index bounded and non-persistent so path, size, or modification-time changes invalidate cached analysis instead of leaving stale background state.
- Preserved final structured validation and explicit completion requirements.
- Added backward-compatible migration from:
  - top-level `maxIndexFiles`;
  - `fastTask.maxIndexFiles`;
  - `fastTask.includeRoots`;
  - `fastTask.excludePaths`.

### Canonical workspace configuration

```json
{
  "context": {
    "snapshotMaxFiles": 3000,
    "includeRoots": [],
    "excludePaths": [
      ".git",
      "node_modules",
      "dist",
      "build",
      "coverage"
    ]
  }
}
```

### Runtime rule

The snapshot is an initial map, not an access boundary. ChatGPT may call `relai_search`, `relai_semantic_search`, `relai_code_inspect`, and `relai_read` for any relevant non-sensitive path inside the configured workspace, whether or not the path appeared in the snapshot. Code intelligence remains best-effort lexical, hashed-vector, and import-graph analysis; it does not claim compiler-accurate language-server semantics or transmit repository content to an external embedding service.

---

# Phase 2 — unrestricted one-shot command execution

## Objective

Add a public `relai_exec` tool that runs an arbitrary command inside a configured workspace and returns a structured result when the command exits.

This is the highest-priority parity feature. It enables package installation, custom scripts, migrations, Docker commands, Git inspection, CLI utilities, compilers, formatters, test runners, and repository-specific development workflows without adding a dedicated tool for every command family.

## Public tool contract

Add this definition to `src/tools/registry.js`:

```json
{
  "name": "relai_exec",
  "title": "Run Workspace Command",
  "description": "Run a command inside a configured workspace and return its exit status and output.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "workspace": { "type": "string" },
      "command": { "type": "string", "minLength": 1, "maxLength": 20000 },
      "cwd": { "type": "string" },
      "timeoutMs": { "type": "number", "minimum": 1000, "maximum": 86400000 },
      "env": {
        "type": "object",
        "additionalProperties": { "type": "string" }
      },
      "maxOutputBytes": { "type": "number", "minimum": 1000, "maximum": 16777216 }
    },
    "required": ["workspace", "command"],
    "additionalProperties": false
  }
}
```

Do not strip `command` from the connector schema. This phase explicitly requires free-form command execution.

## Result contract

Return a stable result shape:

```json
{
  "ok": true,
  "workspace": "app",
  "command": "npm test",
  "cwd": ".",
  "exitCode": 0,
  "durationMs": 1872,
  "stdout": "...",
  "stderr": "...",
  "stdoutBytes": 8240,
  "stderrBytes": 0,
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "timedOut": false
}
```

For non-zero exits, return `ok: false` but do not throw merely because the command exited non-zero. Reserve thrown errors for invalid arguments, invalid workspace-relative paths, spawn failures, and internal failures. This lets ChatGPT inspect compiler and test failures as normal tool results.

## New module

Create `src/bridge/exec.js` with:

```text
relaiExec(workspace, config, args)
resolveCommandCwd(workspace, args.cwd)
normalizeCommandEnv(args.env)
resolveShell()
runWorkspaceCommand(...)
```

### Working directory

- Default to `workspace.path`.
- Treat `cwd` as a relative workspace path.
- Resolve it with the existing safe-path utilities.
- Require it to exist and be a directory.
- Do not permit an absolute `cwd` outside the configured workspace.

The command itself remains unrestricted and can intentionally refer to absolute paths. The workspace-relative `cwd` rule is only for predictable command placement and dashboard attribution.

### Shell behavior

For the first implementation, reuse `runProcess` with `shell: true` and the complete command string.

Windows resolution order should be explicit:

1. `pwsh.exe` when available;
2. `powershell.exe` when available;
3. the Node/Windows default shell as a fallback.

A later refactor may add an explicit shell selector, but Phase 2 should not block on it.

When explicitly invoking PowerShell, use:

```text
-NoLogo -NoProfile -NonInteractive -Command <command>
```

Do not escape the command by concatenating a manually quoted command line when an argument array can be used. Add a helper dedicated to the selected shell.

### Environment

- Start from the inherited process environment.
- Add `REL_AI_MCP=1` as today.
- Merge string values from `args.env`.
- Permit deleting an inherited variable later through an explicit `null` contract only if the JSON schema is expanded accordingly.
- Redact secret-looking environment keys from audit and dashboard records.
- Never echo the full inherited environment.

### Timeouts and output

Refactor `src/process.js` only as much as needed to report:

- total stdout/stderr bytes observed;
- whether each stream was truncated;
- timeout status;
- duration.

Keep tail-preserving output behavior. The complete command output does not need to fit into a single MCP response. Phase 3 will provide persistent logs and ranged reads.

### Tool integration

Update:

- `src/tools/registry.js`: definition, annotations, behavior, dashboard metadata.
- `src/tools/handlers.js`: `exec` handler using `inWorkspace`.
- `src/tools.js`: human-readable operation text.
- `src/tools/connector.js`: compact only redundant telemetry; preserve command failure output.
- `types/boundaries.d.ts`: command, cwd, env, output fields.
- `src/cautionZone.js`: classify command activity if that system remains useful, but do not reject commands.
- dashboard tool metadata/cards: surface the new tool automatically through the registry.

`relai_exec` should have:

```text
startsSession: false
sessionWrite: false
audit: exec
cache: empty
```

Do not automatically mark every command as a file mutation. A command may inspect, build, install, or modify files. After command completion, invalidate the workspace read cache conservatively because the command may have changed any file.

Add a cache behavior such as `workspace` or handle `relai_exec` explicitly in `invalidateSessionCacheForCall` by invalidating the entire alias.

## Validation separation

`relai_exec` must never satisfy the structured final-validation requirement used by either atomic `relai_run_checks` completion or standalone `relai_complete_task`.

Examples:

- `relai_exec { command: "npm test" }` is command output only.
- `relai_run_checks { level: "standard" }` records structured validation.
- Completion remains valid only after structured `relai_run_checks`; the final checks may close atomically with `complete:true` and `summary`, or standalone `relai_complete_task` may close after read-only review.

This separation preserves reliable completion semantics without restricting command execution.

## Workspace operation queue

One-shot commands should use the existing per-workspace queue. This prevents a command and a file mutation from racing unexpectedly in the same workspace.

The queue is held only until the one-shot command exits. Long-running commands belong in Phase 3.

## Tests

Add focused tests:

### `test/exec-tool-unit.mjs`

- command succeeds and returns stdout;
- command exits non-zero and returns `ok: false` without a thrown dispatch error;
- `cwd` selects a nested directory;
- invalid/outside `cwd` is refused;
- environment overrides are visible to the child process;
- inherited environment is not returned;
- stdout and stderr are captured separately;
- large output is tail-bounded with correct byte/truncation metadata;
- timeout terminates the full process tree;
- command text appears in audit in bounded/redacted form;
- session cache is invalidated for the workspace.

### Schema and integration tests

- tool appears in `tools/list`;
- connector schema contains `command`;
- handler registry and tool counts remain consistent;
- `describeToolOperation` produces a concise label;
- a successful `relai_exec` cannot complete a task or enable standalone completion without structured validation;
- HTTP/OAuth connector invocation succeeds.

## Acceptance criteria

Phase 2 is complete when ChatGPT can use one authenticated call to run examples such as:

```text
npm install
npm test
git log --oneline -20
python scripts/migrate.py
docker compose build
gh pr checks
npx playwright test
```

and receive accurate exit status, bounded output, timeout behavior, audit history, and workspace attribution.

---

# Phase 3 — persistent and interactive processes

## Status

Implemented in 0.23.0 and included in the public tool surface.

## Objective

Support development servers, watchers, debuggers, REPLs, and other commands that must continue running after the starting tool call returns.

Do not model this as an extremely long `relai_exec` timeout. Build a process manager with stable process identities and persistent logs.

## Public tools

Add five tools:

```text
relai_process_start
relai_process_read
relai_process_write
relai_process_stop
relai_process_list
```

### `relai_process_start`

Input:

```json
{
  "workspace": "app",
  "command": "npm run dev",
  "cwd": "frontend",
  "env": { "PORT": "4173" },
  "label": "frontend-dev",
  "startupWaitMs": 1000
}
```

Result:

```json
{
  "ok": true,
  "processId": "proc_...",
  "pid": 12340,
  "workspace": "app",
  "label": "frontend-dev",
  "status": "running",
  "startedAt": "...",
  "stdoutCursor": 240,
  "stderrCursor": 0,
  "stdoutTail": "ready on http://localhost:4173"
}
```

The start call must return quickly after spawn or after a short optional startup observation window. It must not hold the workspace operation queue for the process lifetime.

### `relai_process_read`

Input options:

```json
{
  "processId": "proc_...",
  "stdoutOffset": 0,
  "stderrOffset": 0,
  "maxBytes": 65536,
  "tailLines": 200
}
```

Return new output, next cursors, process status, exit code when available, and truncation metadata.

Offsets are preferable to only tail reads because they let ChatGPT poll without receiving duplicate logs.

### `relai_process_write`

Input:

```json
{
  "processId": "proc_...",
  "input": "yes\n"
}
```

Keep stdin open for managed processes. Return the number of bytes accepted. Report a clear error if stdin is closed or the process has exited.

### `relai_process_stop`

Input:

```json
{
  "processId": "proc_...",
  "signal": "SIGTERM",
  "graceMs": 3000
}
```

Terminate the full process tree. After the grace interval, escalate using the existing Windows `taskkill /f /t` or Unix process-group termination.

### `relai_process_list`

Support optional workspace and status filters. Return active and recently exited managed processes with bounded summaries.

## Process manager module

Create `src/processManager.js` or `src/runtime/processManager.js`.

Use an in-memory map keyed by a cryptographically random process ID. Each record should contain:

```text
processId
pid
workspace alias
workspace root
relative cwd
command
label
status: starting | running | exited | failed | stopped
startedAt
endedAt
exitCode
signal
child process reference
stdin state
stdout log path
stderr log path
stdout byte count
stderr byte count
last activity timestamp
owner task/scope identifiers when available
```

## Persistent logs

Write raw stdout and stderr to:

```text
~/.rel-ai-mcp/processes/<processId>/stdout.log
~/.rel-ai-mcp/processes/<processId>/stderr.log
~/.rel-ai-mcp/processes/<processId>/metadata.json
```

Requirements:

- create directories with restricted permissions;
- append streams incrementally;
- keep byte counters in memory;
- support ranged reads without loading the full file;
- rotate or cap logs using configurable limits;
- retain exited-process metadata for a bounded period;
- prune stale process directories on application startup.

Do not store environment values in metadata. Store only environment key names if diagnostic value is required.

## Lifecycle integration

### Server and Electron shutdown

Add `stopAllManagedProcesses()` and call it during:

- Electron `before-quit`;
- local server shutdown;
- test teardown;
- explicit dashboard stop/restart where the runtime is expected to stop.

Decide and document whether an Electron server restart should preserve managed processes. The recommended initial behavior is to stop them, because the new server would otherwise lose the in-memory child handles.

### Crashed application recovery

On startup, metadata may describe processes that no longer have a live parent connection. Mark them `orphaned` or `unknown`; do not assume the PID still belongs to the original command. Avoid killing a reused PID based only on stale metadata.

## Queue behavior

- `relai_process_start` enters the workspace queue only for validation and spawn.
- It exits the queue as soon as the process record is created.
- `read`, `write`, `stop`, and `list` should not use the workspace mutation queue.
- File edits and one-shot commands may run while a managed server is active.

## Activity and auditing

Starting a process is a completed tool call, not an indefinitely running tool call. The dashboard should separately show managed-process status.

Audit events should record:

- process ID;
- label;
- workspace;
- bounded command summary;
- lifecycle action;
- exit code/status;
- duration when known.

Do not write every stdout chunk into the normal audit log.

## Dashboard

Add a **Processes** section or a workspace-card panel displaying:

- label and command;
- workspace and cwd;
- PID;
- status and elapsed time;
- recent output tail;
- stop action;
- open full log action.

Use SSE/dashboard refresh events when process state changes rather than polling full logs aggressively.

## Tests

Add tests for:

- start and immediate read;
- process that emits output over time;
- independent stdout/stderr cursors;
- interactive stdin round trip;
- normal exit and exit-code reporting;
- stop and process-tree cleanup;
- multiple concurrent processes in one workspace;
- processes in different workspaces;
- invalid process ID;
- log rotation/cap behavior;
- application shutdown cleanup;
- stale metadata recovery;
- dashboard serialization;
- connector tool schemas and tool counts.

Use small Node child fixtures in `test/fixtures/`; do not depend on external services.

## Acceptance criteria

A complete loop must work:

```text
start npm run dev
read startup logs
edit source files
read rebuild logs
run a route/UI check
send stdin when needed
stop the dev server
```

without holding an MCP request open for the lifetime of the process.

---

# Phase 4 — project instructions, Git worktrees, and task plans

Phase 4 has three independent deliverables. They may ship in separate releases.

## Phase 4A — persistent project instructions

### Status

Implemented.

### Delivered behavior

- Loads `REL_AI.md` and `.relai/instructions.md` in documented precedence order.
- Concatenates both sources with named headings and explicit precedence metadata.
- Caps the combined connector payload at 64 KiB with UTF-8-safe truncation and source/byte metadata.
- Rejects symbolic links, non-files, workspace escapes, and binary-looking instruction files.
- Caches results by real workspace path, payload limit, modification time, size, and mode.
- Exposes full instructions through `relai_repo_snapshot` and `relai://workspace/<alias>/inspect`.
- Keeps instruction content out of dashboard/config summaries while showing configured source paths.
- Leaves both supported files available through explicit `relai_read` calls when full content is needed.
- Treats instruction content as guidance only; Rel.AI never executes it automatically.

### Objective

Give ChatGPT repository-specific architecture, style, command, and definition-of-done guidance without repeatedly rediscovering it from source files.

### Supported files

Load, in precedence order:

1. `REL_AI.md` at the workspace root;
2. `.relai/instructions.md`.

Recommended behavior:

- if both exist, concatenate them with named headings;
- cap the combined connector payload, initially at 64 KiB;
- return source paths and truncation metadata;
- reject binary-looking instruction files;
- never execute content from instruction files automatically;
- include instructions in `relai_repo_snapshot` and `relai://workspace/<alias>/inspect`;
- allow direct reads for the full files when truncated.

### Caching

Cache by path, modification time, and size. Invalidate on edits to either instruction path.

### Result shape

```json
{
  "projectInstructions": {
    "sources": ["REL_AI.md"],
    "content": "...",
    "truncated": false
  }
}
```

### Tests

- no instruction file;
- each supported path separately;
- both files and precedence;
- UTF-8 truncation;
- mtime invalidation;
- connector compaction retains instructions;
- secret-path rules do not incorrectly hide the explicit instruction files.

## Phase 4B — Git worktree management

### Status

Implemented in 0.23.0 and included in the public tool surface.

### Objective

Allow isolated branches and parallel ChatGPT conversations without changing the original checkout.

### Public tools

```text
relai_worktree_create
relai_worktree_list
relai_worktree_remove
```

A merge helper may be added later, but do not combine creation, merging, and deletion into one ambiguous tool.

### Storage layout

Use a Rel.AI-managed root:

```text
~/.rel-ai-mcp/worktrees/<workspace-alias>/<worktree-name>/
```

Maintain metadata in:

```text
~/.rel-ai-mcp/worktrees/index.json
```

Metadata should contain:

- source workspace alias/root;
- generated worktree alias;
- path;
- branch;
- base revision;
- created time;
- owning task or conversation when available;
- status.

### Create contract

Input:

```json
{
  "workspace": "app",
  "name": "auth-refactor",
  "base": "main",
  "branch": "relai/auth-refactor"
}
```

Implementation:

1. validate repository and clean worktree metadata;
2. validate a filesystem-safe worktree name;
3. resolve the base revision;
4. choose or validate a branch name;
5. run `git worktree add -b <branch> <managed-path> <base>`;
6. register a dynamic workspace alias such as `app--auth-refactor`;
7. return the alias and path.

Do not copy the repository manually.

### Dynamic workspace resolution

Extend workspace resolution so registered worktrees can be addressed by normal tools without permanently adding every worktree to `config.json`.

Preferred order:

1. static configured workspaces;
2. managed worktree registry;
3. clear not-found error.

Worktree aliases inherit source workspace settings:

- context policy;
- validation configuration;
- allowed remotes;
- protected branches, with the new branch added or treated appropriately;
- patch settings.

### Remove contract

Default behavior must refuse removal when:

- the worktree has uncommitted changes;
- a managed process is using its path;
- another active Rel.AI operation targets it.

Support an explicit force field only after returning the dirty status in a previous or dry-run result. On removal:

1. stop managed processes for the worktree when force is explicitly requested;
2. run `git worktree remove`;
3. prune Git worktree metadata;
4. remove the Rel.AI registry entry;
5. preserve the branch unless a separate explicit branch-delete option is supplied.

### Tests

- create from branch and commit SHA;
- default generated branch;
- duplicate name/alias refusal;
- normal tools resolve the dynamic alias;
- inherited validation/context settings;
- list status;
- dirty removal refusal;
- active process removal refusal;
- successful cleanup;
- stale registry repair;
- Windows path quoting and long-path behavior.

## Phase 4C — optional task ledger

### Status

Deferred. Not included in the current build or public tool surface.

Durable deferred operations and signed validation plans are implemented, but they are not a generic user-authored task ledger. They track executable work and validation scope rather than arbitrary plan steps.

### Objective

Represent a complex coding plan explicitly without making planning mandatory for small tasks.

### Public tools

```text
relai_task_plan
relai_task_update
relai_task_status
```

### Data model

Store under:

```text
~/.rel-ai-mcp/plans/<taskId>.json
```

Example:

```json
{
  "taskId": "task_...",
  "workspace": "app",
  "title": "Implement token refresh",
  "steps": [
    { "id": "step_1", "text": "Trace authentication flow", "status": "completed" },
    { "id": "step_2", "text": "Implement refresh handling", "status": "in_progress" },
    { "id": "step_3", "text": "Add regression tests", "status": "pending" }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

Allowed step states:

```text
pending
in_progress
completed
blocked
skipped
```

### Integration

- associate a plan with the current task scope when available;
- show progress in Sessions and the workspace dashboard;
- include the active plan in status summaries;
- do not let plan completion substitute for an explicit validated completion signal (`relai_run_checks` with `complete:true` or standalone `relai_complete_task`);
- do not require a plan before edits or commands.

### Tests

- create/update/read;
- invalid transitions and unknown step IDs;
- concurrent atomic writes;
- task-scope association;
- dashboard rendering;
- persistence across restart;
- no impact on small workflows without a plan.

---

# Phase 5 — independent model workers

## Status

Deferred. Not included in the current build. The provider and automation design should be reviewed again before implementation.

## Objective

Optionally let the main ChatGPT conversation delegate independent investigations or implementation units to model workers with separate context windows.

This is the phase that addresses Claude Code-style subagents most directly. It is also the most expensive and operationally complex phase.

## Prerequisites

- An OpenAI API credential or another supported model-provider credential is required separately from the user's ChatGPT subscription.
- The worker feature must be disabled unless explicitly configured.
- CI must use a fake provider adapter; it must never require a live model API.
- Phase 2 command execution and Phase 4 worktree isolation should be stable first.

## Architecture

Create a provider-independent worker service:

```text
Main ChatGPT conversation
        |
        | MCP tools
        v
Rel.AI worker coordinator
        |
        +-- worker A: isolated prompt/context + worktree
        +-- worker B: isolated prompt/context + worktree
        +-- worker C: read-only investigation context
```

Suggested modules:

```text
src/workers/coordinator.js
src/workers/store.js
src/workers/providers/openai.js
src/workers/providers/fake.js
src/workers/prompts.js
src/workers/events.js
```

## Public tools

Start with:

```text
relai_worker_start
relai_worker_status
relai_worker_result
relai_worker_cancel
relai_worker_list
```

### Start contract

```json
{
  "workspace": "app",
  "task": "Investigate why refresh tokens are lost after restart and propose a fix.",
  "mode": "read_only",
  "worktree": false,
  "model": "configured-default",
  "maxTurns": 20,
  "maxOutputTokens": 12000
}
```

For implementation workers:

```json
{
  "workspace": "app",
  "task": "Implement the approved refresh-token persistence change and add tests.",
  "mode": "write",
  "worktree": true
}
```

## Worker isolation

Each worker needs:

- its own conversation/context history;
- a bounded system prompt describing its assignment;
- an explicit workspace alias;
- a tool subset appropriate to its mode;
- an independent token/turn budget;
- cancellation support;
- a dedicated activity and audit identity.

Write workers should default to managed worktrees. Read-only workers may share the source workspace because they do not mutate it.

## Tool access

Workers may use the same internal handler layer as the public MCP tools, but calls must be attributed to the worker ID and must not impersonate the main ChatGPT task scope.

Recommended tool sets:

### Read-only worker

```text
relai_repo_snapshot
relai_search
relai_read
relai_status with workspace
relai_diff
relai_exec, when command-side inspection is required
```

### Write worker

All relevant workspace tools, including `relai_exec`, editing, validation, and diff. Publishing commands should remain opt-in in the worker assignment.

Do not expose raw provider API credentials to worker prompts or tool results.

## Persistence

Store worker state under:

```text
~/.rel-ai-mcp/workers/<workerId>/metadata.json
~/.rel-ai-mcp/workers/<workerId>/events.jsonl
~/.rel-ai-mcp/workers/<workerId>/result.md
```

Persist enough state to show a failed/interrupted worker after restart. Full provider conversation recovery may be added later; the first release can mark active workers interrupted after a host restart.

## Result contract

Worker results should contain:

- concise summary;
- findings;
- changed files;
- validation results;
- worktree alias/branch when applicable;
- unresolved issues;
- provider/model usage;
- cost and token counters when available.

The main ChatGPT conversation decides whether to integrate, revise, or discard the result.

## Parallelism

Add configurable limits:

```json
{
  "workers": {
    "enabled": false,
    "maxConcurrent": 3,
    "defaultModel": "...",
    "defaultMaxTurns": 20,
    "defaultMaxOutputTokens": 12000
  }
}
```

The coordinator must queue excess workers rather than spawning without limit.

## Cancellation and failures

Cancellation must:

- stop model streaming;
- stop worker-started managed processes;
- retain logs and partial results;
- leave a write worktree intact for inspection unless explicit cleanup is requested.

Failures must be categorized:

```text
provider authentication
provider rate limit
budget exceeded
model/tool error
validation failure
cancelled
host interrupted
```

## Dashboard

Add a Workers page or section showing:

- assignment;
- model/provider;
- workspace/worktree;
- state: queued, running, waiting, completed, failed, cancelled;
- current operation;
- elapsed time;
- token/cost usage;
- result and changed files;
- cancel action.

## Tests

Use a deterministic fake provider to test:

- worker creation and queueing;
- isolated contexts;
- tool-call dispatch and attribution;
- read-only/write tool sets;
- worktree creation for write workers;
- concurrency limits;
- cancellation;
- timeout and turn budget;
- partial results;
- provider errors;
- dashboard and audit serialization;
- restart marking active workers interrupted;
- result retrieval.

Add a manually triggered integration test for a real provider, but exclude it from the normal CI gate.

## Acceptance criteria

Phase 5 is complete when the main ChatGPT conversation can delegate two independent tasks, observe both running concurrently, receive condensed results, and review or integrate a write worker's isolated worktree without either worker consuming the main conversation's context.

---

# Cross-phase engineering requirements

## Configuration migration

Every configuration change must choose and document one explicit compatibility policy. Normal releases may normalize the immediately previous shape, but a declared hard-cutover release may reject or ignore obsolete keys and state instead of migrating them. In either case it must:

- write one canonical shape only;
- avoid hidden aliases or silent fallback behavior;
- include regression coverage for the selected policy;
- update `examples/config.example.json`, README, status output, and dashboard forms.

## Tool registry integrity

For every tool addition:

1. define it once in `src/tools/registry.js`;
2. map its handler in `src/tools/handlers.js`;
3. update operation descriptions in `src/tools.js`;
4. update types;
5. ensure dashboard metadata derives from the registry;
6. update tool-count tests and packaged-app smoke tests;
7. update connector help and documentation.

Do not create hidden public tools or a second registry.

## Audit and privacy

- Audit command/process/worker actions with bounded summaries.
- Do not record inherited environment values or API credentials.
- Redact obvious secret fields from structured metadata.
- Keep raw process logs separate from the normal audit log.
- Preserve workspace and task/worker attribution.

## Validation and completion

Every explicit completion path must continue to require structured final validation. Atomic completion belongs on `relai_run_checks`; standalone `relai_complete_task` remains for post-validation read-only review.

These actions do not independently satisfy completion:

- a successful arbitrary command;
- a running development server;
- all task-plan steps marked complete;
- a worker reporting success.

The final controlling ChatGPT session must run or receive a recognized `relai_run_checks` result after the last relevant mutation.

## Testing order

For each phase:

```text
npm run check
npm run typecheck
focused new tests
npm run test:all
npm run electron:build
```

Run the installed-app smoke test before release when the phase changes packaged Electron runtime behavior.

## Release strategy

Recommended releases:

| Release | Scope | Status |
| --- | --- | --- |
| Phase 1 | Context policy and flexible file discovery | Implemented |
| Phase 2 | `relai_exec` one-shot commands | Implemented |
| Phase 3 | Managed persistent processes and dashboard | Implemented in 0.23.0 |
| Phase 4A | Project instruction files | Implemented |
| Phase 4B | Managed Git worktrees | Implemented in 0.23.0 |
| Phase 4C | Optional generic task ledger | Deferred |
| Phase 5 preview | Disabled-by-default independent workers | Deferred |

The 0.23.0 hard cutover combines several mature runtime boundaries behind one explicit 34-tool surface. Future lifecycle additions should still receive focused regression coverage and independent ownership boundaries.

---

# Recommended implementation order

1. Operate and harden the shipped one-shot, persistent-process, instruction, worktree, semantic-search, diagnostics, and validation-plan runtime.
2. Add the optional generic task ledger only if users need editable plan steps beyond existing task observability and deferred-operation state.
3. Add independent API workers only after the local runtime and worktree lifecycle have accumulated production evidence.

The main practical parity gain now comes from the shipped command, process, worktree, intelligence, diagnostics, and validation capabilities. Phase 4C would add editable planning semantics rather than execution capability. Phase 5 would add true separate-context parallel reasoning and remains an optional agent-host product layer rather than a basic MCP bridge feature.
