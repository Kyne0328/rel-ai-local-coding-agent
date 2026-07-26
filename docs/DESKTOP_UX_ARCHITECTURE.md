# Rel.AI MCP desktop UX architecture

This document is the Phase 0 contract for the desktop usability redesign. It records the current ownership boundaries, establishes the vocabulary and state model that later phases must use, and preserves a baseline before navigation and window behavior change.

Phase 0 established the shared contracts. Phase 1 applied canonical terminology and navigation. Phase 2 made the main dashboard the owner of routine desktop settings. Phase 3 renders one normalized four-layer Connection model across the dashboard. Phase 4 makes approval-token replacement an explicit revocation and reapproval workflow. Phase 5 makes the dashboard the only routine configured-desktop window. Phase 6 removes duplicate first-run onboarding. Phase 7 simplifies workspace setup and daily workspace management. Phase 8 consolidates structured errors, sanitized diagnostics, service logs, and local reset controls. Phase 9 adds searchable quick navigation, direct workspace jumps, and shareable page state. Phase 10 hardens keyboard, screen-reader, high-contrast, reduced-motion, and narrow-screen behavior across dashboard and Electron surfaces. Phase 11 reduces competing elevation and density so primary actions, active work, and recovery states carry the strongest emphasis. Phase 12 adds explicit installed-app update discovery, download progress, and guarded restart-to-install behavior. Phase 13 hardens installed-app startup, update-transition reporting, and interrupted-exit recovery. Phase 14 integrates platform-aware application chrome and one native scrollbar design system into the dashboard shell.

## Product vocabulary

Use these terms in new user-facing work:

| Concept | Canonical label | Avoid in ordinary UI |
|---|---|---|
| Desktop and ChatGPT connectivity | Connection | Connector, transport, bridge |
| Local secret used to approve ChatGPT | Approval token | Dashboard token, generated replacement |
| Grouped Rel.AI work records | Sessions | Tasks, work sessions |
| Tool-call event history | Activity | Logs when referring to tool events |
| Available MCP capabilities | Tools | Reference as the main page label |
| Configured local repository | Workspace | Alias when a display name is sufficient |

Implementation identifiers can remain stable when compatibility requires them. Phase 1 applies this vocabulary to primary navigation, section headings, desktop setup surfaces, and user documentation.

## Current application surfaces

### Main dashboard

The dashboard owns Overview, Sessions, Workspaces, Activity, Settings, and Tools. Dashboard Settings owns General, Connection, Tools & validation, Diagnostics, and Advanced.

### Electron setup window

`electron/renderer/wizard.html` owns first-run local-service, public-connection, token, and launch configuration.

### Desktop settings

The separate Electron settings renderer has been removed. Connection credentials and approval-token replacement are owned by `#settings/connection`; appearance, notifications, application updates, and startup/recovery are owned by `#settings`; patch safeguards and resource limits are owned by `#settings/advanced`. All Electron-owned controls remain available only through the secured dashboard preload.

### Electron recovery fallback

`electron/renderer/status.html` is a failure-only fallback for cases where the local service or main dashboard cannot start or load. It is not exposed by routine dashboard or tray actions and never hides a healthy dashboard.

### System tray

The tray starts and stops the service, copies the endpoint, opens the dashboard, Diagnostics, and Settings routes, and exposes the current application-update action. It does not expose the recovery fallback as a normal destination.

## State ownership

| State | Current authoritative source | Renderer consumers |
|---|---|---|
| Local HTTP service | Electron main process | Dashboard, recovery fallback when required, tray |
| Public endpoint/tunnel | Electron main process and connection profile | Dashboard, recovery fallback when required, tray |
| ChatGPT approval token | Electron main process and local launch environment | Setup renderer, secured dashboard IPC, HTTP authentication |
| Dashboard event stream | Dashboard renderer | Connection page, Overview, dashboard top status |
| Workspace configuration | Core config | Dashboard and MCP tools |
| Tool-call activity | Tool activity runtime and audit history | Dashboard, recovery fallback when active, notifications |
| Application update | Electron main process and GitHub release metadata | General settings, tray |
| Desktop lifecycle | Electron main process and local lifecycle metadata | General settings, tray-only startup |

The Electron main process must remain authoritative for desktop process and tunnel state. The dashboard event stream must never be treated as proof that ChatGPT can reach the public endpoint.

## Shared connection-state contract

`src/desktopUxContracts.js` defines the normalized model:

```js
{
  localService: {
    status: 'running' | 'starting' | 'stopped' | 'failed'
  },
  publicEndpoint: {
    status: 'available' | 'connecting' | 'unavailable' | 'disabled'
  },
  chatgptReadiness: {
    status: 'ready' | 'authentication_required' | 'unavailable'
  },
  dashboardUpdates: {
    status: 'live' | 'connecting' | 'reconnecting' | 'paused' | 'offline'
  },
  error: null | {
    code: string,
    message: string
  }
}
```

The layers have deliberately different meanings:

- **Local service** describes the process on this computer.
- **Public endpoint** describes whether the HTTPS MCP endpoint is published.
- **ChatGPT readiness** describes whether ChatGPT can use the endpoint or must be approved again.
- **Dashboard updates** describes only the dashboard's live event stream.

A renderer must not replace these layers with a generic `Connected` state.

## Stable error codes

User-facing messages may change, but recovery logic must branch on stable codes.

| Code | Meaning |
|---|---|
| `configuration_invalid` | Desktop/core configuration could not be read or normalized |
| `local_service_start_failed` | Local service failed to start |
| `local_service_stop_failed` | Local service failed to stop cleanly |
| `local_port_in_use` | Configured local port is unavailable |
| `public_endpoint_failed` | Public endpoint could not be published or verified |
| `approval_token_required` | Authentication is missing |
| `approval_token_rejected` | Supplied approval token was rejected |
| `dashboard_unavailable` | Main dashboard could not be opened or loaded |
| `workspace_unavailable` | Configured repository cannot be resolved |
| `settings_save_failed` | Durable settings update failed |
| `diagnostics_export_failed` | Diagnostic export failed |
| `state_reset_failed` | Application-state reset failed |
| `update_failed` | Application update check, download, or installation failed |
| `update_not_supported` | Current host or portable build requires manual updating |
| `update_busy` | Another update action is already running or no valid next action exists |
| `update_install_blocked` | Active Rel.AI tool calls prevent restart-to-install |
| `startup_setting_not_supported` | Current host cannot register a Windows sign-in startup entry |
| `startup_setting_failed` | Windows startup registration could not be changed |
| `lifecycle_state_failed` | Non-secret desktop lifecycle metadata could not be saved |
| `unknown` | No more specific code is available |

Raw exception text remains technical detail. It must not be used as the only selector for a recovery action.

## Window policy for later phases

- The dashboard opens as a clearly windowed, centered surface rather than an almost-fullscreen rectangle. Its first-run size uses 80% of the active display work area, capped at 1180 by 760 pixels.
- Window persistence records the normal restore bounds rather than maximized geometry, so maximizing once cannot reopen as a non-maximized screen-sized window. Unversioned legacy bounds migrate once to the bounded default.
- Closing the dashboard hides it to the system tray; quitting remains an explicit tray action.
- Ordinary Settings, Connection, Diagnostics, logs, token replacement, and workspace management belong in the main dashboard window.
- Use a modal for a focused confirmation or short sensitive action.
- Use a drawer for item inspection only when keyboard focus is correctly contained.
- Use the system browser for external provider or documentation pages and label those actions as external.
- Keep a separate recovery window only when the main dashboard cannot operate.
- Never hide a healthy dashboard merely to display routine recovery information.

## Baseline artifacts

The current visual baseline is stored in `docs/images/`:

- `dashboard-home.png`
- `dashboard-workspaces.png`
- `dashboard-activity.png`
- `dashboard-tools.png`
- `dashboard-connector.png`
- `dashboard-diagnostics.png`
- `dashboard-settings-general.png`

Section-level captures are preserved beside them. `test/fixtures/desktop-ux-baseline.json` records the current navigation and Electron surface inventory so later phases explicitly update the baseline rather than changing it accidentally.

## Phase 1 navigation contract

- `#tools` is the canonical Tools route; `#reference` remains a compatibility alias.
- `#settings/connection` is the canonical Connection route; `#settings/connector` remains a compatibility alias.
- Tools is present in both desktop and compact/mobile navigation.
- The visible page heading and document title reflect the active route.
- Active navigation links and settings pages expose `aria-current="page"`.

## Phase 2 settings ownership contract

- Settings uses five canonical categories: **General**, **Connection**, **Tools & validation**, **Diagnostics**, and **Advanced**.
- `#settings` owns appearance, desktop notifications, startup/recovery, and application updates.
- `#settings/connection` owns the four-layer status, local port, permanent ngrok domain, ngrok account key, and approval-token replacement.
- `#settings/tools-validation` owns tool-surface discovery and workspace validation presentation.
- `#settings/diagnostics` owns findings, sanitized reports, service logs, and local history maintenance.
- `#settings/advanced` owns patch safeguards and retained-output limits. Dashboard updates are driven by the tool-activity event stream rather than user-configured polling intervals.
- `#settings/desktop` and `#settings/dashboard` remain compatibility routes and normalize to Connection and Advanced respectively.
- The Electron main process remains the durable owner of desktop credentials and lifecycle state. The dashboard renderer reads and saves these values only through sender-constrained preload IPC.
- Desktop secrets are never added to dashboard HTTP payloads, URLs, local storage, or session storage.
- Tray Settings focuses the existing dashboard at General instead of creating another routine window.
- The compatibility settings renderer and its dedicated CSS remain removed.

## Phase 3 connection presentation contract

- The Connection page renders exactly four independent layers: Local service, Public endpoint, ChatGPT readiness, and Dashboard updates.
- Overview and the top status consume the same presentation module as the Connection page instead of deriving meaning independently from `serverRunning` or `tunnelStatus`.
- Dashboard-update status describes only the current dashboard event stream. An offline dashboard does not imply that the public MCP endpoint is unavailable.
- The connection summary reports **Available** only when the local service is running, the public endpoint is available, and ChatGPT readiness is ready.
- Connection actions remain contextual: desktop restart and secure connection controls appear only in Electron, while dashboard Diagnostics remains available in both hosts.
- The authenticated `/api/connection` response reports whether an approval token is configured but does not return the token or place it in dashboard URLs. Startup logs follow the same rule.

## Phase 4 approval-token replacement contract

- Approval-token replacement is a dedicated security action, not part of the ordinary connection-settings save payload.
- The renderer never generates replacement tokens. Electron main generates the token and returns it only through the constrained `desktop:approval-token:replace` IPC action.
- The user must type the exact confirmation phrase `REPLACE` before the operation runs.
- Replacement revokes pending authorization codes and all current OAuth access and refresh tokens before writing the new approval token.
- Registered ChatGPT OAuth clients and the MCP endpoint are preserved. Users retry and reapprove the existing ChatGPT app; they do not delete or recreate it.
- OAuth revocation persists an `authentication_required` marker. The desktop Connection state remains **Approval required** until a successful authorization clears that marker.
- Ordinary Connection settings saves preserve the current approval token and cannot rotate it accidentally.
- The compatibility Electron settings renderer no longer generates tokens locally; it redirects to the secured dashboard workflow.

## Phase 5 single-window desktop contract

- After first-run setup, the secured dashboard is the only routine application window.
- `electron/renderer/settings.html` and `electron/renderer/settings.js` are removed and cannot be opened through launcher options, IPC, or packaged smoke flows.
- The Connection page and dashboard preload do not expose an Open recovery action.
- The tray routes routine troubleshooting to `#settings/diagnostics` and routine configuration to `#settings`.
- The status renderer is created only after local-service startup failure, dashboard load/open failure, or when focusing an already-visible fallback.
- **Edit connection** reuses `wizard.html` as a fallback-only editor. Existing credentials are read through sender-constrained preload IPC; no credential is placed in the query string.
- The recovery editor preserves the current approval token and hides token generation. Approval-token replacement remains available only in secured dashboard Settings.
- Cancelling the recovery editor returns to the fallback; a successful save restarts the service and opens the dashboard.
- Opening the dashboard successfully hides the fallback. Opening the fallback never hides a healthy dashboard.
- Dashboard load failures use a dedicated callback so unrelated external-link errors do not open the fallback.

## Phase 6 single first-run contract

- The Electron wizard owns desktop-only prerequisites: local port, initial approval token, ngrok account key, static domain, and service launch.
- A successful first desktop setup opens the dashboard directly at `#settings/connection`.
- The desktop dashboard never auto-opens the generic five-step browser onboarding modal.
- Instead, desktop first run shows a compact persistent handoff with only the unfinished application tasks: connect ChatGPT and add a workspace.
- Dismissing the handoff persists across restarts. Recovery edits do not recreate or reset first-run onboarding.
- Browser-hosted dashboards retain the full onboarding wizard when no onboarding state exists.
- Onboarding state records its source and whether the desktop handoff remains pending; secrets are not placed in URLs or browser storage.

## Phase 7 workspace experience contract

- Workspace cards keep only three readiness signals visible by default: **ChatGPT access**, **Repository**, and **Validation**.
- The default action row contains only common actions: Workspace settings, Run validation, and Open folder when hosted by Electron.
- Sessions, Activity, branch/worktree history, validation commands, protected branches, allowed remotes, project instructions, and workspace removal are grouped under collapsed **Repository and safety details**.
- The empty state explains the minimum setup and opens the same Add workspace form as the page action.
- Add workspace asks for the project folder first and suggests a workspace name from that folder.
- Protected branches, default base branch, and allowed remotes use safe defaults and remain under collapsed **Git and safety settings**.
- Path availability and Git detection remain visible during setup, but a non-Git or not-yet-cloned folder can still be saved.
- Workspace settings may rename a workspace and change its folder in one atomic save. Existing context, validation commands, protected branches, remotes, and project metadata are preserved unless explicitly changed.
- Create, rename, and repair operations reject duplicate workspace names and duplicate normalized project paths before configuration is written.
- Unavailable repositories use a dedicated **Repair path** workflow that changes only the project folder and keeps the workspace identity and safeguards.
- The dashboard keeps at most five recent workspace names in local UI storage. Renames and removals update that list, and stale aliases are discarded against the current configuration.
- Workspace filtering is page-owned: Sessions and Workspaces use accessible listbox menus, Activity uses its own filter row, and Quick navigation remains the cross-page route and action launcher.
- Existing workspace configuration and backend safety enforcement remain authoritative; the redesign changes presentation, not security policy.

## Phase 8 diagnostics and recovery contract

- Authenticated dashboard diagnostics use one aggregate endpoint: `GET /api/diagnostics`. The page does not assemble unrelated health APIs in the browser.
- Operational failures use stable error codes plus a title, recovery message, action label, route, and retryability flag.
- Invalid JSON and oversized request bodies return structured `request_invalid` responses instead of generic HTTP 500 errors.
- Diagnostic findings include a stable code, severity, impact, recommended action, direct route, and sanitized technical details.
- Diagnostic reports redact approval tokens, bearer credentials, OAuth codes, bootstrap values, passwords, API keys, ngrok account keys, and similarly named object fields before display or copying.
- The Electron main process maintains a bounded service log buffer and persists the same sanitized entries as JSON lines in `<userData>/diagnostics/service.log`. The normal Diagnostics page and failure-only recovery fallback consume the same events.
- Diagnostics supports one combined search plus severity and source filters. Finding totals and log counts update against the filtered view without changing the underlying report.
- **Live tail** is opt-in and refreshes the aggregate diagnostics endpoint every two seconds while the Diagnostics route remains mounted. Leaving the route or encountering a refresh failure stops the polling loop.
- Browser-hosted dashboards explicitly report desktop service logs as unavailable rather than fabricating an empty desktop log source.
- The installed app can open its constrained diagnostics directory and export a secondarily sanitized JSON state file there. Browser dashboards use an equivalent local JSON download and cannot request arbitrary filesystem paths.
- Diagnostics owns local history and log reset controls. Active Rel.AI tool calls block history deletion, browser hosts cannot clear desktop-only runtime logs, and clearing all diagnostic data requires typing `RESET`.
- **Copy report** produces a bounded plain-text report without raw secrets or credential-bearing URLs. **Export state** includes the structured sanitized report and export timestamp.
- Full reset removes Sessions, Activity history, and the persistent service log only. It never removes workspace configuration, repositories, connection settings, OAuth clients, or approval tokens.
- Recovery remains failure-only; log visibility does not create another routine settings or status window.

## Phase 9 navigation and quality-of-life contract

- **Quick navigation** opens from the top bar or `Ctrl+K` / `Cmd+K` and searches primary pages, Settings pages, common actions, and configured workspaces.
- Keyboard users can move command results with Up and Down arrows, execute with Enter, and close with Escape through the existing modal focus trap. Quick navigation does not replace an already active modal or drawer.
- One route policy owns current and legacy dashboard paths. Known aliases normalize to their canonical destinations, malformed or unknown paths fall back to a clean Overview route, and only canonical routes are written to local storage.
- Route parameters use per-page allowlists. Workspace names, filter values, lengths, duplicates, and transient focus state are validated before persistence; credential-like parameter names are removed before a route reaches the address bar or saved state.
- Quick navigation can open the Workspaces page scoped to a selected workspace, focus the matching card after asynchronous route mounting, and remove the transient `focus` marker afterward.
- The top connection status is a direct link to `#settings/connection`; it remains a status indicator and does not create a separate connection surface.
- Activity search, time range, tool, status, task, event, and workspace filters are represented in the route so filtered views can be refreshed, restored, copied, and opened from Sessions or Diagnostics.
- Filter-only route updates use `history.replaceState` to avoid remounting the Activity page on every keystroke.
- Settings forms and workspace add, edit, and path-repair dialogs mark unsaved state. Route changes and page unloads warn before discarding edits; Escape, backdrop clicks, and Cancel require the same discard decision for dirty dialogs.
- Successful route changes close stale detail drawers. Programmatic closes after a successful save bypass discard prompts only after the dirty marker is cleared.
- Workspace removal and partial diagnostic clearing use the shared focus-trapped application confirmation dialog. Higher-consequence full diagnostic reset retains typed `RESET` confirmation.
- Session history controls route to `#settings/diagnostics`, which is the authoritative owner established in Phase 8.
- Quick navigation uses the current in-memory dashboard state and never places credentials or desktop secrets in command data or route parameters.
- Compact layouts keep the command launcher available as an icon while page-owned workspace menus expand to the available width.

## Phase 10 accessibility and responsive contract

- The dashboard begins with a visible-on-focus **Skip to content** link, and the main landmark is programmatically focusable and labelled by the active page heading.
- Route changes, loading states, connection failures, and meaningful Electron recovery-state changes use bounded live-region announcements. Clock-only refreshes do not repeat status announcements.
- Modals and drawers use one shared overlay controller. Focus remains inside the active overlay, Escape closes eligible overlays, background application content becomes inert and hidden from assistive technology, page scrolling is locked, and focus returns to the initiating control.
- Quick navigation follows combobox/listbox semantics with `aria-activedescendant`; only the search input remains in the Tab order while arrow keys select results.
- Activity filters expose pressed state and a polite result-count announcement. Each event row has one keyboard target—the explicit details button—instead of a focusable row plus a duplicate button.
- Mobile navigation and Electron surfaces account for safe-area insets. Common controls reach a minimum 44-pixel target at compact widths, forms and action rows stack, long values wrap, and overlays use dynamic viewport units with internal scrolling.
- The five-item Settings rail becomes horizontally scrollable rather than compressing labels below a readable width.
- Reduced-motion preferences remain authoritative. Forced-colors mode adds explicit active-state outlines instead of relying on background color alone.
- Inactive Electron setup steps are both hidden and `aria-hidden`; only the active step is exposed. Progress uses `aria-current="step"` only on the current item.

## Phase 11 visual hierarchy and density contract

- Elevation is reserved for application framing and transient focus: the dashboard Sidebar and Topbar, dialogs and drawers, the Electron setup surface, and the Electron recovery hero. Routine cards, metrics, tools, workspace panels, and secondary recovery cards remain flat.
- Summary metrics render as one grouped strip with shared borders and separators instead of independent elevated cards. Responsive layouts replace column separators with row separators when the group stacks.
- Workspace readiness, operational facts, and policy facts use grouped panels. Status tone is limited to a slim inset rail or marker rather than coloring every border and background.
- The primary **Add workspace** action is visually explicit. Secondary workspace actions and advanced repository details remain quieter.
- Connection layers use one textual state marker plus one small status dot, without an additional pill or glow. When ChatGPT readiness is already ready, the repeated setup guide collapses under a disclosure.
- Sessions omit the routine **Not published** label. Publication metadata appears only when a commit, push, or draft pull request actually exists.
- Settings introductions use restrained accent rules instead of nested cards, and active Settings navigation uses an accent-tinted state rather than a full high-emphasis fill.
- Diagnostics use grouped counts, slim severity rails, and row separators. Tool cards and routine status indicators do not lift, pulse, or glow on hover.
- Electron recovery health cards share one grouped container; only the recovery hero and initial setup card retain elevated emphasis.
- Phase 10 keyboard, focus, high-contrast, reduced-motion, and compact-layout behavior remains unchanged by the visual-density refinements.

## Windows installer contract

- The published NSIS executable uses an assisted setup wizard rather than a one-click installer.
- The install-mode page offers current-user and all-users installation, with current-user installation selected by default.
- Selecting all-users installation requests Windows administrator elevation when the installer is not already elevated; current-user installation remains available without elevation.
- The destination directory is visible and may be changed before installation.
- Setup creates Start menu and desktop shortcuts for Rel.AI MCP.
- The Finish page includes a **Run Rel.AI MCP** checkbox, selected by default, which the user may clear before closing setup.
- Release and installed-app automation may still use NSIS silent mode with an isolated destination so exact-installer validation remains unattended.

## Phase 12 application update contract

- The Electron main process owns update discovery, download, progress, and installation state through `electron-updater`; renderers never contact release feeds directly.
- Only packaged installed Windows builds support automatic update discovery. Development and portable builds expose an explicit manual GitHub Releases path.
- Installed builds check at most once every 24 hours. The initial eligible check is delayed briefly after startup so update traffic does not compete with service and dashboard startup.
- Automatic checks never imply automatic download or installation. `autoDownload` and install-on-quit remain disabled; the user explicitly starts both download and restart-to-install.
- The normalized update states are `unsupported`, `idle`, `checking`, `up_to_date`, `available`, `downloading`, `downloaded`, `installing`, and `error`.
- `#settings` is the routine update surface. It shows the installed version, availability, bounded download progress, failure codes, and the exact next action. The tray mirrors only the current action.
- Update IPC is exposed only through the sandboxed dashboard preload and accepted only when the sender is the secured dashboard window.
- Restart-to-install is refused while any Rel.AI tool call is active. A downloaded update remains ready until the user retries after active work finishes.
- Update errors remain separate from Local service, Public endpoint, ChatGPT readiness, and Dashboard updates. They are logged as sanitized updater events and do not turn the connection state red.
- GitHub releases must contain both Windows executables plus `latest.yml` and an installer `.blockmap`. Portable builds remain manual-only and must not claim self-update support.

## Security and updater completion contract

- Setup and failure-recovery windows use sandboxed, context-isolated renderers with Node integration disabled, strict Content Security Policy, denied permissions and downloads, blocked webviews and popups, and navigation locked to the configured local renderer file.
- Every Electron IPC action is sender-scoped to its owning window. Setup cannot invoke dashboard controls, dashboard cannot invoke setup or failure-only recovery controls, and unknown renderers cannot use clipboard, service, settings, lifecycle, updater, or diagnostic actions.
- Clipboard payloads are restricted to known Rel.AI windows and 64 KiB. Setup external links allow only HTTPS URLs on the exact `dashboard.ngrok.com` host.
- The ngrok account key is write-only after setup. The dashboard receives only whether a key is configured; blank saves preserve it and nonblank saves replace it.
- Approval-token rotation saves the new token before revocation, restores the previous token when revocation fails, and returns the newly persisted token when only restart fails so the user is not locked out.
- Update candidates must be newer stable versions. Prefixed, prerelease, same-version, downgrade, and downloaded-version mismatch cases fail closed.
- Restart-to-install is enabled only after electron-updater completes SHA-512 release-metadata verification and no Rel.AI tool call is active.
- The release workflow rejects missing SHA-512 updater metadata and publishes `SHA256SUMS.txt` for independent byte-integrity checks.
- Windows artifacts remain unsigned until a code-signing certificate and protected signing workflow are configured. Checksums do not establish publisher identity.

## Usability validation and delivery hardening contract

- Automated package verification is read-only: it builds the unpacked Windows application and verifies required files without starting the executable or invoking installer lifecycle actions.
- Production Electron code must not expose `--installed-smoke`, `--window-smoke`, smoke-only IPC identities, or screenshot-evidence entry points.
- Ordinary package scripts, CI, and release workflows must not install, repair, upgrade, launch, or uninstall Rel.AI MCP.
- The release workflow verifies updater metadata, blockmaps, executable presence, package layout, and checksums before publishing.
- Installer, uninstall, first-run rendering, external endpoint reachability, current ChatGPT OAuth behavior, live OAuth revocation, and production update delivery remain manual approvals on a disposable Windows machine.
- Any future automated installer harness requires an explicit isolation opt-in, a test-specific application identity, ownership markers, constrained cleanup, and refusal when a production installation or active Rel.AI controller is present.

## Phase 13 installed-app lifecycle contract

- Electron main owns startup registration, launch classification, version-transition state, and clean-shutdown markers; renderers receive normalized metadata only.
- The installed Windows app may enable **Launch at sign-in** from `#settings`. Development and portable builds expose an explicit unsupported state and never create startup entries.
- Windows startup registration uses the installed executable plus `--background`. Sign-in launches start the local service, public endpoint, tray, and updater without opening the dashboard. Ordinary launches remain dashboard-first.
- Lifecycle state is stored in `desktop-lifecycle.json` under Electron user data. It contains only version, launch identifiers, counts, timestamps, running state, and clean-exit metadata—never credentials, workspace contents, or approval tokens.
- A version change is reported as a successful update transition after the new process starts. A previous `running: true` marker is reported as recovery after an interrupted exit, not as proof of data loss or corruption.
- `before-quit` writes one idempotent clean-shutdown marker. Forced termination may leave the running marker set for the next launch to diagnose.
- Startup and lifecycle IPC is exposed only through the sandboxed dashboard preload and accepted only from the secured dashboard window.
- Lifecycle notices and failures remain separate from Local service, Public endpoint, ChatGPT readiness, and Dashboard updates; they do not change Connection health.

## Phase 14 window chrome and scrollbar contract

- `electron/window-chrome.js` is the single platform-policy owner. Windows uses a frameless dashboard with Electron's native thick frame, shadow, rounded corners, resize borders, and operating-system snapping. macOS uses `hiddenInset` with native traffic-light controls. Linux and unknown platforms retain their native frame because window-manager behavior is not consistent enough to replace safely.
- The dashboard title bar is rendered once by `src/http/dashboard.js` and styled by `src/ui/styles/app.css`. Its unused surface uses Electron's `-webkit-app-region: drag`; every interactive control uses `no-drag`. The title bar is part of the application shell, not page navigation, and route changes update only its compact context label.
- Window commands follow `renderer -> electron/dashboard-preload.js -> sender-constrained electron/ipc-handlers.js -> electron/dashboard-window.js -> originating BrowserWindow`. The bridge exposes only state retrieval, minimize, maximize/restore toggle, and close. It does not expose generic `send`, `invoke`, native window objects, or Node.js APIs.
- `electron/dashboard-window.js` broadcasts normalized state after native show, minimize, restore, maximize, unmaximize, and fullscreen transitions. `src/ui/window-chrome.js` updates the maximize-versus-restore icon and accessible name, so keyboard shortcuts, snapping, taskbar actions, and external window managers do not leave stale renderer state.
- The close control intentionally uses the existing dashboard close lifecycle. It closes the visible window to the tray during normal operation and destroys it only during application shutdown.
- The custom title bar owns forty CSS pixels. In custom-chrome mode the application shell owns the remaining dynamic viewport height, the sidebar is offset below the title bar, and `main` is the canonical page scroller. Route rerenders preserve that scroller's position instead of relying on page-level scrolling.
- `src/ui/styles/app.css` and `electron/renderer/app.css` define the shared scrollbar width, compact width, track, thumb, hover, active, and corner tokens. Scrollbars remain native CSS scrollbars; no JavaScript scrolling layer or fake thumb is permitted.
- Primary scrolling uses a stable gutter. Dense menus, tables, drawers, command results, diagnostics, code, and log surfaces use the compact width while retaining the same colors and native scrolling behavior.
- Chromium pseudo-elements and standards-based `scrollbar-width`/`scrollbar-color` are both present. Unsupported engines fall back to native appearance. Forced-colors mode restores system canvas colors, reduced-motion rules remain authoritative, and keyboard, wheel, touchpad, inertial, selection, and accessibility semantics remain native.
- Automated tests cover platform selection, window command routing, sender rejection, native state synchronization, accessible labels, drag/no-drag regions, packaging inclusion, scrollbar tokens, and forced-color fallback. Packaged Windows interaction still requires manual verification for drag, double-click, resize, snap, taskbar changes, multiple monitors, and display scaling.

## Phase dependencies

1. Phase 1 may change terminology and page titles but must retain the shared state and error contracts.
2. Phase 2 may reorganize Settings but must keep one owner for every durable setting.
3. Phase 3 renders the normalized connection layers through `src/ui/connection-state.js`; later phases must extend that module rather than recreate raw-flag logic in individual pages.
4. Phase 4 uses stable approval-token state, persistent OAuth revocation, exact confirmation, and a dedicated main-process IPC action.
5. Phase 5 removes the compatibility settings renderer and limits the status renderer to dashboard/service failure fallback.

## Validation requirements

Every phase must run `npm run test:all`. Changes to connection state must add unit tests for each normalized state. Changes to window ownership must update the baseline fixture and Electron launcher tests. Changes to authentication must verify that approval tokens do not appear in URLs, logs, diagnostic reports, or renderer persistence.
