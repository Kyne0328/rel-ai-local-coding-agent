# Rel.AI MCP Desktop UX Architecture

## Purpose

This document defines the current production desktop experience after the Secure MCP Tunnel hard cutover: navigation, setup behavior, Connection ownership, shared filters, responsive rules, and renderer boundaries.

Source development and packaging instructions live in [DEVELOPMENT.md](DEVELOPMENT.md).

## Product entry path

Rel.AI is an installed desktop application. The normal path is:

1. Open Rel.AI MCP.
2. Enter the OpenAI Secure MCP Tunnel ID and runtime API key when setup is required.
3. Start the secure connection.
4. Add a repository under **Workspaces**.
5. Create or reconnect the Rel.AI MCP integration in ChatGPT through the Tunnel connection option.
6. Work through Overview, Sessions, Workspaces, Activity, and System.

The dashboard is the routine application surface. The separate status window is recovery-only.

## First-run wizard

The wizard is intentionally small. It owns only the connection values required to start Rel.AI:

- Tunnel ID;
- write-only runtime API key;
- advanced local port when the default conflicts; and
- the action that saves configuration and starts the connection.

It does not expose source-development files, shell commands, diagnostic URLs, internal bearer tokens, or provider selection. Existing valid configuration may bypass the wizard and open the dashboard directly.

## Overview setup checklist

Overview shows only unfinished product work:

- choose a workspace;
- configure the secure tunnel;
- connect ChatGPT; and
- send a safe first Rel.AI request.

The checklist has one current action, supports dismissal, persists completion state, and disappears when setup is complete. It must not duplicate warnings already owned by Connection.

## Navigation ownership

`src/ui/navigation-catalog.js` is the source of route labels, descriptions, groups, icons, and command-palette destinations.

### Work

1. Overview — `#home`
2. Sessions — `#tasks`
3. Workspaces — `#workspaces`
4. Activity — `#activity`

### Application

1. System — `#system`
2. Settings — `#settings`

System owns Connection, Processes, Diagnostics, Tools, and Usage through the desktop sidebar accordion. Settings uses the same desktop pattern; their in-page rails remain as a responsive fallback below the full desktop layout. Direct hashes remain canonical for contextual navigation.

### Mobile navigation

The compact navigation keeps the top-level destinations available in the desktop navigation model; System subpages remain reachable through their owning surface and the command palette.

## Route policy

`src/ui/route-policy.js` owns canonical route normalization and allowed route parameters. Compatibility redirects may remain for removed dashboard hashes, but deleted connection modes must not return as visible destinations.

## Settings ownership

Settings remains focused on application preferences rather than duplicating feature controls:

- **Preferences** — theme, density, notifications.
- **Application** — launch-at-sign-in, lifecycle state, updates.
- **Advanced** — expert safeguards and resource limits.
- **About** — version, project, repository, and license information.

The Secure MCP Tunnel configuration lives on **Connection**, not in generic Settings.

## Shared ChatGPT guidance

`src/ui/features/settings/connection-guidance.js` owns the canonical create/reconnect guidance. It must describe only OpenAI Secure MCP Tunnel:

- create a tunnel and runtime API key;
- save the Tunnel ID and key in Rel.AI;
- wait for Connected;
- associate ChatGPT's Rel.AI MCP integration with that tunnel; and
- send the safe first read-only request.

Transport recovery, application updates, tool-schema refresh, and repository work completion are separate concepts and must not be presented as interchangeable actions.

## Connection page

Connection is status-first. It renders:

1. local connection health;
2. Secure MCP Tunnel health;
3. the configured Tunnel ID where useful;
4. one primary recovery/setup action;
5. quiet refresh and Diagnostics actions;
6. expandable connection layers; and
7. the tunnel settings form with a write-only replacement runtime key.

The advanced port control stays collapsed because most users never need it.

### Connection layers

The shared disclosure separates:

1. Connection service
2. Secure tunnel
3. Authentication
4. Client and tools
5. Dashboard updates

The disclosure may open automatically when an unhealthy layer needs attention.

## Shared filter system

Activity, Tools, and Diagnostics use the shared filter bar/drawer components. Search remains visible, filters open in a drawer or narrow-screen sheet, active filters render as removable chips, Clear all resets the current view, and result summaries use live status semantics.

Feature-specific filters remain owned by their feature rather than duplicated in global state.

## Overview hierarchy

Overview prioritizes:

1. active work-session information;
2. unfinished setup;
3. compact connection readiness;
4. attention items not already represented by setup; and
5. supporting workspace/activity information.

## Styling ownership

`src/ui/styles/app.css` is the shared generated-style entry. Feature styles live with their owning feature under `src/ui/features/` or `src/ui/components/`. `public/dashboard.css` is generated and must be rebuilt after source style changes.

## Responsive and accessibility behavior

- Controls wrap without horizontal overflow.
- Drawers become bottom sheets on narrow screens where defined.
- Cards and tables retain meaningful labels and touch targets.
- Fixed elements account for safe-area insets.
- Current navigation uses `aria-current`.
- Dialog/drawer focus is contained and restored.
- Route changes and live summaries are announced.
- Color is never the only status signal.

## Test ownership

Tests protect behavior rather than historical source wording. Required contracts include navigation, tunnel-only setup, Electron-first public product copy, Connection create/reconnect guidance, sender-constrained IPC, shared filters, generated CSS, and representative browser acceptance. Obsolete transport-specific tests should be replaced rather than kept as dead compatibility coverage.
