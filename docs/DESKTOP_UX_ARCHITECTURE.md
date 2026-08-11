# Rel.AI MCP Desktop UX Architecture

## Purpose

This document describes the production desktop experience after the frontend streamlining cutover. It defines visible navigation, route ownership, setup behavior, shared filters, responsive rules, and implementation boundaries.

Source development and packaging instructions live in [DEVELOPMENT.md](DEVELOPMENT.md).

## Product entry path

Rel.AI is an installed desktop application. The normal user path is:

1. Open Rel.AI MCP.
2. Complete the three-step setup wizard when required.
3. Add a workspace from Workspaces.
4. Connect ChatGPT from Connection.
5. Work through Overview, Sessions, Workspaces, and Activity.

The dashboard is the routine application surface. The separate status window is recovery-only.

## First-run wizard

The Electron wizard owns initial Cloud pairing and explicit Advanced recovery/Direct fallback. It remains exactly three steps.

### Step 1: Connect ChatGPT

The normal path starts the local service plus outbound gateway client and shows a short-lived pairing code. It does not ask for a local port, ngrok credentials, or the Direct approval token. Advanced setup retains accountless recovery and Direct connection fields.

### Step 2: Secure this device

After authenticated pairing, the user may explicitly reveal the recovery code or use an already paired desktop to create a one-time device-link code. Private device-key material never appears in renderer state or public setup copy.

### Step 3: Ready

The wizard confirms the Cloud/Direct connection mode, then opens the dashboard on the canonical **Connection** route. Public setup copy must not expose source-development files, commands, diagnostic URLs, private keys, recovery secrets, or pairing poll tokens.

## Overview setup checklist

Browser-style onboarding has been removed from the production path.

Overview renders `desktopSetupItems({ hasWorkspace, chatgptReady })` and shows only unfinished work:

- Add a workspace.
- Connect ChatGPT.

The checklist:

- appears after active session information;
- has one primary action and an optional secondary action;
- can be dismissed;
- persists dismissal and completion state;
- disappears when all setup work is complete.

The readiness card must not repeat warnings already represented by the checklist.

## Navigation ownership

`src/ui/navigation-catalog.js` is the single source of route labels, descriptions, groups, icons, and command-palette destinations.

### Work

1. Overview — `#home`
2. Sessions — `#tasks`
3. Workspaces — `#workspaces`
4. Activity — `#activity`

### Application

1. System — `#system`
2. Settings — `#settings`

System owns the runtime destinations through its secondary rail: Connection (`#connection`), Processes (`#processes`), Diagnostics (`#diagnostics`), Tools (`#tools`), and Usage (`#usage`). Direct hashes remain canonical so contextual links can open the exact System page without an extra navigation step.

### Mobile navigation

The mobile navigation contains exactly:

1. Overview
2. Sessions
3. Workspaces
4. Activity
5. Settings

System destinations and Skills remain reachable through the command palette and related page actions on narrow screens. Skills opens inside Settings; System destinations open inside the System secondary rail.

## Route policy

`src/ui/route-policy.js` owns canonical route normalization and route parameter allowlists.

Legacy hashes may redirect for compatibility, but removed routes must never appear as visible navigation destinations. Important redirects include:

- `#skills` → `#settings/skills`
- `#settings/connection` → `#connection`
- `#settings/diagnostics` → `#diagnostics`
- `#settings/general` → `#settings`
- `#settings/dashboard` → `#settings/advanced`
- `#settings/desktop` → `#settings/application`

`src/ui/features/system/index.js` mounts Connection, Processes, Diagnostics, Tools, and Usage inside the shared System rail.

## Settings ownership

Settings contains five focused categories.

### Preferences

- theme;
- interface density;
- desktop notifications.

### Skills

- install and remove reusable skills;
- inspect built-in and installed skills;
- assign available skills to configured workspaces.

### Application

- launch at sign-in;
- lifecycle and recovery state;
- application updates.

### Advanced

- patch safeguards;
- resource limits;
- other expert controls that do not belong to a feature page.

### About

- application version;
- project and repository information;
- license information.

Workspace validation display is not a global Settings concern. It is owned by Workspaces and preserves the `productUx.showAutomaticValidation` preference.

## Shared ChatGPT guidance

Connection guidance distinguishes the default Cloud flow from Advanced Direct recovery. Cloud setup uses the stable gateway endpoint, OAuth, and a short-lived pairing code. Direct setup uses the managed-ngrok endpoint and local approval-token OAuth. Tool refresh, OAuth reauthentication, and device update states must never be presented as interchangeable recovery actions.

Both modes include the same safe first read-only request.

## Connection page

Connection is status-first.

The page renders:

1. one status-first connection summary;
2. the active Cloud or Direct endpoint when relevant;
3. one primary next action;
4. quiet Refresh status and Diagnostics actions;
5. expandable connection layers;
6. Cloud pairing/device/recovery controls when Cloud is selected;
7. Advanced Direct controls only when Direct is selected;
8. synchronization guidance that keeps tool refresh, OAuth reauthentication, and device compatibility separate.

### Connection layers

The expandable layer disclosure contains five independent concerns:

1. Connection service
2. Secure endpoint / public connection
3. Authorization
4. Client and tools
5. Dashboard updates

The disclosure opens automatically when the connection is unhealthy.

### Cloud controls

Cloud controls own pairing, paired-device state, recovery, revocation, and schema/device synchronization. Passive status must not expose principal identifiers, private keys, recovery secrets, pairing poll tokens, or OAuth bearer material.

### Advanced Direct controls

Direct controls own the local port, static ngrok domain/account key, and approval-token replacement. Replacing the Direct token revokes Direct OAuth state but preserves the registered app/endpoint where possible; it is not a Cloud schema-refresh operation.

## Shared filter system

Activity, Tools, and Diagnostics use:

- `src/ui/components/filter-bar.js`
- `src/ui/components/filter-drawer.js`
- `src/ui/components/filter-controls.css`

### Filter bar contract

- search remains visible;
- Filters shows the number of active non-search filters;
- active filters appear as removable chips;
- Clear all removes search and filters;
- a live result summary uses `role="status"`;
- operational actions are passed separately from filter state.

### Filter drawer contract

- edits are stored in a draft;
- Apply commits the draft;
- Reset restores defaults;
- Cancel closes without applying;
- the desktop layout uses a side drawer;
- screens at or below 520 px use a bottom sheet.

### Activity

Visible controls:

- search;
- Filters;
- Freeze or Resume live list.

Drawer controls:

- time range;
- workspace;
- tool;
- status.

Task scope appears as a removable chip. Workspace changes navigate through the router because they change the data scope. Other filters update the current route without remounting.

### Tools

Visible controls:

- search;
- Filters.

The drawer contains one capability selector with live counts for All, Inspect, Edit, Validate, Git, and Recover.

### Diagnostics

Visible controls:

- search;
- Filters;
- live-tail toggle.

Drawer controls:

- scope: All diagnostics, Findings, Service log, Failed activity;
- severity;
- source.

Source is disabled when Findings is selected. Findings and logs keep separate counts.

## Overview hierarchy

Overview prioritizes:

1. active work-session information;
2. unfinished setup checklist;
3. compact connection readiness;
4. attention items not already represented by setup;
5. supporting workspace and activity information.

The compact readiness card links to Connection rather than repeating endpoint and approval controls.

## Styling ownership

`src/ui/styles/app.css` owns the shared Tailwind entry and base application styles.

Feature ownership is split into:

- `src/ui/features/home/styles.css`
- `src/ui/features/onboarding/styles.css`
- `src/ui/features/settings/styles.css`
- `src/ui/features/system/styles.css`
- `src/ui/components/filter-controls.css`

Generated `public/dashboard.css` must be rebuilt after source style changes.

## Responsive behavior

- Desktop uses the sidebar and Settings rail.
- Narrow screens use the five-item bottom navigation.
- Search and filter controls wrap without horizontal overflow.
- Filter drawers become bottom sheets at 520 px and below.
- Cards and tables retain meaningful labels and touch targets.
- Fixed elements account for safe-area insets.

## Accessibility

Required behavior includes:

- current navigation uses `aria-current`;
- drawer focus is contained and restored on close;
- route changes are announced;
- filter summaries use live status semantics;
- row actions have distinguishable labels;
- setup headings receive focus after wizard transitions;
- color is never the only status signal.

## Test ownership

Tests protect behavior and meaningful regressions rather than source wording.

Required contracts include:

- navigation and route structure;
- three-step wizard behavior;
- Electron-first public product scanner;
- shared filter semantics and responsive bottom sheet;
- Activity history and route transitions;
- Connection create and reconnect guidance;
- Settings ownership;
- generated CSS and mobile navigation;
- browser acceptance for representative routes.

The smallest non-overlapping set should cover each risk. Existing tests should be consolidated or replaced when architecture changes make literal assertions stale.

