# Desktop Notification Preferences Design

## Goal

Give Rel.AI desktop users precise control over native notifications while preserving the existing master switch and adding a reliable update-available modal.

## Preference model

Electron owns one persisted preference object:

```js
{
  enabled: true,
  taskCompleted: true,
  errors: true,
  connectionStatus: true,
  applicationUpdates: true,
  ignoredUpdateVersion: ""
}
```

The master value suppresses every native notification without changing category values. Missing or invalid state falls back to all categories enabled.

## Categories

- Task completed: explicit Rel.AI work-session completion.
- Errors and failed operations: workspace failures, service or tunnel failures, and updater failures.
- Connection and service status: ready, stopped, or authorization-required transitions.
- Application updates: update available and update ready to install.

Each event maps to one category to avoid duplicate notifications.

## Persistence and compatibility

A focused Electron service normalizes and atomically stores preferences in the application user-data directory. The recovery-window switch remains a master-only compatibility control. The dashboard receives the full object through secured IPC and writes normalized patches.

## Update modal

A dashboard-wide controller listens to updater status independently of the Settings route. When state is `available`, it opens once during that application launch unless the exact version is already shown, downloaded, or equal to `ignoredUpdateVersion`.

Actions:

- Download update: starts the existing download flow.
- Later: dismisses for the current launch only.
- Ignore this version: persists the exact version and suppresses both the modal and native update notification for it.

A newer version is not suppressed. Settings can clear the ignored version.

## Integration

Task activity delegates notification delivery to the centralized service. Electron main routes desktop status transitions and updater status changes into the same service. The global dashboard controller reuses the existing modal, toast, and updater bridge APIs.

## Failure behavior

Preference write failures do not change the in-memory snapshot. Settings controls revert and show an error toast. Native notification failures are logged and do not interrupt tasks, connection handling, or updates.

## Testing

Tests cover normalization, persistence, category filtering, version ignore behavior, status mapping, task delegation, update-modal eligibility, IPC exposure, and Settings labels.
