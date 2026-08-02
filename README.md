# Rel.AI MCP

```text
██████╗ ███████╗██╗         █████╗ ██╗    ███╗   ███╗ ██████╗██████╗
██╔══██╗██╔════╝██║        ██╔══██╗██║    ████╗ ████║██╔════╝██╔══██╗
██████╔╝█████╗  ██║        ███████║██║    ██╔████╔██║██║     ██████╔╝
██╔══██╗██╔══╝  ██║        ██╔══██║██║    ██║╚██╔╝██║██║     ██╔═══╝
██║  ██║███████╗███████╗   ██║  ██║██║    ██║ ╚═╝ ██║╚██████╗██║
╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝  ╚═╝╚═╝    ╚═╝     ╚═╝ ╚═════╝╚═╝

        I made this because I did not have Codex — so ChatGPT became my coder,
        and this local MCP bridge became the hands that can touch the repo.
```

Rel.AI MCP is the successor to my original Rel.AI project. The first version proved the idea: use ChatGPT web as the main reasoning engine, collect selected local workspace context, and apply the result locally. This version is the cleaner MCP/server version of that idea.

The goal is simple: I want the reasoning power of ChatGPT on the web, but I still want my repo to stay local, controlled, visible, and reversible.

```text
ChatGPT asks -> Rel.AI MCP inspects, changes, validates, and reviews locally -> I inspect the diff -> I keep or restore it
```

Tool use is intentionally small but flexible. ChatGPT should skip stages it does not need. A common workflow is:

```text
relai_work begin -> relai_search / relai_inspect -> relai_read -> relai_edit -> relai_validate checks (complete:true + summary)
```

No generated Python edit scripts. No update-helper maze. No local-edit fallback loops. First-party application code is ESM-only except for one sandbox-required Electron preload boundary. Rel.AI targets MCP `2026-07-28` through the stable MCP SDK v2 and always exposes one complete 12-tool capability surface. The former 30-tool direct surface, reduced profiles, and redundant aliases were removed in a hard cutover. Modern clients use `server/discover` with per-request protocol, client, and capability metadata; HTTP also accepts ChatGPT's SDK-supported stateless initialize flow. Neither mode creates transport-session identity.

Logical coding work is isolated by an opaque workspace-bound `work_id`, persistent commands by `processId`, native asynchronous work by MCP Task IDs, worktrees by dynamic workspace alias, and resumable approvals by signed `requestState`. After task creation, task-scoped tools require `work_id` and resolve the bound workspace automatically; an optional `workspace` argument acts only as an ownership assertion.

Rel.AI MCP still lightly nods to the original Rel.AI idea, but this README stands on its own: this is now a local MCP bridge for ChatGPT.

### Repository-specific instructions

Rel.AI automatically includes project guidance in task bootstrap and repository snapshots. It supports the existing root files:

```text
REL_AI.md
.relai/instructions.md
```

It also discovers `AGENTS.override.md` or `AGENTS.md` from the workspace root down to the optional `instructionPath` supplied to `relai_work` action `begin`. In each directory, `AGENTS.override.md` replaces `AGENTS.md`; instructions nearer the target path override parent instructions. `REL_AI.md` remains highest precedence, followed by `.relai/instructions.md`.

Instruction content is returned with named headings and explicit source order. The combined connector payload is capped at 64 KiB; when truncated, ChatGPT can read a named source directly with `relai_read`. Binary-looking files, symbolic links, and paths that escape the workspace are rejected. The content is guidance only and is never executed automatically.

---

## What it does

Rel.AI MCP lets ChatGPT work with configured local workspaces through a trusted local server.

It can:

- snapshot a filtered repo tree
- read selected files or small directory summaries
- write full files, apply exact localized replacements, apply structured patches, and stage whole-file writes only when unavoidable
- delete tracked files through structured patch operations
- tidy session-owned untracked artifacts through an expiry-bound plan
- run validation checks such as tests and analyzers
- run one-shot development commands such as dependency installation, migrations, compilers, and repository utilities
- start, read, write to, stop, and list persistent development processes with local logs
- create and remove isolated Git worktrees with dynamic workspace aliases
- search by exact text or private local hybrid semantic ranking
- trace definitions, callers, importers, tests, UI surfaces, and registration paths
- normalize compiler, analyzer, and linter diagnostics
- create signed change-aware validation plans
- load repository-specific guidance from hierarchical `AGENTS.md`, `REL_AI.md`, and `.relai/instructions.md`
- inspect git diffs
- run explicit git status, commit, push, and PR-draft flows
- restore local changes
- expose compact workspace readiness and status information
- expose a local or public MCP URL for ChatGPT connectors
- explicitly report coding-task completion after final validation

It is built around the practical flow I kept needing:

```text
I describe the coding task
ChatGPT reasons about it
Rel.AI MCP gives it only the repo access it asks for
ChatGPT edits through exact replacements or full-file writes
Rel.AI MCP runs final validation
ChatGPT reports completion through Rel.AI
I inspect the result and session record
```

---

## Screenshots

### Home

<p align="center">
  <img src="docs/images/dashboard-home-section.png" alt="Rel.AI MCP dashboard home overview" width="900">
</p>

The home screen shows the current bridge health, configured workspaces, validation state, and recent activity.

### Workspaces

<p align="center">
  <img src="docs/images/dashboard-workspaces-section.png" alt="Rel.AI MCP workspace cards" width="900">
</p>

Workspace cards show repository state, automatic validation commands, protected branches, allowed remotes, recent activity, and focused workspace actions.

### Activity

<p align="center">
  <img src="docs/images/dashboard-activity-section.png" alt="Rel.AI MCP activity table" width="900">
</p>

The activity page is there because I got tired of guessing what the MCP server was doing. It shows recent tool calls, workspace, status, and expandable detail rows.

### Tools

<p align="center">
  <img src="docs/images/dashboard-tools-section.png" alt="Rel.AI MCP bridge tools" width="900">
</p>

The dashboard shows the current workspace tool surface for inspection, one-shot commands, editing, validation, explicit completion reporting, review, Git publishing, tidy, and restore.

### Connection setup

<p align="center">
  <img src="docs/images/dashboard-connector-section.png" alt="Rel.AI MCP connector URL" width="900">
</p>

The Connection page shows the MCP URL for ChatGPT. It supports local URLs and public URLs from one-click tunnel setup.

### Diagnostics

<p align="center">
  <img src="docs/images/dashboard-diagnostics-section.png" alt="Rel.AI MCP diagnostics cards" width="700">
</p>

Diagnostics are intentionally plain: health, readiness, and recent activity. No mystery panel, no fake magic.

<details>
<summary>Full screenshots</summary>

### Full home

<p align="center">
  <img src="docs/images/dashboard-home.png" alt="Rel.AI MCP full dashboard home" width="900">
</p>

### Full workspaces

<p align="center">
  <img src="docs/images/dashboard-workspaces.png" alt="Rel.AI MCP full workspaces page" width="900">
</p>

### Full activity

<p align="center">
  <img src="docs/images/dashboard-activity.png" alt="Rel.AI MCP full activity page" width="900">
</p>

### Full tools

<p align="center">
  <img src="docs/images/dashboard-tools.png" alt="Rel.AI MCP full tools page" width="900">
</p>

### Full settings

<p align="center">
  <img src="docs/images/dashboard-settings-general.png" alt="Rel.AI MCP full settings page" width="900">
</p>

### Full connection

<p align="center">
  <img src="docs/images/dashboard-connector.png" alt="Rel.AI MCP full connection page" width="900">
</p>

### Full diagnostics

<p align="center">
  <img src="docs/images/dashboard-diagnostics.png" alt="Rel.AI MCP full diagnostics page" width="900">
</p>

</details>

---

## Why I made this

I made this because I did not have Codex available as the workflow I wanted.

I still wanted a Codex-like loop:

```text
understand the repo -> make the change -> run validation -> show the diff
```

But I wanted to drive it with ChatGPT web, especially the stronger reasoning models there. Copying files manually, uploading ZIPs, and pasting updates back into the project was too slow. The older Rel.AI project was my first answer to that problem. Rel.AI MCP is the next version: simpler, more direct, and built around MCP tools instead of an update-heavy browser/native-host flow.

The important design choice: ChatGPT does the thinking, but the local bridge keeps the repo access explicit.

---

## Install

### Unified plugin

The repository and packaged npm artifact include one versioned `rel-ai` plugin containing the MCP connector, the core `rel-ai-workflow` skill, and focused first-party investigation, debugging, verification, and persistent-development-process skills. Install, update, or remove the plugin as one unit in a compatible host. Connector and skills remain separate internal files. See [docs/PLUGIN.md](docs/PLUGIN.md) for the package layout, provenance policy, and artifact verification.

Bundling the connector and skills does not itself reduce MCP discovery context. The consolidated 12-tool surface and sub-512-byte global instructions provide that reduction. Detailed skill procedures load only when selected, and direct HTTP and stdio clients remain fully usable without loading a skill.

### Windows desktop app

Rel.AI MCP is a self-contained Windows desktop app. Download the latest installer from the [Releases page](https://github.com/Kyne0328/rel-ai-mcp/releases) and run it. The standard setup wizard lets you install for the current user or for all users, review the destination folder, and click **Install**. Selecting **all users** requests Windows administrator approval when the installer is not already elevated. The Finish page includes an optional **Run Rel.AI MCP** checkbox, enabled by default.

You do **not** need to install Node.js, npm, or ngrok. The app ships its own runtime and a pinned, upstream-signed ngrok agent. Agent upgrades arrive through signed Rel.AI application updates, so users still install only Rel.AI.

The one thing it cannot create for you is an ngrok account. Before first launch, sign up at [ngrok.com](https://ngrok.com) (the free tier is enough) and grab two things:

- your **authtoken**, from the ngrok dashboard
- a **static domain**, from **Domains** in the same dashboard

The setup wizard asks for both on first run, stores them locally, and starts the server and tunnel for you. Every launch after that goes straight to the dashboard.

The app lives in the system tray. Closing a window leaves it running; quit it from the tray menu. When one or more work sessions are explicitly completed while the app is not open, the Windows taskbar icon shows a numbered completion overlay. Opening or focusing any Rel.AI window clears the indicator.

Installed Windows builds check for application updates once per day. Downloads and restart-to-install are always explicit from **Settings > General** or the tray, and restart is blocked while a Rel.AI tool call is active. Portable builds update manually from the Releases page.

The installed Windows app can also enable **Launch at sign-in** under **Settings > General**. Sign-in launches run in the background so the tray, local service, and public endpoint are ready without opening the dashboard; ordinary launches remain dashboard-first. Portable builds do not register Windows startup entries.

---

## Connecting to ChatGPT

1. Launch Rel.AI MCP and let the wizard finish. The tray icon turns active once the tunnel is up.
2. Open the dashboard and go to the **Connection** page. It shows your MCP URL.
3. In ChatGPT, go to **Settings > Apps > Create** and paste that URL.
4. Set authentication to **OAuth**. ChatGPT opens a sign-in page — enter your Rel.AI approval token to approve.

The approval token is under **Settings > Connection**. Replacing it requires typing `REPLACE`; Rel.AI revokes authorization codes, access tokens, and refresh tokens while preserving issuer-bound ChatGPT client registrations. The existing ChatGPT app can then reconnect and approve again with the new token.

Because the domain is static, the connector keeps working across restarts. You configure it once.

See [docs/ONE_CLICK_SETUP.md](docs/ONE_CLICK_SETUP.md) for the full setup walkthrough, [docs/CONNECTING_TO_CHATGPT.md](docs/CONNECTING_TO_CHATGPT.md) for connector troubleshooting, and [docs/ESM_ARCHITECTURE.md](docs/ESM_ARCHITECTURE.md) for module ownership and release constraints.

---

## The dashboard

**Open dashboard** shows the full dashboard inside a secured Electron window. The same dashboard is also reachable in a normal browser at the local `/dashboard` route; Electron is the default host, not a separate implementation. The desktop host exchanges a single-use bootstrap code for an HttpOnly local session cookie, so the long-lived approval token is never stored in the embedded renderer or left in its URL.

The dashboard includes grouped **Sessions**, managed **Processes** with recent output and stop controls, lower-level **Activity**, workspace-scoped filtering, operational Git and validation state, actionable diagnostics, live/reconnecting status, and persistent desktop window and route state. Work is grouped by explicit logical `work_id`, not by MCP connection, repository, or assumed ChatGPT conversation identity. Multiple tasks may share one client connection while retaining independent activity and completion state. A task is marked completed only after an explicit completion signal: either `relai_validate` action `checks` with `complete:true` and `summary`, or `relai_work` action `finish` after a post-validation read-only review. Otherwise inactivity closes it as cancelled without claiming the overall request finished. Explicit completions increment the Windows taskbar overlay only while the desktop app is not being viewed; opening or focusing the app acknowledges and clears the count.

---

## Building from source

Only needed if you want to develop or package the app yourself. Requires the Node.js 24 LTS line and npm 11; CI and packaged-runtime validation use Node.js 24. The root and Electron packages are ESM, relative first-party imports use explicit extensions, and `electron/preload.cjs` is the only documented CommonJS boundary.
```bash
npm ci --ignore-scripts
npm ci --prefix electron
```

The ngrok agent binaries are not committed to git, so fetch the seed before running or packaging:

```bash
npm run fetch:ngrok          # Windows (pwsh); use scripts/fetch-ngrok.sh elsewhere
```

Then:

```bash
npm run electron:dev         # run the desktop app from source
npm run electron:dist        # build the Windows installer into dist/
npm run audit:production     # production dependency security gate
npm run validate:plugin      # validate plugin, MCP, skill metadata, and provenance
npm run test:skills          # verify modular skill ownership and trigger contracts
npm run test:tool-budgets    # enforce tool, instruction, result, and skill budgets
npm run test:plugin          # verify extracted runtime parity, calls, and removal
npm test                     # full suite
npm run knip                 # full unused files, dependencies, and exports audit
npm run knip:production      # production-only dead-code audit
```

The normal test gate includes `npm run knip:dependencies` so dependency drift and invalid Knip configuration fail CI. The broader Knip reports remain explicit review commands because removing files or exports requires source-level verification.

`electron:build` and `electron:dist` refuse to run when the ngrok seed is missing or differs from its reviewed provenance manifest. Windows verification requires the exact version, size, SHA-256, Authenticode publisher, and certificate issuer.

Windows CI and the release workflow build from a clean output directory, verify the packaged layout and hardened Electron fuses, then exercise OAuth/PKCE and the MCP task lifecycle through the packaged Node backend. Production publication requires protected Windows signing credentials and `forceCodeSigning`, verifies the installer, portable app, unpacked app, and bundled ngrok component independently, then generates a CycloneDX SBOM and GitHub provenance attestations. Windows x64 is the only packaged target validated and published by the current automation. Installer, uninstall, first-run UI, real ngrok publication, antivirus-vendor review, logged-in ChatGPT app selection, live approval-token rotation, and update-from-prior-release behavior remain manual checks on a disposable Windows machine. See [docs/USABILITY_ACCEPTANCE.md](docs/USABILITY_ACCEPTANCE.md), [docs/INSTALLER_TEST_SAFETY.md](docs/INSTALLER_TEST_SAFETY.md), [docs/PACKAGING_SECURITY.md](docs/PACKAGING_SECURITY.md), and [docs/ANTIVIRUS_FALSE_POSITIVES.md](docs/ANTIVIRUS_FALSE_POSITIVES.md).

## MCP tools

Rel.AI exposes 12 capability-oriented tools through MCP SDK v2. Modern HTTP clients use MCP `2026-07-28`; the same endpoint also supports ChatGPT's SDK-compatible stateless initialize flow. Rel.AI does not use transport sessions as work identity. The server enforces workspace boundaries, `work_id` ownership, input bounds, cancellation, approvals, and destructive-operation protections whether or not the client loads the workflow skill.

| Tool | Purpose and actions |
| --- | --- |
| `relai_work` | Work lifecycle: `begin`, `status`, `finish`, `cancel`. |
| `relai_snapshot` | Bounded repository and workspace snapshot. |
| `relai_read` | Bounded file, range, and directory reads. |
| `relai_search` | `text` and private local `semantic` search. |
| `relai_inspect` | `symbol`, `references`, `related`, `impact`, `trace`, `diagnostics`. |
| `relai_edit` | Exact replacement, full-file, patch, batch, environment, and staged edits. |
| `relai_exec` | One bounded one-shot workspace command. |
| `relai_process` | Persistent service, watcher, or interactive process `start`, `read`, `write`, `stop`, `list`; start requires `kind` and `purpose`, and list is active-only by default. |
| `relai_worktree` | Managed worktree `create`, `list`, `remove`. |
| `relai_validate` | Validation `checks`, structured `diagnostics`, and local `http` probes. |
| `relai_changes` | `diff`, `restore`, `reset`, `tidy_plan`, `tidy_run`. |
| `relai_publish` | `commit`, `push`, and local `draft_pr` generation. |

The public surface is understandable and safe without packaged skills. Skills add progressively disclosed workflow guidance only in hosts that support and load them; server-side ownership, approvals, limits, Task negotiation, and destructive safeguards remain authoritative.

There is no `toolProfile` configuration option. Every installation exposes the same complete 12-tool surface; old direct tool names still fail closed. Exact action fields and action-level execution metadata are available through `relai://server/tool-surface`. See [docs/PLUGIN.md](docs/PLUGIN.md).

---

## Workspace context policy

Each workspace can define the size and shape of its initial repository map:

```json
{
  "context": {
    "snapshotMaxFiles": 3000,
    "includeRoots": [],
    "excludePaths": [".git", "node_modules", "build", "dist", "coverage"]
  }
}
```

Use `.relaiignore` in a repo to add repo-specific AI-context exclusions.

The snapshot is only a structural map. It does not restrict `relai_search` or direct `relai_read` calls: ChatGPT may continue locating and reading any relevant non-sensitive file inside the configured workspace. The default map contains up to 3,000 files while generated and cache directories remain excluded.

The runtime roadmap is in [docs/CHATGPT_CODING_RUNTIME_ROADMAP.md](docs/CHATGPT_CODING_RUNTIME_ROADMAP.md). The current build includes repository context, live and hybrid code intelligence, one-shot and persistent commands, project instructions, managed worktrees, native MCP Tasks interoperability on HTTP and stdio, signed validation plans, structured diagnostics, multi-round-trip approvals, resource caching, and optional OpenTelemetry export. Independent model workers remain deferred.

---

## Work sessions, native Tasks, and managed processes

A repository work session (`work_id`) groups one objective across multiple Rel.AI tool calls. A native MCP Task (`taskId`) represents one asynchronous MCP operation. A managed process (`processId`) represents one operating-system process and may continue after its startup task completes.

Both HTTP and stdio advertise native Tasks support. A native task handle is returned only when the current request advertises `io.modelcontextprotocol/tasks`; otherwise eligible work uses bounded synchronous execution. Rel.AI does not silently turn a long one-shot command into a managed process or asynchronous job. Persistent services, watchers, and interactive programs use `relai_process`; one-shot tests, builds, checks, and release gates use `relai_exec` or `relai_validate`. A completed process-startup Task does not stop its running process.

See [docs/NATIVE_TASKS_RELEASE_GATE.md](docs/NATIVE_TASKS_RELEASE_GATE.md) for the capability matrix, diagnostics, lifecycle rules, and release gate.

---

## Validation check behavior

Use `relai_exec` for development setup and tooling:

```json
{ "workspace": "myapp", "work_id": "<task-id>", "command": "npm install", "cwd": ".", "timeoutMs": 600000 }
```

A nonzero command exit is returned normally with `ok:false`, preserving compiler or test output. Command calls invalidate the workspace read cache and report files whose Git status changed. Environment values are never copied into audit records; only environment key names are retained.

`relai_exec` does not count as final validation, even when it runs a test command. After the last relevant mutation, use `relai_validate` action `checks`. Pass `complete:true` with `summary` on the final validation to close atomically, or validate without completion when a read-only review must follow.

Persistent services, watchers, and interactive programs use `relai_process` with an explicit `kind` and `purpose`; isolated branches use `relai_worktree`; and `relai_validate` action `checks` performs change-aware validation planning internally. Process listing returns active records by default, while `includeTerminal:true` exposes recent history. Process reads support `metadataRevision` so repeated polling can omit unchanged metadata. These handles are explicit and survive the stateless protocol boundary.

`relai_validate` action `checks` can run explicit validation checks inside configured workspaces:

```json
{ "workspace": "jjclover", "work_id": "<task-id>", "checks": ["flutter analyze", "flutter test"] }
```

```json
{ "workspace": "rel-ai-mcp", "work_id": "<task-id>", "checksText": "npm run check\nnpm run test:compat" }
```

If no check is provided, it auto-detects sensible validation checks for the workspace.

Atomic final validation and completion:

```json
{ "workspace": "rel-ai-mcp", "work_id": "<task-id>", "level": "standard", "complete": true, "summary": "Implemented and validated the requested changes." }
```

`complete:true` is an explicit completion signal, not automatic behavior. It requires `summary` and closes the session only when every selected validation command passes. Validation depth is chosen with a `level` preset: `quick` (syntax / lightweight checks), `standard` (normal project validation, the default), or `release` (full release gate). `relai_edit` accepts the same `level` alongside `runChecks: true`.

---

## Tool selection guide

Use this guide together with the `writeGuidance` returned by `relai_snapshot` and `relai_read`.

| Situation | Use |
| --- | --- |
| Start an independent objective | `relai_work` action `begin`; use its bootstrap, retain its workspace-bound `work_id`, and pass the ID on every later task-scoped call |
| Need a refreshed repository overview | `relai_snapshot` with the same `work_id`; the bound workspace may be omitted |
| Locate code by content | `relai_search`; default auto mode includes bounded prioritized source when useful. Use `mode:"compact"` for inventory-only output or `mode:"context"` for fixed caller-controlled context limits. |
| Trace a symbol, callers, importers, impact, or affected tests | `relai_inspect` with the appropriate action |
| Need focused file content | `relai_read`; add `startLine` / `endLine` for large files, or `ranges` for several files at once |
| Small localized edit inside an existing file | `relai_edit` with `oldText`/`newText` |
| Complete replacement of a file (any size) | `relai_edit` with `content` |
| Multi-file patch-shaped change | `relai_edit` with `updateText` |
| Several edits in one approval | `relai_edit` with `edits: [...]` |
| Tidy session-created files | `relai_changes` action `tidy_plan`, then `tidy_run` |
| Install dependencies, run migrations, tests, builds, linters, release gates, or other one-shot tooling | `relai_exec` or `relai_validate`; never use a managed process for work expected to terminate with one result |
| Run work that may exceed bounded synchronous execution | Call the normal eligible one-shot tool. Hosts advertising `io.modelcontextprotocol/tasks` may receive a native Task and use MCP `tasks/get`, `tasks/update`, and `tasks/cancel`; without Tasks, the bounded call fails rather than becoming a fake persistent service. |
| Validate and finish atomically | `relai_validate` action `checks` with the task's `work_id`, `complete:true`, and `summary` |
| Finish after a post-validation read-only review | `relai_work` action `finish` with the same `work_id` after the final successful validation and review |
| Start a persistent service, watcher, or interactive program | `relai_process` action `start` with `kind` and `purpose`; use byte offsets and `metadataRevision` for incremental reads |
| Probe a local HTTP route | `relai_validate` action `http`; this action is bounded synchronous and is not native-Task eligible |
| Run a declared UI/browser validation script | `relai_validate` action `checks` with the exact package script command |
| Read workspace and repository state | `relai_work` action `status` |
| Review file changes | `relai_changes` action `diff` |
| Restore listed tracked paths only | `relai_changes` action `restore` |
| Reset all tracked workspace changes | `relai_changes` action `reset` with `confirmation:"RESET"` |
| Reset tracked changes and remove all untracked files | `relai_changes` action `reset` with `removeUntracked:true` and `confirmation:"RESET_AND_CLEAN"` |
| Prepare local pull-request text | `relai_publish` action `draft_pr` |

Common loop when every stage is useful:

```text
relai_work begin -> inspect -> read -> change -> relai_validate checks (same work_id, complete:true + summary)
```

Alternative when review must follow validation:

```text
relai_work begin -> inspect -> read -> change -> relai_validate checks -> relai_changes diff / relai_work status -> relai_work finish (same work_id throughout)
```

Adaptive search requires no mode field: `{ "work_id": "<task-id>", "pattern": "getDepartments" }`. Up to 20 matches use the focused tier, 21–100 use the moderate tier, and broader searches use smaller bounded context. Auto mode prioritizes files whose paths resemble the query and files with more retained matches. Results remain grouped by file, overlapping ranges are merged, and each contextual file includes a SHA-256 hash.

Use `{ "mode": "compact" }` for the original path/line-only response. Use `{ "mode": "context", "contextBefore": 5, "contextAfter": 8, "maxBytes": 131072 }` when exact caller-controlled context is required. Supplying context options without a mode also retains explicit context behavior for compatibility. Use `groupByFile:false` for flat ranges or `mergeOverlaps:false` to retain one range per match.

For large files, request only the relevant lines when possible, for example `{ "work_id": "<task-id>", "paths": ["src/server.js"], "startLine": 120, "endLine": 220 }`.

`startLine`/`endLine` apply to every path in the batch. When several files need different windows, pass `ranges` instead of making one call per file:

```json
{
  "workspace": "myapp",
  "work_id": "<task-id>",
  "paths": ["src/server.js", "src/routes.js"],
  "ranges": [
    { "path": "src/server.js", "startLine": 120, "endLine": 220 },
    { "path": "src/routes.js", "startLine": 1, "endLine": 40 }
  ]
}
```

A path with no `ranges` entry falls back to the batch-wide `startLine`/`endLine`, or to the whole file when neither is set. Connector reads use compact guidance by default; pass `guidanceMode: "none"` when only content and metadata are needed.

For large or interpolation-heavy files, prefer `relai_edit` with `oldText`/`newText` for focused edits. Use `content` only when the entire file genuinely needs replacement. For multi-file patch-shaped changes or tracked-file deletion, use `relai_edit` with `updateText`.

---

## Full-file write behavior

`relai_edit` accepts complete file content, exact replacements with optional `occurrence`, replacement arrays, patch-shaped `updateText`, and atomic edit batches. Use `relai_changes` actions `tidy_plan` and `tidy_run` to clean up session-created files.

Small full-file write:

```json
{
  "workspace": "myapp",
  "work_id": "<task-id>",
  "path": "src/example.ts",
  "content": "export const ok = true;\n"
}
```

Large complete-file write through the same tool:

```json
{ "workspace": "myapp", "work_id": "<task-id>", "stage": "start", "path": "src/big.ts", "content": "first chunk" }
{ "workspace": "myapp", "work_id": "<task-id>", "stage": "append", "writeId": "...", "content": "next chunk" }
{ "workspace": "myapp", "work_id": "<task-id>", "stage": "commit", "writeId": "..." }
```

Preferred localized edit inside a large or interpolation-heavy source file:

```json
{
  "workspace": "myapp",
  "work_id": "<task-id>",
  "path": "lib/sms_handler_utils.dart",
  "expectedSha256": "sha-from-relai-read",
  "oldText": "exact current text block",
  "newText": "exact replacement text block"
}
```

Tracked-file deletion uses a structured patch through `relai_edit`:

```text
*** Begin Patch
*** Delete File: docs/old-plan.md
*** End Patch
```

Caller-selected untracked artifacts created during the current session are removed through `relai_changes` actions `tidy_plan` and `tidy_run`. Whole-workspace untracked cleanup exists only in `relai_changes` action `reset` and requires the literal `RESET_AND_CLEAN` confirmation.

For long, large, or interpolation-heavy source files, use `relai_edit` with exact replacement fields for localized changes. Use `relai_edit` with `content` only when the whole file genuinely needs replacement; large content stages automatically, and explicit stage start/append/commit is available for transport chunking. If a multiline source file is accidentally collapsed into one long line, the edit is rejected instead of damaging formatting.

---

## Compatibility test aliases

The package keeps only active workflow test aliases:

```bash
npm run test:compat
npm run test:public-workflow
npm run test:connector-wording
```

`test:compat` confirms removed legacy tools stay rejected. `test:public-workflow` runs the current bridge workflow smoke test. `test:connector-wording` checks connector-facing wording so tool copy stays neutral and workflow-oriented. No CI screenshot belongs in the README; the README should show the product, not a failed run.

---

## Design notes

Rel.AI MCP is intentionally opinionated now.

- One normal workflow is better than five fallback workflows that fail differently.
- Full-file writes are easier to reason about than hidden mini-updates.
- Verification should be visible and repeatable.
- Public tunnel setup should be easy, but local-only should stay the default.
- The dashboard should explain what is happening instead of hiding everything in logs.
- Browser UI source is ESM-only; backend and Electron CommonJS may only decrease until the coordinated hard cutover described in [docs/ESM_MIGRATION.md](docs/ESM_MIGRATION.md).
- Node.js 24, npm 11, exact Electron/MCP pins, and the two-lockfile install flow are defined in [docs/PACKAGE_MANAGEMENT.md](docs/PACKAGE_MANAGEMENT.md).

---

## Developer

Rel.AI MCP is developed by [Kyne](https://github.com/Kyne0328).
