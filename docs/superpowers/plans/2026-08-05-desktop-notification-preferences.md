# Desktop Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add persisted category-level desktop notification controls and a launch-time update modal with exact-version ignore behavior.

**Architecture:** A single Electron notification service owns normalized preferences, persistence, native delivery, and transition mapping. Task activity delegates to it, while a dashboard controller owns the update modal and uses the same IPC preference contract.

**Tech Stack:** Electron, JavaScript ES modules, Node durable JSON helpers, existing modal/toggle/toast components, Node assert tests.

## Global Constraints

- Preserve the existing master switch.
- Support exactly four categories.
- Ignore only the exact selected update version.
- Show the available-update modal once per application launch until downloaded or ignored.
- Add no dependency.
- Preserve unrelated working-tree changes.
- Create one final commit and do not push.

---

### Task 1: Notification service

**Files:** Create `electron/desktop-notifications.js`; create `test/desktop-notifications-unit.mjs`.

**Interfaces:** Produce `normalizeNotificationPreferences` and `createDesktopNotifications`, returning preference read/update methods, `show`, `handleDesktopStatusChange`, and `handleUpdateStatus`.

- [x] Write failing normalization, persistence, category, ignore-version, and transition tests.
- [x] Run the test and verify failure because the module is missing.
- [x] Implement the minimal service.
- [x] Run the test and verify pass.

### Task 2: Runtime integration

**Files:** Modify `electron/tool-sleep-blocker.js`, `electron/main.js`, `electron/desktop-settings.js`, `test/task-completion-notifier-unit.mjs`, and `test/desktop-settings-unit.mjs`.

- [x] Change tests to require category-aware delegation and master-switch compatibility.
- [x] Run focused tests and verify failure.
- [x] Integrate the service and preserve legacy behavior.
- [x] Run focused tests and verify pass.

### Task 3: IPC and Settings

**Files:** Modify `electron/ipc-handlers.js`, `electron/preload.cjs`, `src/ui/features/settings/general.js`, `src/ui/features/settings/desktop-notifications.js`, and `test/desktop-ui-smoke.mjs`.

- [x] Add failing smoke assertions for preference IPC and four category labels.
- [x] Add secured IPC, preload methods, category toggles, and ignored-version reset.
- [x] Run the smoke test and verify pass.

### Task 4: Update modal

**Files:** Create `src/ui/update-available-modal.js`, create `test/update-available-modal-unit.mjs`, modify `public/dashboard.js`, and extend `test/desktop-ui-smoke.mjs`.

- [x] Write failing pure eligibility tests.
- [x] Implement modal eligibility, actions, and dashboard initialization.
- [x] Run modal and UI smoke tests and verify pass.

### Task 5: Validation and commit

- [x] Run focused notification, updater, settings, and UI tests.
- [x] Run `npm run check`.
- [x] Review `git diff --check`, the complete diff, and status.
- [x] Stage only feature files and create one commit without pushing.
