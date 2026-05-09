cat > "/c/Users/Kyne/.claude/plans/audit-and-redesign-the-cheeky-badger-agent-a9f96711c653f4a8b.md" << 'PLANEOF'
# rel-ai-mcp Dashboard — Production-Grade UX Overhaul Plan

Target aesthetic: Linear / Raycast / Vercel / GitHub.
Constraints: vanilla JS, no build step, server-rendered initial HTML, dark-only-first with light-mode tokens reserved.

---

## 1. Executive Summary

1. Extract the 80-line inline `<style>` block at `src/httpServer.js:565-644` plus the 200-line bootstrap script at `src/httpServer.js:775-975` into a static `public/dashboard.css` and `public/dashboard.js`. Server keeps emitting the shell HTML and the token-gated `<script type="application/json" id="initialDashboardData">` payload — no API contract changes, but every other improvement depends on this split.
2. Build a small vanilla component primitive set under `src/ui/` (Button, Modal, Toast, Drawer, Table, Toggle, Pill, Badge, Skeleton, EmptyState, CommandPalette) and a single `tokens.css` with spacing/typography/radius/shadow/z-index scales. Replace the three currently divergent button styles (`button`, `button.secondary`, `button.danger` at `src/httpServer.js:599-605`) with one tokenized component.
3. Replace the brittle four-tab Settings drawer at `src/settingsDashboardClient.js:54-95` with a Linear-style left-rail Settings page that auto-saves per-field with debounced 300ms commits, has explicit `confirmDangerous` typed-phrase modal, and exposes a diff summary before destructive saves.
4. Add a Tool Browser section that lists all 138 MCP tools (verified count from `src/tools.js`, `tool(...)` calls) with category, required permission profile, and gated-by-approval flag — none of which is currently surfaced in any UI.
5. Add `/api/approvals/:id/decision` server route and an inline Approvals card on Overview so the dashboard can flip a request from `pending` to `approved`/`rejected` in one click. Today, the only path to approve is via MCP tool call from ChatGPT — `src/approvals.js:92-122` enforces a request → resolve → retry flow with no HTTP surface.
6. First-run onboarding: detect missing workspaces or stale `connection.profile.json`, render an overlay wizard (welcome → workspace path → permission profile → ChatGPT connector → done). Persist completion in `~/.rel-ai-mcp/onboarding.json`.
7. Activity overhaul: filters (workspace, tool, status, time range), virtualized rows, click-to-detail side drawer, pause-live-tail, animated insert at top — replacing the truncated 12/15/20-row tables at `src/httpServer.js:885`, `src/dashboardClient.js:180`, `src/activityDashboardClient.js:76`.

---

## 2. Critical Usability Issues (Ranked)

### P0 — Blocks core workflows
| # | Issue | Location | Why P0 |
|---|---|---|---|
| 1 | No HTTP route to approve/reject. The 2-step "request → resolve → retry with approvalId" flow is documented in the error string itself (`src/approvals.js:111-113`) and lives only in MCP tools. | `src/approvals.js:92-122`; no matching `/api/approvals*` route in `src/httpServer.js:113-340` | Users see pending approvals in the dashboard but cannot act on them — they must switch to ChatGPT, run another tool, copy an ID, then come back. |
| 2 | 138-tool MCP surface (`src/tools.js`, 138× `tool(...)` calls) is invisible in the UI. No browser, no search. | `src/tools.js:49+` | Users can't discover what's available, what's gated, or what their current profile permits. |
| 3 | First-run experience prints connection summary only to stderr (`src/httpServer.js:58-72`). No in-dashboard onboarding. | `src/httpServer.js:58-72` | New users land on a dashboard that may have zero workspaces and no idea where to copy the ChatGPT URL from. |
| 4 | Settings save has no loading/disabled state, no rollback, no diff preview. `confirmDangerous` is a checkbox easily missed (`src/settingsDashboardClient.js:198`). | `src/settingsDashboardClient.js:265-273, 297-310` | Toggling `allowArbitraryCommands` + uncheck = silent state mismatch on next reload (`postSettings` reloads from server but UI shows "Settings saved" before any error surfaces). |
| 5 | Native `confirm()` for workspace delete (`src/settingsDashboardClient.js:356`). | `src/settingsDashboardClient.js:356` | Inconsistent with rest of UI; not styleable; not focus-trapped. |

### P1 — Significant friction
| # | Issue | Location |
|---|---|---|
| 6 | Hardcoded 15s polling fallback runs even when SSE is connected (`src/httpServer.js:953`). Doubles request volume. | `src/httpServer.js:953` |
| 7 | Token field is `type="password"` with no autocomplete, no visibility toggle, no debounce (`src/httpServer.js:671`). Re-fires on every keystroke via `currentToken()` writes to sessionStorage (`src/httpServer.js:783`). | `src/httpServer.js:671, 783` |
| 8 | `confirm` text "Repo slug" (`src/settingsDashboardClient.js:217`), "docker_readonly_base" (`src/settingsDashboardClient.js:180`), "pr profile" / "admin profile" (`src/dashboardClient.js:145`), and the `Raw` button (`src/httpServer.js:674`) leak implementation jargon. | multiple |
| 9 | Activity rows truncated to 12/15/20 with no expand and no full-message view (`src/httpServer.js:885`, `src/dashboardClient.js:180`, `src/activityDashboardClient.js:76`). `entry.error || entry.message` is rendered into a `truncate` cell with no click-to-open. | three files |
| 10 | Status pills are color-only (`src/httpServer.js:627`, the `.status-pill.ok/.warn/.bad` classes). No `aria-label`, no SR text, no shape difference. | `src/httpServer.js:627` |
| 11 | No focus rings: `input:focus` only changes border (`src/httpServer.js:610`). Buttons have no `:focus-visible` ring at all. | `src/httpServer.js:599-610` |
| 12 | No focus trap, no `role=dialog`, no Esc-close on the Raw panel (`src/httpServer.js:766-771`) or settings drawer (`src/settingsDashboardClient.js:62-77`). | both |
| 13 | Three independent `fetchJson`/`requestJson` implementations: `src/httpServer.js:786`, `src/dashboardClient.js:49`, `src/activityDashboardClient.js:29`, `src/settingsDashboardClient.js:35`. Different error handling, different timeouts (8s vs none). | four files |
| 14 | Three independent token-reading helpers (`src/httpServer.js:783`, `src/dashboardClient.js:30`, `src/settingsDashboardClient.js:18`, `src/activityDashboardClient.js:14`) all writing to the same `sessionStorage` key on every read. | four files |
| 15 | Full re-render on every refresh (`renderDashboard` rebuilds every `innerHTML` at `src/dashboardClient.js:148-204`). Causes scroll jumps and loses `:hover`/focus. | `src/dashboardClient.js:148-204` |

### P2 — Polish
| # | Issue | Location |
|---|---|---|
| 16 | Agent icons are unicode glyphs (`♙ ⌘ ✓ ◆ ◈ ✎ ▰` at `src/httpServer.js:782`); render inconsistently across platforms. | `src/httpServer.js:782` |
| 17 | Mixed font sizes 11/12/13/14/15/20/30px scattered across CSS — no scale (`src/httpServer.js:619-643`). | `src/httpServer.js:619-643` |
| 18 | `render(...)` writes raw payload JSON to `#rawOut` even when raw panel is hidden — wasted serialization on every refresh (`src/httpServer.js:851`, `src/dashboardClient.js:204`). | both |
| 19 | `loadSettings` reloads from server after every save (`src/settingsDashboardClient.js:271-272`) and *also* triggers `window.refresh()` — two full payloads per save. | `src/settingsDashboardClient.js:271-272` |
| 20 | `AGENTS` array duplicated between server-rendered bootstrap (`src/httpServer.js:782`) and `dashboardClient.js:4`. Out of sync — server has 7 with descriptions, client has 7 just names. | both |

---

## 3. UX Redesign Strategy

### Architecture
- **Server stays thin**: `httpServer.js:556-982` becomes a ~150-line shell renderer that emits `<head>` with `<link rel="stylesheet" href="public/dashboard.css">`, the empty layout skeleton, and the `<script type="application/json" id="initialDashboardData">` (preserved). All scripts move to `public/dashboard.js` (entry) and lazy-load section bundles.
- **Client becomes modular**: one entry file imports primitives, mounts router on `hashchange`, mounts SSE handler, debounces token input. Sections are not separate `<script>` tags racing to attach handlers — they are modules invoked when their hash is active.
- **Single fetch layer**: `src/ui/api.js` consolidates the four divergent helpers. Adds: 8s timeout, abort on hash change, retry-on-401 with token prompt, response cache (1s) keyed by URL.
- **Diff-render helper**: a `mount(node, vdomLikeArray)` that compares previous render result and only swaps changed children. Vanilla, no virtual DOM library — keyed by element `id` or `data-key`. Enough to fix the scroll-jump and focus-loss problems.

### Navigation reorganization
**Today** (`src/httpServer.js:651-657` + `src/settingsDashboardClient.js:84-93`):
Overview, Workspaces, Activity, Agents, ChatGPT setup, Diagnostics, Settings (injected by client at runtime).

**Proposed**:
1. **Home** (was Overview) — landing screen, condensed metrics, inline pending approvals, onboarding banner if incomplete.
2. **Workspaces** — full editor (merges current Workspaces card + Settings → Workspaces tab).
3. **Activity** — promoted to top-level with full filters and detail drawer.
4. **Approvals** — promoted out of the 3-column card; standalone section because they are blocking actions.
5. **Tools** — new; the 138-tool browser.
6. **Agents** — kept, but reframed as "what each role is doing right now" with real subtask binding from `data.multiAgent.subtasks`.
7. **Settings** — left-rail sub-nav: General, Permissions, Approval gates, Multi-agent, Releases, Advanced. Connector (was "ChatGPT setup") becomes Settings → Connector.
8. **Diagnostics** — collapsed to Settings → Diagnostics (Session diff, Health monitor, Readiness, Audit tail).

The "Raw" button (`src/httpServer.js:674`) becomes a Cmd-K palette action ("View API response") rather than persistent UI.

### Component system: file layout

Recommend **one file per primitive under `src/ui/`** (not consolidated single file). Reasoning:
- Each primitive is small (50-150 lines). Consolidated `ui.js` would be ~1500 lines — same problem we're solving for `httpServer.js`.
- No build step, but each module is a plain script that adds to a shared `window.RelaiUI` namespace, OR is loaded as `<script type="module">` (Node 18 + modern browsers handle ESM natively over HTTP).
- Recommend ESM with relative imports — already supported, no transform.

```
src/ui/
  tokens.css           # spacing, color, type, radius, shadow, z-index custom props (light + dark slots)
  base.css             # reset, focus-visible, sr-only, skip-link
  layout.css           # app-shell, sidebar, topbar, main grid
  components.css       # primitives (button, input, pill, badge, card, table, modal, drawer, toast)
  api.js               # consolidated fetchJson + token + cache + debounce
  router.js            # hashchange-based section router
  events.js            # SSE manager (auto-reconnect, pause-on-hidden)
  diff.js              # mount(node, items, key) DOM-patching helper
  components/
    button.js          # primary | secondary | danger | ghost; sm/md/lg; loading state
    input.js           # text, password (with visibility toggle), number, search
    select.js          # native select wrapped with chevron + token styling
    toggle.js          # accessible switch
    checkbox.js        # accessible checkbox
    pill.js            # status pill with sr-only text + shape variant
    badge.js           # neutral, info, warn, danger
    card.js            # head/body/foot
    tab.js             # rovingtabindex tablist
    table.js           # sticky header + rowVirtualizer (IntersectionObserver chunks)
    modal.js           # role=dialog, focus-trap, esc, restore-focus
    drawer.js          # right-side detail panel, focus-trap, esc
    toast.js           # transient + persistent variants, region role=status
    skeleton.js        # block, line, circle
    empty-state.js     # icon + title + body + cta
    command-palette.js # cmd-k overlay, fuzzy match, recent actions
  sections/
    home.js
    workspaces.js
    activity.js
    approvals.js
    tools.js
    agents.js
    settings/
      index.js         # left-rail router
      general.js
      permissions.js
      approval-gates.js
      multi-agent.js
      releases.js
      connector.js
      diagnostics.js
      advanced.js
    onboarding.js
public/
  dashboard.css        # @import url('/src/ui/tokens.css'); … (or concat-on-serve)
  dashboard.js         # entry; imports api, router, events, sections
```

Server change: extend `httpServer.js:95-111` (already serves `dashboardClient.js`, `settingsDashboardClient.js`, `activityDashboardClient.js`) to serve `/ui/<file>` and `/public/<file>` from disk with the same token guard. No build step required.

### CSS strategy
- **CSS Layers**: `@layer reset, tokens, base, components, sections, utilities;`. Layered cascade prevents the current arms race between inline `width:100%` (`src/settingsDashboardClient.js:108`) and component defaults.
- **Tokens** in `tokens.css`:
  ```
  :root {
    --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
    --space-5:24px; --space-6:32px; --space-7:48px;
    --font-12:12px; --font-13:13px; --font-14:14px; --font-16:16px;
    --font-20:20px; --font-24:24px; --font-30:30px;
    --radius-sm:6px; --radius-md:10px; --radius-lg:16px;
    --shadow-1:…; --shadow-2:…;
    --z-overlay:50; --z-modal:60; --z-toast:70;
    /* dark default */
    --bg:#070b13; --surface:#0b1220; …
  }
  :root[data-theme="light"] {
    --bg:#fafbfc; --surface:#ffffff; …
  }
  ```
- Replace the eight scattered surface colors at `src/httpServer.js:567-587` and the inline `rgba(154,173,212,.x)` literals (used 18+ times) with `--line-soft`.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }` in `base.css`.

---

## 4. Detailed Recommendations (A–K)

### A. Information Architecture
- Promote **Approvals** out of the 3-column row (`src/httpServer.js:705-718`) into its own section. When `openApprovals > 0`, render an inline pending-approvals card on Home above the metrics.
- Move **Sessions** and **Jobs** into Home as a single "Live work" card with toggle, since they serve the same purpose (work-in-progress visibility) and currently fight for screen real estate.
- Move **Health findings** out of the bottom Agents section (`src/httpServer.js:720-729`) — they belong on Home above the fold when `health.ok === false`.
- The current **Diagnostics** section (`src/httpServer.js:744-764`) houses three buttons that just dump JSON. Demote into Settings → Diagnostics with a proper Tabular view per endpoint.
- The **Raw panel** (`src/httpServer.js:766-771`) becomes invokable from Cmd-K only.
- **Tool Browser** lives at `#tools`, fed by a new `GET /api/tools` route (synthesized server-side from the `toolSchemas` list at `src/tools.js:49+`).
- **Onboarding** is an overlay (modal-style, role=dialog) rendered into the existing dashboard when `needsOnboarding(payload)` returns true. Not a separate route — preserves the token-gated `/dashboard`. Detection: `payload.config.workspaces.length === 0 || !connection.permanentUrlConfigured || onboardingFlagFile missing`.

### B. Component System (vanilla JS)
- See file tree in §3. Recommendation: **per-primitive ESM modules** under `src/ui/components/`, served by extending the existing static-file branches at `src/httpServer.js:95-111`.
- **Button**: variants `primary | secondary | danger | ghost`, sizes `sm | md | lg`, `loading` prop replaces label with spinner and sets `aria-busy="true"` and `disabled`. Replaces all three of `button`, `button.secondary`, `button.danger` at `src/httpServer.js:599-605`.
- **Modal**: traps focus to first focusable, returns focus to opener on close, listens for Esc, has an aria-labelledby title, dims with `data-z=overlay`. Replaces `confirm()` at `src/settingsDashboardClient.js:356` and the bare-bones Raw panel at `src/httpServer.js:766-771`.
- **Toast**: `role=status` region anchored top-right. Used after settings save, after approval action, after token validation.
- **Drawer**: right-side detail panel for activity-row drilldown.
- **Table**: sticky header (already present at `src/httpServer.js:634`) + simple chunked rendering (50 rows + IntersectionObserver sentinel) for >100 rows.
- **CommandPalette**: Cmd/Ctrl-K. Index is built once on boot from a registry: nav targets, settings sub-pages, `data.config.workspaces.map(switchWorkspace)`, and `tools.list`.

### C. Onboarding Wizard
- Trigger condition (from one place, `onboarding.js:isFirstRun`):
  - `config.workspaces.length === 0`, **or**
  - `connection.permanentUrlConfigured === false`, **or**
  - flag file `~/.rel-ai-mcp/onboarding.json` missing/`{ "completed": false }`.
- Steps (modal carousel, role=dialog, esc disabled):
  1. **Welcome** — current connection summary surfaced from `/api/connection`. Copy-button next to the ChatGPT MCP URL (currently buried in the Connector card at `src/httpServer.js:740`). Token visibility toggle.
  2. **Add first workspace** — alias + absolute path. Validate path with new `GET /api/workspace/preflight?path=…` (route already exists at `src/httpServer.js:213`, just used differently — extend to accept arbitrary path).
  3. **Pick permission profile** — radio cards, not a select. Each card explains in plain English: "Read-only" (look but don't touch), "PR" (default; can commit + open PRs but never push to main), "Test" (PR + run test commands), "Admin" (everything; required to edit settings via the dashboard). Links existing `permissionProfile` enum at `src/configEditor.js:108-110`.
  4. **Connect ChatGPT** — replicates the four-step block at `src/httpServer.js:734-740` but as actionable buttons: `[Copy MCP URL]`, `[Open ChatGPT settings]`, `[Verify connection]`. Verify hits `/api/connection` and surfaces `permanentUrlConfigured` + a fresh `chatgptHealthUrl` ping.
  5. **Done** — set `~/.rel-ai-mcp/onboarding.json` via new `POST /api/onboarding/complete`. Show toast "Setup complete — press Cmd-K anytime."
- **Skip path** — every step has a small "Skip for now" link. Skip writes `{ completed: false, skipped: true }` and the dashboard shows a permanent yellow banner above the Home metrics: `Setup not complete · [Resume setup]`. Banner is dismissible per-session but always returns until completion.

### D. Tool Browser (new)
- New route `GET /api/tools` in `httpServer.js`. Returns `toolSchemas` from `src/tools.js:49+` mapped to:
  ```
  { name, displayName, description, category, requiredProfile, requiresApproval, parameters, exampleInvocation }
  ```
  - `category` derived from name prefix: `relai_git_*` → "Git", `relai_docker_*` → "Docker", `relai_ci_*` → "CI", `relai_workspace_*` → "Workspace", etc.
  - `requiredProfile` derived from `enforcePermission` calls (`src/permissions.js`). Today permission is runtime-only; we add a static metadata table generated at module load.
  - `requiresApproval` derived from approval-gate references in the tool body.
- UI: searchable table with columns Name, Category, Profile, Approval-gated.
  - Filters: category chips (Git/Docker/Workspace/Plans/Multi-agent/CI/Audit/Release/Doctor/Memory).
  - Toggle "Available to me" filters by `currentProfile >= requiredProfile`.
  - Row click opens a Drawer with description, parameter table, and a copy-to-clipboard "Run via ChatGPT" template like `Run relai_git_status with workspace="<alias>"`.
- Empty state if profile is `read-only`: "Switch to PR or higher profile to see write tools" with link to Settings → Permissions.

### E. Approvals UX (NEW server route required)
- Add `POST /api/approvals/:id/decision` to `httpServer.js`. Body: `{ status: "approved" | "rejected" | "cancelled", reason }`. Calls existing `approvals.resolveApproval(config, args)` at `src/approvals.js:92`. Currently `resolveApproval` requires admin-level access via the MCP layer; mirror that here by rejecting non-admin profiles.
- Inline approvals card on Home: when `openApprovals > 0`, surface them above the Live-work card with a yellow ring. Each row has Approve / Reject buttons.
- Approval modal opens with: Action name, scope (workspace / session), summary, requesting agent, full args, time pending.
- On Approve success:
  - Toast: "Approved — id copied to clipboard" with a [Show in console] link.
  - Auto-copy `approvalId` to clipboard (the agent that requested still needs to retry — `src/approvals.js:122` requires the approval to be flipped to `approved` before retry, but the agent must call again; the dashboard cannot do that on behalf of ChatGPT).
- Replace the 2-step UX confusion: the dashboard hides the request-id-back-to-retry mechanic. The user only sees: Pending → click Approve → done.

### F. Settings UX
- Replace the four-button tabbar (`src/settingsDashboardClient.js:68-74`) with a vertical left rail. Sub-pages: General, Permissions, Approval gates, Multi-agent, Releases, Connector, Diagnostics, Advanced.
- **Recommendation: explicit Save** (not autosave). Reasoning: settings here change *server* policy (e.g., flipping `allowArbitraryCommands` is a security-sensitive action). Autosave on every keystroke means there's no point at which the user has explicitly accepted a risky change. Use:
  - Per-section sticky-bottom save bar that appears only when the section is dirty.
  - "Discard changes" button next to Save.
  - Save button shows loading state, becomes disabled, then flashes a "Saved" pill for 2s.
  - Field-level errors render inline beneath the field with `aria-invalid="true"` + `aria-errormessage`.
- **Diff/changes summary**: when the section is dirty, show a small "3 changes" link in the save bar. Click opens a modal listing each change as `key: oldValue → newValue`.
- **Dangerous toggles**: replace the always-visible "I understand…" checkbox at `src/settingsDashboardClient.js:198, 227` with on-demand confirm modal that requires typing the literal phrase `DISABLE SAFETY` into a confirmation field. Triggered only when about to save a value that flips a key in `DANGEROUS_KEYS` (`src/configEditor.js:5-10`) from false to true.
- **Inline help** under each setting in plain language. Example: `permissionProfile` help: "Controls what tools are available to ChatGPT. Read-only sees but doesn't touch. PR can edit code, commit, and open PRs but never pushes to protected branches. Test adds the ability to run test commands. Admin allows everything, including editing this dashboard."
- **Workspace editor**: keep the dropdown-driven editor (`src/settingsDashboardClient.js:213`) but add inline path validator (calls `/api/workspace/preflight`).
- **Workspace delete**: replace native `confirm()` at `src/settingsDashboardClient.js:356` with the Modal primitive, requires typing the alias to confirm.

### G. Activity / Logs
- Toolbar above the table:
  - Search input (substring on `tool`, `message`, `error`, `path`). Debounced 200ms.
  - Time range pills: 15m | 1h | 24h | 7d | All. Default 1h.
  - Workspace `<select>`.
  - Tool `<select>` (deduped from current page).
  - Status filter pills: ok | warn | error.
- Virtualized table: render first 50 rows, append more on IntersectionObserver scroll-end. Total entries from `/api/logs?limit=500`. Don't fetch more than 500 in one shot.
- Row click → right Drawer with full JSON, parsed args, error stack with line breaks, related session link.
- Streaming: when SSE delivers a `dashboard` event with new audit entries, prepend to the table with a `data-new=true` attribute that triggers a 1.5s yellow → transparent fade. Respect `prefers-reduced-motion`.
- Pause/Resume button — pauses both SSE consumption (without closing) and prepending. Useful when scanning history.
- The current 15s `setInterval(refresh, 15000)` (`src/httpServer.js:953`) becomes SSE-only when `eventSource.readyState === OPEN`. Add visibility handler to suspend on `document.visibilityState === "hidden"`.

### H. Command Palette (Cmd/Ctrl-K)
- Global key listener attached at boot in `dashboard.js`.
- Index built lazily on first open from:
  - Section nav: Home, Workspaces, Activity, Approvals, Tools, Agents, Settings → each sub-page.
  - Actions: Refresh, Toggle live, Pause activity, View API response (Raw), Copy ChatGPT URL, Copy dashboard token, Copy MCP-URL-with-secret.
  - Workspaces: each workspace alias as "Switch to <alias>".
  - Tools: each of the 138 tools as "View tool: <name>".
  - Recents: track last 10 actions in `localStorage`.
- Fuzzy matcher: simple subsequence match with bonus for prefix and consecutive-char hits.
- Recent/frequent actions surface above search results when the query is empty.

### I. Accessibility
- `:focus-visible` ring `outline: 2px solid var(--blue); outline-offset: 2px; border-radius: inherit;` on every interactive primitive in `base.css`. Replace the ad-hoc focus styling at `src/httpServer.js:610`.
- Status pills: every `.status-pill` gets a child `<span class="sr-only">` describing the state. Replace the 4 places that render pills (`src/httpServer.js:627, 810`; `src/dashboardClient.js:88`; `src/activityDashboardClient.js:48`).
- Modals: focus trap (cycle tab/shift-tab among focusable descendants), `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to title id, return focus on close.
- Forms: every `<input>` has a `<label for>` (today: `src/settingsDashboardClient.js:134` uses for/id correctly — keep). Help text gets an id and `aria-describedby`. Validation errors set `aria-invalid` + `aria-errormessage`.
- Tables: add `<caption class="sr-only">`, `<th scope="col">`. For the virtualized table set `aria-rowcount` to total filtered rows.
- Skip link at top of `<body>`: `<a href="#main" class="skip-link">Skip to content</a>` — visible only on focus, jumps past the sidebar.
- Reduced-motion media query disables: terminal-line fade, status-pill glow (`box-shadow: 0 0 14px rgba(...)` at `src/httpServer.js:627`), live-row insert highlight, palette open animation.
- Color-only signals → add icon + sr-only text. Status dots (`src/httpServer.js:635 .dot.warn|.bad`) become icon glyphs (✓/!/x) under reduced-color preferences.
- Token input gets `autocomplete="off"`, `spellcheck="false"`, and a visibility toggle button with `aria-label="Show token"` / `aria-pressed`.

### J. Microcopy
| Where | Today | Proposed |
|---|---|---|
| Bootstrap script `src/httpServer.js:734-740` | "Run `npm run oneclick -- --public-url ...`" | Plain-English "Run the one-click launcher with your public URL" + show the command in a copyable box. |
| `src/httpServer.js:737` | "ChatGPT Developer Mode" | "ChatGPT → Settings → Connectors → Add MCP server" |
| `src/httpServer.js:674` | "Raw" | (move to Cmd-K) "View API response" |
| `src/dashboardClient.js:145` | "Rel.AI MCP - pr profile" | "PR agent profile (commits and PRs allowed; never pushes to main)" |
| `src/settingsDashboardClient.js:180` | "docker_readonly_base" | "Read-only base + writable workspace (recommended)" |
| `src/settingsDashboardClient.js:217` | "Repo slug" | "GitHub repo (owner/name)" with placeholder "acme/web-app" |
| `src/settingsDashboardClient.js:192` | "High-risk switches require the confirm dangerous checkbox" | "These settings let agents run unrestricted commands. Each one requires explicit confirmation when enabled." |
| `src/configEditor.js:111` | "permissionProfile must be read-only, pr, test, or admin." | "Permission profile must be one of: Read-only, PR agent, Test runner, Admin." |
| `src/approvals.js:112` | "Approval required for action 'X'. Create approval with relai_approval_request, approve it, then retry with approvalId." | "This action needs approval. ChatGPT has paused; open the Approvals tab to allow or deny." |
| Empty state "No workspaces configured" (`src/dashboardClient.js:163`) | string only | EmptyState primitive: icon, title, "No workspaces yet — point Rel.AI at a folder to get started", `[Add workspace]` CTA. |
| Empty state "No audit events yet" (`src/dashboardClient.js:183`) | string only | "Activity will appear here when ChatGPT calls a Rel.AI tool. Try asking ChatGPT to read a file in your workspace." |

### K. Performance
- **Debounce token input** 300ms in `api.js`. Today every keystroke fires `sessionStorage.setItem` (`src/httpServer.js:783`).
- **Diff-render**: `mount(parent, items, keyFn, renderFn)` — keep map of last-rendered DOM nodes by key, only swap deltas. Apply to: workspaces grid, sessions/jobs/approvals lists, activity rows, agent grid.
- **Cache `/api/dashboard/v10`** in `api.js` for 1s. Multiple sections that all currently call it independently (`src/dashboardClient.js:208`, plus refresh from settings save) are deduped.
- **Lazy-load** Settings, Diagnostics, Tools section bundles. Today all three client files (`dashboardClient.js`, `settingsDashboardClient.js`, `activityDashboardClient.js`) load unconditionally on every `/dashboard` GET (`src/httpServer.js:977-979`). Defer with `<script type="module">` + dynamic `import()` triggered on first hash-route to that section.
- **Drop the 15s polling fallback** when SSE is open. Today both run concurrently (`src/httpServer.js:953`). Re-enable only when SSE errors (`onerror` handler) or after 30s of no event with `readyState !== OPEN`.
- **Pause SSE + polling on `document.visibilityState === "hidden"`**. Resume on `visibilitychange`.
- **Don't serialize raw payload** when raw panel is closed (`src/dashboardClient.js:204`, `src/httpServer.js:851`). Compute lazily on toggleRaw.
- **Stop double-fetching after settings save**: `src/settingsDashboardClient.js:271-272` calls both `loadSettings` and `window.refresh()`. Pick one — `refresh()` is enough; the settings payload is included in the rerender.

---

## 5. Suggested Component / System Architecture

(File tree in §3 above.) Key cross-cutting notes:

- **Module loading**: serve `src/ui/**/*` via the same disk-read pattern at `src/httpServer.js:96-111` (just generalize to a path-prefixed handler that refuses any path containing `..`). No build step, no bundler.
- **Naming**: every primitive exports a single factory function (e.g., `Button({ variant, size, label, onClick, loading })` → returns a configured `<button>` element). No web-components, no shadow DOM — keeps debugging simple and avoids style isolation surprises.
- **Single source of truth for state**: a `store.js` exposes `get()`, `set(patch)`, `subscribe(fn)`. The dashboard payload, the current section, the open modal, the dirty settings draft — all live here. Removes the current pattern of poking `window.lastData`, `window.__relaiSettingsPayload`, `window.__relaiSettingsTab` (`src/httpServer.js:776`, `src/settingsDashboardClient.js:257-258`).
- **CSS layers**: enforce in this order: `reset, tokens, base, layout, components, sections, utilities`.

---

## 6. Wireframe ASCII Layouts (top 5 screens)

### 6.1 Home (was Overview)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ [skip to content]                                                              │
├──────────┬─────────────────────────────────────────────────────────────────────┤
│  R  Rel  │  Home                                       [⌘K] [● Live] [Settings]│
│  AI      │  PR profile · 2 workspaces · all healthy                            │
│  ──────  │                                                                     │
│  Home  ▸ │ ┌───────────────────────── Pending approvals (2) ─────────────────┐│
│  Wkspc.  │ │ ⚠ relai_git_push to acme/web-app             [Approve] [Reject]││
│  Activ.  │ │ ⚠ relai_docker_run on acme/web-app           [Approve] [Reject]││
│  Aprvls  │ └────────────────────────────────────────────────────────────────┘│
│  Tools   │                                                                     │
│  Agents  │ ┌─Sessions─┐ ┌──Jobs────┐ ┌─Approvals┐ ┌─Locks──┐ ┌─Health─┐ ┌─Rd─┐│
│  Sttngs  │ │   12     │ │   3 run  │ │   2 open │ │   0    │ │  all   │ │ 92 ││
│  ──────  │ │ 4 active │ │  2 queued│ │ 0 stale  │ │ coop   │ │  clear │ │ ok ││
│  v0.11.11│ └──────────┘ └──────────┘ └──────────┘ └────────┘ └────────┘ └────┘│
│          │                                                                     │
│          │ ┌── Live work ─────────────────────┐ ┌── Recent activity (12) ────┐│
│          │ │ ▸ S 9c2a · acme · planning       │ │ now  git_status   ok       ││
│          │ │ ▸ J 4f81 · acme · npm test       │ │ 2m   plan_apply   ok       ││
│          │ │ ▸ S e51d · web  · review         │ │ 4m   docker_run   denied   ││
│          │ │   …                              │ │ 7m   workspace…   ok       ││
│          │ └──────────────────────────────────┘ └────────────────────────────┘│
└──────────┴─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Activity

```
┌──────────┬─────────────────────────────────────────────────────────────────────┐
│  …       │  Activity                                  [⏸ Pause live] [⌘K]     │
│          │  ┌─Search──────┐ [15m|1h|24h|7d|All]  Wkspc▾  Tool▾  ●ok ○warn ○err│
│          │  │ q…          │                                                   │
│          │  └─────────────┘                                                   │
│          │  ┌────────┬───────────────┬──────────┬────────┬─────────────────┐ │
│          │  │ TIME   │ TOOL          │ WORKSPACE│ STATUS │ MESSAGE         │ │
│          │  ├────────┼───────────────┼──────────┼────────┼─────────────────┤ │
│          │  │ now    │ git status    │ acme     │  ok    │ 3 modified      │▸│
│          │  │ 1m ago │ docker run    │ acme     │ denied │ approval requir │▸│
│          │  │ 3m ago │ apply patch   │ acme     │  ok    │ 412 lines       │▸│
│          │  │ … virt scroll …                                                │
│          │  └──────────────────────────────────────────────────────────────┘ │
└──────────┴───────────────────────────────────────────────────────────────────┘
                                            ┌─Drawer (closed) ───────────────┐
                                            │ Tool: docker run               │
                                            │ Workspace: acme                │
                                            │ Args: { image: "node:20" }     │
                                            │ Error: approval required       │
                                            │ Session: S e51d                │
                                            │ [Open approvals]               │
                                            └────────────────────────────────┘
```

### 6.3 Tools (new)

```
┌──────────┬─────────────────────────────────────────────────────────────────────┐
│  …       │  Tools  ·  138 available  ·  37 visible at PR profile               │
│          │  ┌─Search…──────┐  [Git 24] [Docker 8] [Workspace 14] [Plans 12] ▸  │
│          │  ☐ Available to me only                                              │
│          │  ┌─────────────────┬──────────┬─────────┬───────────────────┬─────┐ │
│          │  │ NAME            │ CATEGORY │ PROFILE │ APPROVAL          │     │ │
│          │  ├─────────────────┼──────────┼─────────┼───────────────────┼─────┤ │
│          │  │ git_status      │ Git      │ read    │ —                 │ ▸   │ │
│          │  │ git_push        │ Git      │ pr      │ requires approval │ ▸   │ │
│          │  │ docker_run      │ Docker   │ admin   │ requires approval │ ▸   │ │
│          │  │ workspace_add   │ Workspc. │ admin   │ —                 │ ▸   │ │
│          │  │ …                                                               │ │
│          │  └────────────────────────────────────────────────────────────────┘ │
└──────────┴─────────────────────────────────────────────────────────────────────┘
                                       ┌─ Drawer: docker_run ────────────────┐
                                       │ Run a docker command (read-only base)│
                                       │ Profile required: admin              │
                                       │ Approval gate: docker.run            │
                                       │ Parameters                          │
                                       │   workspace: string (alias)         │
                                       │   image: string                     │
                                       │   command: string                   │
                                       │ Try via ChatGPT [Copy template]     │
                                       └─────────────────────────────────────┘
```

### 6.4 Settings (left rail)

```
┌──────────┬──────────────┬──────────────────────────────────────────────────────┐
│  …       │ ▸ General    │  Settings · General                                  │
│          │   Permissions│                                                       │
│          │   Approvals  │  Permission profile           [PR ▾]                 │
│          │   Multi-agnt │  Plain-English help under the field                  │
│          │   Releases   │                                                       │
│          │   Connector  │  Default task mode             [implement & test ▾]  │
│          │   Diagnostc  │                                                       │
│          │   Advanced   │  Sandbox mode                  [readonly base ▾]     │
│          │              │                                                       │
│          │              │  ☑ Session locks                                      │
│          │              │  ☑ Dashboard enabled                                  │
│          │              │                                                       │
│          │              │  Max concurrent sessions/wkspc  [ 4 ]                 │
│          │              │                                                       │
│          │              │  ┌─ 3 changes pending ──────────────────────────┐    │
│          │              │  │ permissionProfile: read-only → pr            │    │
│          │              │  │ defaultTaskMode: implement → implement_test  │    │
│          │              │  │ sandboxMode: none → docker_readonly_base     │    │
│          │              │  │             [Discard]   [Save 3 changes]     │    │
│          │              │  └──────────────────────────────────────────────┘    │
└──────────┴──────────────┴──────────────────────────────────────────────────────┘
```

### 6.5 Onboarding (overlay over dimmed Home)

```
            ┌─────────────────────────────────────────────────────────┐
            │ Setup Rel.AI MCP                          step 2 of 5 ✕ │
            ├─────────────────────────────────────────────────────────┤
            │                                                         │
            │ Add your first workspace                                │
            │                                                         │
            │ Rel.AI works against folders you point it at. Each      │
            │ workspace is isolated.                                  │
            │                                                         │
            │ Alias (short name)                                      │
            │ [ acme                                                ] │
            │                                                         │
            │ Folder path (absolute)                                  │
            │ [ /Users/you/code/acme                                ] │
            │ ✓ Folder exists · git repository · 312 files            │
            │                                                         │
            │                  [Skip for now]    [Back]   [Continue→] │
            └─────────────────────────────────────────────────────────┘
```

---

## 7. Accessibility & Performance — Concrete Changes

### Accessibility checklist (per file)
- `src/httpServer.js:646` `<body>` → add `<a href="#main" class="skip-link">Skip to content</a>` and id `main` on `<main class="main">` (already at line 660).
- `src/httpServer.js:599-605` button styles → move into `components.css` and add `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`.
- `src/httpServer.js:606-610` input styles → same focus-visible treatment; remove the box-shadow-only focus state.
- `src/httpServer.js:627` `.status-pill` rule → require child `<span class="sr-only">` describing state in helper at `src/dashboardClient.js:87`.
- `src/httpServer.js:671` token input → add `autocomplete="off"`, `spellcheck="false"`, plus a visibility toggle button. Wrap in label "Dashboard token".
- `src/httpServer.js:766-771` raw panel → wrap in Modal primitive, get `role=dialog`, `aria-modal=true`, focus trap, esc-close, return-focus to trigger.
- `src/settingsDashboardClient.js:62-77` injected settings section → Tab primitive replaces the four-button row at lines 68-74; rovingtabindex pattern; ArrowLeft/Right between tabs.
- `src/settingsDashboardClient.js:356` `confirm()` → Modal with typed-phrase confirmation.
- `prefers-reduced-motion` media query in `base.css` disables: glow at `src/httpServer.js:627`, scroll-behavior smooth at line 589, future activity-row fade.

### Performance checklist
- `src/dashboardClient.js:148-204` `setHtml(...)` 12 calls → diff-render via `mount(parent, items, key, render)` from `src/ui/diff.js`.
- `src/httpServer.js:953` 15s polling timer → only start when SSE not connected; clear on SSE open.
- `src/httpServer.js:786` per-fetch AbortController + 8s timeout → already present; consolidate. Add SWR-style 1s memo cache in `api.js`.
- `src/dashboardClient.js:204` `JSON.stringify(payload, null, 2)` on every render → only run when `#rawPanel.open`.
- `src/settingsDashboardClient.js:271-272` save → drop the `await loadSettings()` after save; rely on `refresh()` only.
- `src/httpServer.js:977-979` three unconditional client scripts → load entry only; sections lazy-import.
- Add `document.addEventListener('visibilitychange', …)` in `events.js` to pause SSE/polling.

---

## 8. Implementation Roadmap

### Phase 1 — Foundations (1–2 days)
**Goal**: split CSS/JS, install primitives, lock down a11y/keyboard baseline, microcopy pass. No functional behavior changes.

Files touched:
- `src/httpServer.js:556-982` — slim renderer to ~150 lines: emit `<link rel=stylesheet href=/public/dashboard.css>` and `<script type=module src=/public/dashboard.js>`. Keep `initialDashboardData` payload script.
- `src/httpServer.js:95-111` — generalize three static-file branches into one `/ui/*` and `/public/*` handler with token guard and `..` rejection.
- New: `src/ui/tokens.css`, `src/ui/base.css`, `src/ui/layout.css`, `src/ui/components.css`.
- New: `src/ui/api.js`, `src/ui/router.js`, `src/ui/events.js`, `src/ui/diff.js`, `src/ui/store.js`.
- New primitives: `src/ui/components/{button,input,select,toggle,checkbox,pill,badge,card,tab,table,modal,drawer,toast,skeleton,empty-state}.js`.
- New entry: `public/dashboard.js`, `public/dashboard.css`.
- `src/dashboardClient.js` reduced to a `sections/home.js` module using primitives.
- `src/activityDashboardClient.js` reduced to a `sections/activity.js` shell (filters in Phase 2).
- `src/settingsDashboardClient.js` reduced to a `sections/settings/index.js` shell (sub-pages in Phase 2).
- Microcopy pass on all hardcoded strings (table in §J).

Impact: high — every other phase depends on this. Visual regression risk is moderate because CSS moves wholesale.

Risk:
- Breaking `?token=` query handling — keep the existing branch logic at `src/httpServer.js:90, 96, 102, 108` intact.
- ESM over `<script type=module>` requires `Content-Type: text/javascript` and absolute URLs in imports. Test on first run.

Verification: `npm run check` (already in `package.json:20`) for syntax. Manual: open `/dashboard?token=…`, check Network tab — 1 HTML + 1 CSS + 1 JS entry + on-demand modules.

### Phase 2 — Settings, Activity, Approvals, Onboarding (2–3 days)
**Goal**: deliver high-value UX changes that unblock the P0 issues.

Files touched:
- `src/httpServer.js` — add routes:
  - `POST /api/approvals/:id/decision` → calls `approvals.resolveApproval` at `src/approvals.js:92`.
  - `POST /api/onboarding/complete` and `GET /api/onboarding/status` → manages `~/.rel-ai-mcp/onboarding.json`.
  - `GET /api/workspace/preflight?path=…` → extend the existing route at `src/httpServer.js:213` to validate arbitrary paths.
- `src/configEditor.js:5-10, 100-` — add a `dryRun` mode that returns the diff without writing, used by the changes-summary modal.
- `src/ui/sections/settings/*` — full implementation (left-rail nav + per-page modules + dirty-tracking + diff modal + dangerous-toggle confirmation).
- `src/ui/sections/activity.js` — toolbar (search, time range, filters), virtualized table, drawer, pause-live.
- `src/ui/sections/approvals.js` + `src/ui/sections/home.js` inline approvals card.
- `src/ui/sections/onboarding.js` — wizard overlay, 5-step carousel, skip flow.

Impact: high. Closes P0 #1 (no HTTP approval), #3 (no onboarding), #4 (settings save UX), #5 (native confirm).

Risk:
- New `POST /api/approvals/:id/decision` must enforce admin profile (mirror `src/approvals.js` behavior). Audit-log every decision via existing `logAudit`.
- Onboarding wizard must not block the Home render if `/api/onboarding/status` 401s — degrade gracefully.

Verification: extend `test/v9-product-ux-smoke.mjs` (already exists per `package.json:33`) with HTTP exercises of the new routes.

### Phase 3 — Tool browser, Cmd-K, virtualization, light mode (3–5 days)
**Goal**: power-user features and polish.

Files touched:
- `src/tools.js` — export a metadata table alongside `toolSchemas` (category derivation, `requiredProfile`, `requiresApproval`). Avoids touching every `tool(...)` call.
- `src/httpServer.js` — add `GET /api/tools` route returning the metadata.
- `src/ui/sections/tools.js` — table + filters + drawer.
- `src/ui/components/command-palette.js` — fuzzy matcher, recent actions, action registry.
- `src/ui/components/table.js` — IntersectionObserver-based row virtualizer (used by Activity and Tools).
- `src/ui/tokens.css` — add `:root[data-theme=light]` slots; theme switcher in Settings → General (defaults remain dark).
- `src/ui/events.js` — visibility-pause; SSE auto-reconnect with backoff; remove the always-on 15s timer.
- `src/ui/diff.js` — battle-test on Activity and Live work cards.

Impact: medium-high. Closes P0 #2 (tool discovery) and most P1/P2 polish issues.

Risk:
- Tool metadata (especially `requiredProfile`) is currently implicit in `enforcePermission` calls. The static table needs to be reviewed for accuracy or generated by introspecting permission middleware.
- Light mode = ~80 token swaps; visual QA each section.

Verification: add `test/v11-tools-and-onboarding.mjs` (suggested) covering `/api/tools`, `/api/approvals/:id/decision`, `/api/onboarding/*`. Visual regression: manual Cmd-K coverage; reduced-motion check.

---

## Critical Files for Implementation

- C:\Dev\rel-ai-mcp\src\httpServer.js
- C:\Dev\rel-ai-mcp\src\dashboardClient.js
- C:\Dev\rel-ai-mcp\src\settingsDashboardClient.js
- C:\Dev\rel-ai-mcp\src\activityDashboardClient.js
- C:\Dev\rel-ai-mcp\src\approvals.js
PLANEOF
echo "wrote"
ls -la "/c/Users/Kyne/.claude/plans/audit-and-redesign-the-cheeky-badger-agent-a9f96711c653f4a8b.md"