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
relai_start_task -> relai_repo_snapshot (when useful) -> relai_search / relai_code_inspect -> relai_read -> relai_edit -> relai_run_checks (complete:true + summary)
```

No generated Python edit scripts. No update-helper maze. No local-edit fallback loops. The MCP server exposes 20 callable workspace tools across local and connector transports, all active. `relai_code_inspect` adds live symbol, reference, impact, affected-test, and diagnostics-readiness analysis without a stale background index.

When ChatGPT first edits a workspace, the server starts a session and records the pre-edit state, so later status/diff output can separate the files this session changed from files that were already modified. The session expires after a period of inactivity.

Rel.AI MCP still lightly nods to the original Rel.AI idea, but this README stands on its own: this is now a local MCP bridge for ChatGPT.

### Repository-specific instructions

Rel.AI automatically includes project guidance in repository snapshots when either of these files exists:

```text
REL_AI.md
.relai/instructions.md
```

`REL_AI.md` has higher precedence. When both files exist, their content is returned with named headings and explicit source order. The combined connector payload is capped at 64 KiB; when it is truncated, ChatGPT can read either source directly with `relai_read`. Binary-looking files, symbolic links, and paths that escape the workspace are rejected. The content is guidance only and is never executed automatically.

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
- load repository-specific guidance from `REL_AI.md` and `.relai/instructions.md`
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

The dashboard shows the current workspace tool surface for inspection, one-shot commands, editing, validation, explicit completion reporting, review, Git publishing, tidy, restore, and compatibility workflows.

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

Rel.AI MCP is a self-contained Windows desktop app. Download the latest installer from the [Releases page](https://github.com/Kyne0328/rel-ai-mcp/releases) and run it. The standard setup wizard lets you install for the current user or for all users, review the destination folder, and click **Install**. Selecting **all users** requests Windows administrator approval when the installer is not already elevated. The Finish page includes an optional **Run Rel.AI MCP** checkbox, enabled by default.

You do **not** need to install Node.js, npm, or ngrok. The app ships its own runtime and its own ngrok agent, and it keeps that agent updated on its own.

The one thing it cannot create for you is an ngrok account. Before first launch, sign up at [ngrok.com](https://ngrok.com) (the free tier is enough) and grab two things:

- your **authtoken**, from the ngrok dashboard
- a **static domain**, from **Domains** in the same dashboard

The setup wizard asks for both on first run, stores them locally, and starts the server and tunnel for you. Every launch after that goes straight to the dashboard.

The app lives in the system tray. Closing a window leaves it running; quit it from the tray menu.

Installed Windows builds check for application updates once per day. Downloads and restart-to-install are always explicit from **Settings > General** or the tray, and restart is blocked while a Rel.AI tool call is active. Portable builds update manually from the Releases page.

The installed Windows app can also enable **Launch at sign-in** under **Settings > General**. Sign-in launches run in the background so the tray, local service, and public endpoint are ready without opening the dashboard; ordinary launches remain dashboard-first. Portable builds do not register Windows startup entries.

---

## Connecting to ChatGPT

1. Launch Rel.AI MCP and let the wizard finish. The tray icon turns active once the tunnel is up.
2. Open the dashboard and go to the **Connection** page. It shows your MCP URL.
3. In ChatGPT, go to **Settings > Apps > Create** and paste that URL.
4. Set authentication to **OAuth**. ChatGPT opens a sign-in page — enter your Rel.AI approval token to approve.

The approval token is under **Settings > Connection**. Replacing it requires typing `REPLACE`; Rel.AI revokes current OAuth access and refresh tokens, preserves the MCP endpoint and existing ChatGPT app registration, then marks ChatGPT as requiring approval again.

Because the domain is static, the connector keeps working across restarts. You configure it once.

See [docs/ONE_CLICK_SETUP.md](docs/ONE_CLICK_SETUP.md) for the full setup walkthrough, and [docs/CONNECTING_TO_CHATGPT.md](docs/CONNECTING_TO_CHATGPT.md) for connector troubleshooting.

---

## The dashboard

**Open dashboard** shows the full dashboard inside a secured Electron window. The same dashboard is also reachable in a normal browser at the local `/dashboard` route; Electron is the default host, not a separate implementation. The desktop host exchanges a single-use bootstrap code for an HttpOnly local session cookie, so the long-lived approval token is never stored in the embedded renderer or left in its URL.

The dashboard includes grouped **Sessions**, lower-level **Activity**, workspace-scoped filtering, operational Git and validation state, actionable diagnostics, live/reconnecting status, and persistent desktop window and route state. Work is grouped by explicit logical `task_id`, not by MCP connection, repository, or assumed ChatGPT conversation identity. Multiple tasks may share one client connection while retaining independent activity and completion state. A task is marked completed only after an explicit completion signal: either `relai_run_checks` with `complete:true` and `summary`, or `relai_complete_task` after a post-validation read-only review. Otherwise inactivity closes it as inactive without claiming the overall request finished.

---

## Building from source

Only needed if you want to develop or package the app yourself. Requires Node.js 22.13 or newer; CI tests the Node.js 22 and 24 LTS lines.

```bash
npm install
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
npm test                     # full suite
```

`electron:build` and `electron:dist` refuse to run when the ngrok seed is missing — packaging without it produces an installer whose tunnel cannot start.

Windows CI and the release workflow build the unpacked application and run `npm run verify:packaged`, a read-only package-layout check. Installer, uninstall, first-run UI, real ngrok publication, ChatGPT OAuth, live approval-token rotation, and update-from-prior-release behavior are verified manually on a disposable Windows machine. See [docs/USABILITY_ACCEPTANCE.md](docs/USABILITY_ACCEPTANCE.md) and [docs/INSTALLER_TEST_SAFETY.md](docs/INSTALLER_TEST_SAFETY.md).

## MCP tools

Rel.AI exposes 20 callable workspace tools, all active. The six compatibility tools were removed in tool-surface version 10. `relai_edit` is the single file-change tool. Start each independent objective with `relai_start_task`, retain the returned opaque `task_id`, and pass it on every later call for that task. Task completion is explicit: final validation can close the logical task atomically with `complete:true` and `summary`, while `relai_complete_task` remains available after post-validation read-only review.

| Tool | Purpose |
| --- | --- |
| `relai_start_task` | Create an independent logical task and return an opaque `task_id`; pass it on subsequent calls for that task. |
| `relai_repo_snapshot` | Return a filtered project snapshot, manifests, discovered checks, context hints, and size-based write guidance. |
| `relai_read` | Read focused files or directory summaries. Optional `startLine`/`endLine` returns only the needed line range; `guidanceMode` controls full, compact, or omitted write guidance. |
| `relai_search` | Search workspace files for a pattern. Adaptive `auto` mode is the default: focused searches receive broader context and noisy searches receive smaller prioritized ranges. Explicit `compact` and `context` modes remain available. |
| `relai_code_inspect` | Build a fingerprint-invalidated live code index for symbol definitions, references and calls, structural related-file ranking, reverse-import impact, affected tests, and diagnostic-command readiness. |
| `relai_exec` | Run a one-shot development command in a workspace-relative directory. Returns exit status, separate bounded stdout/stderr, timing, timeout state, and detected Git-status changes. |
| `relai_edit` | The primary edit tool. Pass `oldText`+`newText` for exact edits, `content` for full-file writes (large files chunk automatically), `updateText` for unified-diff changes, or `edits: [...]` for a batch — plus `runChecks` / `returnDiff` to validate and review in one call. |
| `relai_tidy_plan` | Read-only. Prepare a bounded tidy plan of session-owned untracked artifacts (server selects candidates). |
| `relai_tidy_run` | Apply a prepared tidy plan by `planId` (expiry-bound and hash-checked before any change). |
| `relai_run_checks` | Run detected or requested validation checks. On final validation, `complete:true` with `summary` validates and closes the task atomically only when every selected check passes. |
| `relai_http_probe` | Probe a local Rel.AI route such as `/health` or `/dashboard`; arbitrary URLs are rejected. |
| `relai_ui_check` | Run one declared `package.json` script intended for UI or browser validation. |
| `relai_diff` | Review git status and diff. |
| `relai_restore_paths` | Restore only listed tracked paths from `HEAD`; unrelated and untracked files are untouched. |
| `relai_reset_workspace` | Reset all tracked changes with explicit `RESET` confirmation; optional untracked cleanup requires `RESET_AND_CLEAN`. |
| `relai_status` | Workspace and repository status. With `workspace`, returns command configuration, session policy, branch, ahead/behind counts, ownership-split changes, and untracked-file state under `workspace.repository`. |
| `relai_git_commit` | Record a commit with an explicit message (refuses secret-looking staged files). |
| `relai_git_push` | Publish a branch to an allowlisted remote. |
| `relai_git_draft_pr` | Prepare a local pull-request title/body from a base/head diff without contacting a hosting provider or changing the remote. |
| `relai_complete_task` | Explicitly close the exact validated `task_id` after any final read-only review when completion was not requested on `relai_run_checks`. Rejects missing task-scoped validation, later task changes, or changes made to the shared workspace by another task after validation. Duplicate retries return the original completion idempotently. |

Removed workflows are not part of the MCP anymore: update application loops, generated update helpers, local-edit tools, task runners, multi-agent schedulers, Docker runners, and PR/CI repair loops.

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

The runtime roadmap is in [docs/CHATGPT_CODING_RUNTIME_ROADMAP.md](docs/CHATGPT_CODING_RUNTIME_ROADMAP.md). The current build includes repository context, live code-intelligence analysis, one-shot commands, and project instructions; persistent processes, managed worktrees, task plans, and independent workers are deferred.

---

## Validation check behavior

Use `relai_exec` for development setup and tooling:

```json
{ "workspace": "myapp", "task_id": "<task-id>", "command": "npm install", "cwd": ".", "timeoutMs": 600000 }
```

A nonzero command exit is returned normally with `ok:false`, preserving compiler or test output. Command calls invalidate the workspace read cache and report files whose Git status changed. Environment values are never copied into audit records; only environment key names are retained.

`relai_exec` does not count as final validation, even when it runs a test command. After the last relevant mutation, use `relai_run_checks`. Pass `complete:true` with `summary` on the final validation to close atomically, or validate without completion when a read-only review must follow.

Persistent process management, managed worktrees, and persistent task plans are deferred and are not exposed by this build.

`relai_run_checks` can run explicit validation checks inside configured workspaces:

```json
{ "workspace": "jjclover", "task_id": "<task-id>", "checks": ["flutter analyze", "flutter test"] }
```

```json
{ "workspace": "rel-ai-mcp", "task_id": "<task-id>", "checksText": "npm run check\nnpm run test:compat" }
```

If no check is provided, it auto-detects sensible validation checks for the workspace.

Atomic final validation and completion:

```json
{ "workspace": "rel-ai-mcp", "task_id": "<task-id>", "level": "standard", "complete": true, "summary": "Implemented and validated the requested changes." }
```

`complete:true` is an explicit completion signal, not automatic behavior. It requires `summary` and closes the session only when every selected validation command passes. Validation depth is chosen with a `level` preset: `quick` (syntax / lightweight checks), `standard` (normal project validation, the default), or `release` (full release gate). `relai_edit` accepts the same `level` alongside `runChecks: true`.

---

## Tool selection guide

Use this guide together with the `writeGuidance` returned by `relai_repo_snapshot` and `relai_read`.

| Situation | Use |
| --- | --- |
| Start an independent objective | `relai_start_task`; retain its `task_id` and pass it on every later call for that objective |
| Need a repository overview | `relai_repo_snapshot` with the same `task_id` |
| Locate code by content | `relai_search`; default auto mode includes bounded prioritized source when useful. Use `mode:"compact"` for inventory-only output or `mode:"context"` for fixed caller-controlled context limits. |
| Trace a symbol, callers, importers, impact, or affected tests | `relai_code_inspect` |
| Need focused file content | `relai_read`; add `startLine` / `endLine` for large files |
| Small localized edit inside an existing file | `relai_edit` with `oldText`/`newText` |
| Complete replacement of a file (any size) | `relai_edit` with `content` |
| Multi-file patch-shaped change | `relai_edit` with `updateText` |
| Several edits in one approval | `relai_edit` with `edits: [...]` |
| Tidy session-created files | `relai_tidy_plan` then `relai_tidy_run` |
| Install dependencies, run migrations, or invoke repository tooling | `relai_exec` |
| Validate and finish atomically | `relai_run_checks` with the task's `task_id`, `complete:true`, and `summary` |
| Finish after a post-validation read-only review | `relai_complete_task` with the same `task_id` after the final successful validation and review |
| Probe a local HTTP route | `relai_http_probe` |
| Run a declared UI/browser validation script | `relai_ui_check` |
| Read workspace and repository state | `relai_status` with `workspace` |
| Review file changes | `relai_diff` |
| Restore listed tracked paths only | `relai_restore_paths` |
| Reset all tracked workspace changes | `relai_reset_workspace` with `confirmation:"RESET"` |
| Reset tracked changes and remove all untracked files | `relai_reset_workspace` with `removeUntracked:true` and `confirmation:"RESET_AND_CLEAN"` |
| Prepare local pull-request text | `relai_git_draft_pr` |

Common loop when every stage is useful:

```text
relai_start_task -> inspect -> read -> change -> relai_run_checks (same task_id, complete:true + summary)
```

Alternative when review must follow validation:

```text
relai_start_task -> inspect -> read -> change -> relai_run_checks -> relai_diff / relai_status -> relai_complete_task (same task_id throughout)
```

Adaptive search requires no mode field: `{ "workspace": "myapp", "task_id": "<task-id>", "pattern": "getDepartments" }`. Up to 20 matches use the focused tier, 21–100 use the moderate tier, and broader searches use smaller bounded context. Auto mode prioritizes files whose paths resemble the query and files with more retained matches. Results remain grouped by file, overlapping ranges are merged, and each contextual file includes a SHA-256 hash.

Use `{ "mode": "compact" }` for the original path/line-only response. Use `{ "mode": "context", "contextBefore": 5, "contextAfter": 8, "maxBytes": 131072 }` when exact caller-controlled context is required. Supplying context options without a mode also retains explicit context behavior for compatibility. Use `groupByFile:false` for flat ranges or `mergeOverlaps:false` to retain one range per match.

For large files, request only the relevant lines when possible, for example `{ "workspace": "myapp", "task_id": "<task-id>", "paths": ["src/server.js"], "startLine": 120, "endLine": 220 }`. Connector reads use compact guidance by default; pass `guidanceMode: "none"` when only content and metadata are needed.

For large or interpolation-heavy files, prefer `relai_edit` with `oldText`/`newText` for focused edits. Use `content` only when the entire file genuinely needs replacement. For multi-file patch-shaped changes or tracked-file deletion, use `relai_edit` with `updateText`.

---

## Full-file write behavior

`relai_edit` accepts complete file content, exact replacements with optional `occurrence`, replacement arrays, patch-shaped `updateText`, and atomic edit batches. Use `relai_tidy_plan` / `relai_tidy_run` to clean up session-created files.

Small full-file write:

```json
{
  "workspace": "myapp",
  "task_id": "<task-id>",
  "path": "src/example.ts",
  "content": "export const ok = true;\n"
}
```

Large complete-file write through the same tool:

```json
{ "workspace": "myapp", "task_id": "<task-id>", "stage": "start", "path": "src/big.ts", "content": "first chunk" }
{ "workspace": "myapp", "task_id": "<task-id>", "stage": "append", "writeId": "...", "content": "next chunk" }
{ "workspace": "myapp", "task_id": "<task-id>", "stage": "commit", "writeId": "..." }
```

Preferred localized edit inside a large or interpolation-heavy source file:

```json
{
  "workspace": "myapp",
  "task_id": "<task-id>",
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

Caller-selected untracked artifacts created during the current session are removed through `relai_tidy_plan` followed by `relai_tidy_run`. Whole-workspace untracked cleanup exists only in `relai_reset_workspace` and requires the literal `RESET_AND_CLEAN` confirmation.

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

---

## Developer

Rel.AI MCP is developed by [Kyne](https://github.com/Kyne0328).
