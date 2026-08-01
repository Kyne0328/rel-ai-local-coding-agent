# Desktop usability acceptance

Rel.AI MCP separates non-destructive automated package verification from checks that require installing, launching, updating, or removing the real desktop application.

## Automated non-destructive verification

The automated Windows gate does not run an installer or executable. It performs these steps:

1. runs the complete source test, lint, type, release-consistency, and color-accessibility suite;
2. verifies canonical light/dark token parity, contrast thresholds, generated color artifacts, status semantics, and the raw-color policy;
3. builds an unpacked Windows application with publishing disabled;
4. verifies the packaged executable and ASAR are present;
5. verifies packaged server, tool-registry, color-token, configuration, CLI, dashboard, changelog, and package metadata files;
6. verifies the schema-v2 ngrok acquisition manifest is packaged and `ngrok.exe` is absent from the application;
7. confirms the packaged version matches the repository version; and
8. separately exercises consent, reuse, tamper repair, archive verification, and release-time end-to-end acquisition.

Run the same checks locally:

```powershell
npm run test:colors
npm run test:all
npm run electron:build
npm run verify:packaged
npm run test:connector-acceptance
```

To inspect another unpacked build directory:

```powershell
npm run verify:packaged -- --dir C:\path\to\win-unpacked
```

`verify:packaged` only reads files. `test:connector-acceptance` launches the isolated packaged Node backend to exercise OAuth and MCP, but it does not launch Electron, install software, invoke an uninstaller, modify the user's Rel.AI profile, or interact with the running Rel.AI instance.

## Manual installed-application acceptance

Before publishing a release, test installation on a disposable Windows VM or another machine that is not hosting active Rel.AI work. Record these checks manually:

- **Installer and uninstall:** install the exact NSIS candidate, complete first-run setup, close it normally, uninstall it, and confirm only expected application files are removed.
- **Real ngrok publication:** clean first run must publish the configured permanent domain from a real ngrok account and remain externally reachable.
- **ChatGPT OAuth:** a real ChatGPT app must discover the OAuth endpoints, complete approval, and successfully call `relai_status`.
- **Live approval-token rotation:** the existing ChatGPT app must lose its current grants, request approval again, and reconnect with the replacement token without changing the MCP URL.
- **Update from a previous published release:** the previous installed release must discover, download, verify, and install the candidate through the production GitHub Releases feed.
- **Color and theme review:** inspect dashboard Overview, Workspaces, Sessions, Activity, Tools, Settings, Diagnostics, setup, recovery, and OAuth states in light and dark themes. Verify default, hover, focus, active, selected, disabled, loading, success, warning, danger, disconnected, and empty states at desktop and narrow viewport sizes.
- **Accessibility simulation:** review Windows high contrast and common color-vision-deficiency simulations, confirming that status, focus, selection, and errors never rely on color alone.

Do not automate installer or uninstaller execution on a developer machine running Rel.AI MCP. The packaged executable uses the same application identity and single-instance behavior as the live app, so an automated installed-app harness can terminate or interfere with the active bridge.

## Interpretation

A successful automated gate proves the repository tests pass and the unpacked package contains the required application resources. It does not prove installer behavior, rendered desktop journeys, external connectivity, OAuth behavior, token revocation, uninstall behavior, or production updates. Those checks remain manual release evidence.
