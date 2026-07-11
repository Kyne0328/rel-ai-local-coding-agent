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
relai_repo_snapshot -> relai_read -> relai_edit (replace/write/patch/batch) -> relai_run_checks -> relai_diff -> relai_restore_changes / relai_tidy_plan + relai_tidy_run
```

No generated Python edit scripts. No update-helper maze. No local-edit fallback loops. The MCP server exposes one 16-tool workspace surface across local and connector transports.

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

It is built around the practical flow I kept needing:

```text
I describe the coding task
ChatGPT reasons about it
Rel.AI MCP gives it only the repo access it asks for
ChatGPT edits through exact replacements or full-file writes
Rel.AI MCP runs tests
I inspect the diff
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

Workspace cards show detected checks, workspace scope settings, protected branches, preflight actions, rename, and clear controls.

### Activity

<p align="center">
  <img src="docs/images/dashboard-activity-section.png" alt="Rel.AI MCP activity table" width="900">
</p>

The activity page is there because I got tired of guessing what the MCP server was doing. It shows recent tool calls, workspace, status, and expandable detail rows.

### Tools

<p align="center">
  <img src="docs/images/dashboard-tools-section.png" alt="Rel.AI MCP bridge tools" width="900">
</p>

The dashboard shows the 16 workspace tools ChatGPT can use for inspection, editing, validation, review, Git publishing, tidy, and restore workflows.

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

```bash
npm install
```

Run the local MCP server:

```bash
npm run oneclick
```

Run tests:

```bash
npm test
npm run test:compat
npm run test:http
npm run test:tunnel
npm run test:oneclick
```

---

## One-click server and public tunnel

Three commands cover every case — pick one:

```bash
npm run oneclick                                              # local dashboard / dev (no public URL)
npm run oneclick -- --public                                  # temporary ChatGPT connector (auto tunnel)
npm run oneclick -- --public-url https://your-domain.example  # permanent ChatGPT connector
```

The dashboard connector page prints the final ChatGPT MCP URL.

### Choosing a tunnel provider

The auto tunnel tries Cloudflare, ngrok, then localtunnel. To pick one explicitly:

```bash
npm run oneclick -- --public ngrok
npm run oneclick -- --public cloudflare
npm run oneclick -- --public localtunnel
```

Shortcut flags (`--ngrok`, `--cloudflare`, `--localtunnel`) work too. For any other provider, pass a custom command that prints a public `https://` URL:

```bash
npm run oneclick -- --tunnel custom --tunnel-command "your-tunnel http://127.0.0.1:3333"
```

See [docs/ONE_CLICK_SETUP.md](docs/ONE_CLICK_SETUP.md) for permanent-tunnel options (Cloudflare Tunnel, Tailscale Funnel, static ngrok domains).

---

## ChatGPT connector setup

1. Start the server with `npm run oneclick` or a public tunnel command.
2. Open the dashboard.
3. Go to **Settings > Apps > Create**.
4. Copy the MCP URL.
5. In ChatGPT, add it as an MCP connector.
6. Set authentication to **OAuth**. ChatGPT opens a sign-in page — enter your Rel.AI dashboard token (`REL_AI_MCP_TOKEN`) to approve.

## MCP tools

Rel.AI exposes one 16-tool workspace surface. `relai_edit` is the primary write path: it routes to exact replacement, full-file write, structured patch application, or a batch of edits server-side, and can validate and return a diff in the same call. Tracked-file deletion is supported through structured `Delete File` patches. Untracked cleanup uses the two-step `relai_tidy_plan` / `relai_tidy_run` workflow, where the server selects bounded session-owned candidates and verifies them again before deletion.

| Tool | Purpose |
| --- | --- |
| `relai_repo_snapshot` | Return a filtered project snapshot, manifests, discovered checks, context hints, and size-based write guidance. |
| `relai_read` | Read focused files or directory summaries and return file-level write guidance. |
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
| Need focused file content | `relai_read` |
| Small localized edit inside an existing file | `relai_edit` with `oldText`/`newText` |
| Complete replacement of a file (any size) | `relai_edit` with `content` |
| Multi-file patch-shaped change | `relai_edit` with `updateText` |
| Several edits in one approval | `relai_edit` with `edits: [...]` |
| Tidy session-created files | `relai_tidy_plan` then `relai_tidy_run` |
| Run validation | `relai_run_checks` |
| Browser or UI route check | `relai_browser` |
| Review changes | `relai_diff` |
| Restore selected changes | `relai_restore_changes` |

Typical loop:

```text
inspect -> read -> change -> validate -> review -> restore only if needed
```

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
