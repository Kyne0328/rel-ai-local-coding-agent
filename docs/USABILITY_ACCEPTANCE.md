# Desktop usability acceptance

Rel.AI MCP separates isolated automated package verification from checks that require installing, updating, removing, or using real external ChatGPT/Cloud/ngrok services. CI may launch the unpacked Electron application only with isolated profile/state directories and test-local endpoints; it never installs or uninstalls the product.

## Automated non-destructive verification

The automated package gate never runs an installer or uninstaller. It performs these steps:

1. runs the complete source test, lint, type, release-consistency, and color-accessibility suite;
2. verifies canonical light/dark token parity, contrast thresholds, generated color artifacts, status semantics, and the raw-color policy;
3. builds an unpacked Windows application with publishing disabled;
4. verifies the packaged executable and ASAR are present;
5. verifies packaged server, tool-registry, color-token, configuration, CLI, dashboard, changelog, and package metadata files;
6. verifies the bundled Windows ngrok seed exists and is nonempty;
7. confirms the packaged version matches the repository version; and
8. launches the unpacked Electron desktop in an isolated profile against a localhost fake gateway to verify Cloud challenge authentication, workspace advertisement, one routed read-only tool call, and graceful shutdown.

Run the same checks locally:

```powershell
npm run test:colors
npm run test:all
npm run electron:build
npm run verify:packaged
npm run test:connector-acceptance
npm run gateway:acceptance -- --platform win32 --dir <resolved-unpacked-directory>
```

To inspect another unpacked build directory:

```powershell
npm run verify:packaged -- --dir C:\path\to\win-unpacked
```

`verify:packaged` only reads files. `test:connector-acceptance` launches the isolated packaged Node backend. `gateway:acceptance` launches the **unpacked** Electron desktop with unique Electron user-data and Rel.AI state directories plus a localhost fake gateway; it does not install/uninstall software, use production Cloud credentials, or share the running Rel.AI profile.

## Manual installed-application acceptance

Before publishing a release, test installation on a disposable Windows VM or another machine that is not hosting active Rel.AI work. Record these checks manually:

- **Installer and uninstall:** install the exact NSIS candidate, complete first-run setup, close it normally, uninstall it, and confirm only expected application files are removed.
- **Real Rel.AI Cloud pairing:** against the intended deployed environment, a clean profile must create a short-lived pairing code, complete the real ChatGPT OAuth flow, reach Connected, and run a read-only workspace call.
- **ChatGPT schema/admin behavior:** confirm the real ChatGPT app sees the current tool snapshot and follow the current refresh/review/republication workflow after a schema change; automated `tools/list` observation cannot prove host-cache acceptance.
- **Direct fallback:** publish the configured permanent ngrok domain from a real account, complete Direct approval-token OAuth, rotate the Direct token, and reconnect without changing the Direct MCP URL.
- **Update from a previous published release:** the previous installed release must discover, download, verify, and install the candidate through the production GitHub Releases feed.
- **Color and theme review:** inspect dashboard Overview, Workspaces, Sessions, Activity, Tools, Settings, Diagnostics, setup, recovery, and OAuth states in light and dark themes. Verify default, hover, focus, active, selected, disabled, loading, success, warning, danger, disconnected, and empty states at desktop and narrow viewport sizes.
- **Accessibility simulation:** review Windows high contrast and common color-vision-deficiency simulations, confirming that status, focus, selection, and errors never rely on color alone.

Do not automate installer or uninstaller execution on a developer machine running Rel.AI MCP. The packaged executable uses the same application identity and single-instance behavior as the live app, so an automated installed-app harness can terminate or interfere with the active bridge.

## Interpretation

A successful automated gate proves the repository tests pass, the unpacked package contains the required resources, and the isolated unpacked Electron client can complete the fake-gateway protocol path. It does not prove installer/uninstaller behavior, production Cloud availability, real ChatGPT account/workspace approval, real Direct ngrok reachability, external-service revocation behavior, antivirus-vendor outcomes, or production updates. Those checks remain separate deployment/manual release evidence.
