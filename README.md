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

The ChatGPT workflow is intentionally small and predictable:

```text
relai_repo_snapshot -> relai_search -> relai_read (line ranges) -> relai_edit (runChecks + returnDiff) -> relai_complete_task
```

No generated Python edit scripts. No update-helper maze. No local-edit fallback loops. The MCP server exposes one 18-tool workspace surface across local and connector transports.

When ChatGPT first edits a workspace, the server starts a session and records the pre-edit state, so later status/diff output can separate the files this session changed from files that were already modified. The session expires after a period of inactivity.

Rel.AI MCP still lightly nods to the original Rel.AI idea, but this README stands on its own: this is now a local MCP bridge for ChatGPT.

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

The dashboard shows the 18 workspace tools ChatGPT can use for inspection, editing, validation, explicit completion reporting, review, Git publishing, tidy, and restore workflows.

### Connector setup

<p align="center">
  <img src="docs/images/dashboard-connector-section.png" alt="Rel.AI MCP connector URL" width="900">
</p>

The connector page shows the MCP URL for ChatGPT. It supports local URLs and public URLs from one-click tunnel setup.

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

### Full connector

<p align="center">
  <img src="docs/images/dashboard-connector.png" alt="Rel.AI MCP full connector page" width="900">
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

Rel.AI MCP is a self-contained Windows desktop app. Download the latest installer from the [Releases page](https://github.com/Kyne0328/rel-ai-mcp/releases) and run it.

You do **not** need to install Node.js, npm, or ngrok. The app ships its own runtime and its own ngrok agent, and it keeps that agent updated on its own.

The one thing it cannot create for you is an ngrok account. Before first launch, sign up at [ngrok.com](https://ngrok.com) (the free tier is enough) and grab two things:

- your **authtoken**, from the ngrok dashboard
- a **static domain**, from **Domains** in the same dashboard

The setup wizard asks for both on first run, stores them locally, and starts the server and tunnel for you. Every launch after that goes straight to the dashboard.

The app lives in the system tray. Closing a window leaves it running; quit it from the tray menu.

---

## Connecting to ChatGPT

1. Launch Rel.AI MCP and let the wizard finish. The tray icon turns active once the tunnel is up.
2. Open the dashboard and go to the **Connector** page. It shows your MCP URL.
3. In ChatGPT, go to **Settings > Apps > Create** and paste that URL.
4. Set authentication to **OAuth**. ChatGPT opens a sign-in page — enter your Rel.AI dashboard token to approve.

Because the domain is static, the connector keeps working across restarts. You configure it once.

See [docs/ONE_CLICK_SETUP.md](docs/ONE_CLICK_SETUP.md) for the full setup walkthrough, and [docs/CONNECTING_TO_CHATGPT.md](docs/CONNECTING_TO_CHATGPT.md) for connector troubleshooting.

---

## The dashboard

**Open dashboard** shows the full dashboard inside a secured Electron window. The same dashboard is also reachable in a normal browser at the local `/dashboard` route; Electron is the default host, not a separate implementation. The desktop host exchanges a single-use bootstrap code for an HttpOnly local session cookie, so the long-lived dashboard token is never stored in the embedded renderer or left in its URL.

The dashboard includes grouped **Sessions**, a lower-level **Activity log**, workspace-scoped filtering, operational Git and validation state, actionable diagnostics, live/reconnecting status, and persistent desktop window and route state. Session grouping is scoped per MCP connection and supports concurrent ChatGPT work. A session is marked completed only when ChatGPT calls `relai_complete_task`; otherwise inactivity closes it as inactive without claiming the overall request finished.

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

## MCP tools

Rel.AI exposes one 18-tool workspace surface. `relai_edit` is the primary write path: it routes to exact replacement, full-file write, structured patch application, or a batch of edits server-side, and can validate and return a diff in the same call. Tracked-file deletion is supported through structured `Delete File` patches. Untracked cleanup uses the two-step `relai_tidy_plan` / `relai_tidy_run` workflow, where the server selects bounded session-owned candidates and verifies them again before deletion. `relai_complete_task` is the final workflow signal and is accepted only after a passed validation with no later code changes.

| Tool | Purpose |
| --- | --- |
| `relai_repo_snapshot` | Return a filtered project snapshot, manifests, discovered checks, context hints, and size-based write guidance. |
| `relai_read` | Read focused files or directory summaries. Optional `startLine`/`endLine` returns only the needed line range; `guidanceMode` controls full, compact, or omitted write guidance. |
| `relai_search` | Search workspace files for a pattern and return path/line matches. Extended regex by default; `fixed:true` for literal strings, `ignoreCase:true`, and `glob` to narrow scope. |
| `relai_edit` | The primary edit tool. Pass `oldText`+`newText` for exact edits, `content` for full-file writes (large files chunk automatically), `updateText` for unified-diff changes, or `edits: [...]` for a batch — plus `runChecks` / `returnDiff` to validate and review in one call. |
| `relai_write` | Fallback: replace one complete file with full-file content (direct or staged mode). |
| `relai_replace` | Fallback: small exact text replacements inside an existing file. |
| `relai_tidy_plan` | Read-only. Prepare a bounded tidy plan of session-owned untracked artifacts (server selects candidates). |
| `relai_tidy_run` | Apply a prepared tidy plan by `planId` (expiry-bound and hash-checked before any change). |
| `relai_run_checks` | Run detected or requested validation checks. |
| `relai_browser` | Run a browser/UI check or fetch a route. |
| `relai_diff` | Review git status and diff. |
| `relai_restore_changes` | Restore selected workspace changes. |
| `relai_status` | Live status for configured workspaces and scripts. On the ChatGPT connector the result is compacted to workspace state; the full stdio result also lists tool groups and CI references. |
| `relai_git_status` | Branch, ahead/behind, and ownership-split repository state. |
| `relai_git_commit` | Record a commit with an explicit message (refuses secret-looking staged files). |
| `relai_git_push` | Publish a branch to an allowlisted remote. |
| `relai_git_create_pr` | Draft a pull-request title/body from a base/head diff. |
| `relai_complete_task` | Explicitly report that ChatGPT finished the coding task after final validation. Rejects missing validation or code changes made after validation. |

Removed workflows are not part of the MCP anymore: update application loops, generated update helpers, local-edit tools, task runners, isolated worktree orchestration, multi-agent schedulers, Docker runners, and PR/CI repair loops.

---

## Workspace context mode

Each workspace can define how repository context is collected:

```json
{
  "fastTask": {
    "enabled": true,
    "preferChangedFiles": true,
    "skipIndexForSmallTasks": true,
    "maxIndexFiles": 750,
    "includeRoots": [],
    "excludePaths": [".git", "node_modules", "build", "dist", "coverage"]
  }
}
```

Use `.relaiignore` in a repo to add repo-specific AI-context exclusions.

The point is to avoid scanning unrelated files before touching the obvious files.

---

## Validation check behavior

`relai_run_checks` can run explicit validation checks inside configured workspaces:

```json
{ "workspace": "jjclover", "checks": ["flutter analyze", "flutter test"] }
```

```json
{ "workspace": "rel-ai-mcp", "checksText": "npm run check\nnpm run test:compat" }
```

If no check is provided, it auto-detects sensible validation checks for the workspace.

Validation depth is chosen with a `level` preset: `quick` (syntax / lightweight checks), `standard` (normal project validation, the default), or `release` (full release gate). `relai_edit` accepts the same `level` alongside `runChecks: true`.

---

## Tool selection guide

Use this guide together with the `writeGuidance` returned by `relai_repo_snapshot` and `relai_read`.

| Situation | Use |
| --- | --- |
| Need a repository overview | `relai_repo_snapshot` |
| Locate code by content | `relai_search`; then `relai_read` with `startLine` / `endLine` |
| Need focused file content | `relai_read`; add `startLine` / `endLine` for large files |
| Small localized edit inside an existing file | `relai_edit` with `oldText`/`newText` |
| Complete replacement of a file (any size) | `relai_edit` with `content` |
| Multi-file patch-shaped change | `relai_edit` with `updateText` |
| Several edits in one approval | `relai_edit` with `edits: [...]` |
| Tidy session-created files | `relai_tidy_plan` then `relai_tidy_run` |
| Run validation | `relai_run_checks` |
| Report the coding task finished | `relai_complete_task` after the final successful validation |
| Browser or UI route check | `relai_browser` |
| Review changes | `relai_diff` |
| Restore selected changes | `relai_restore_changes` |

Typical loop:

```text
inspect -> read -> change -> final validation -> relai_complete_task
```

For large files, request only the relevant lines when possible, for example `{ "workspace": "myapp", "paths": ["src/server.js"], "startLine": 120, "endLine": 220 }`. Connector reads use compact guidance by default; pass `guidanceMode: "none"` when only content and metadata are needed.

For large or interpolation-heavy files, prefer `relai_edit` with `oldText`/`newText` for focused edits. Use `content` only when the entire file genuinely needs replacement. For multi-file patch-shaped changes or tracked-file deletion, use `relai_edit` with `updateText`.

---

## Full-file write behavior

`relai_write` accepts complete file content only. Use `relai_replace` for localized edits inside existing files and the `relai_tidy_plan` / `relai_tidy_run` workflow to clean up session-created files.

Small full-file write:

```json
{
  "workspace": "myapp",
  "path": "src/example.ts",
  "content": "export const ok = true;\n"
}
```

Large complete-file write through the same tool:

```json
{ "workspace": "myapp", "stage": "start", "path": "src/big.ts", "content": "first chunk" }
{ "workspace": "myapp", "stage": "append", "writeId": "...", "content": "next chunk" }
{ "workspace": "myapp", "stage": "commit", "writeId": "..." }
```

Preferred localized edit inside a large or interpolation-heavy source file:

```json
{
  "workspace": "myapp",
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

Untracked artifacts created during the current session are removed only through `relai_tidy_plan` followed by `relai_tidy_run`.

For long, large, or interpolation-heavy source files, prefer `relai_replace` for small exact edits. Use staged `relai_write` only when the whole file genuinely needs replacement. If a full-file or staged payload is too large, re-read the file and retry with smaller `relai_replace` operations. If a multiline source file is accidentally collapsed into one long line, the write is rejected instead of damaging formatting.

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

## Attribution

Built and maintained by [@Kyne0328](https://github.com/Kyne0328).
