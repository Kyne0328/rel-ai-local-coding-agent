# Desktop usability acceptance

Rel.AI MCP separates non-destructive automated verification from checks that require installing the application, using a real OpenAI Secure MCP Tunnel, or interacting with a logged-in ChatGPT account. CI may launch isolated development/unpacked processes; it never installs or uninstalls the production application on a developer machine.

## Automated non-destructive verification

The automated release gate:

1. runs source tests, lint, type checks, generated-asset checks, release consistency, and dependency policy checks;
2. verifies light/dark color-token parity and generated UI artifacts;
3. fetches and verifies the pinned OpenAI `tunnel-client` for the build platform;
4. builds an unpacked desktop application;
5. verifies the packaged executable, ASAR, backend runtime, dashboard assets, MCP SDK dependencies, tunnel-client manifest and binary, version, and required metadata;
6. rejects obsolete transport resources such as bundled legacy tunnel directories or hosted-gateway code;
7. launches the packaged Node backend in an isolated state directory and proves bearer-authenticated MCP discovery, repository work, guarded mutation, validation, dashboard history, reconnect persistence, and removed legacy routes; and
8. verifies Electron fuse policy against the final unpacked executable.

Typical Windows release verification:

```powershell
npm run test:all
npm run verify:tunnel-client
npm run electron:build:windows
npm run verify:packaged -- --platform win32
npm run test:connector-acceptance
npm run verify:fuses -- --platform win32
```

`verify:packaged` is read-only. `test:connector-acceptance` launches only the isolated packaged Node backend and does not need a real tunnel credential. These checks prove the packaged Rel.AI runtime, not external ChatGPT account state.

## Manual installed-application acceptance

Before publishing a release, use a disposable Windows VM or a dedicated machine that is not hosting active Rel.AI work and record:

- **Installer and uninstall:** install the exact NSIS candidate, complete first-run setup, close it normally, uninstall it, and confirm only expected application files are removed.
- **Real Secure MCP Tunnel:** configure a real Tunnel ID and runtime API key, reach Connected, reconnect after an application restart, and confirm the runtime key is not exposed back to the renderer.
- **Real ChatGPT integration:** associate Rel.AI MCP with that tunnel through ChatGPT's Tunnel connection flow, enable it in a chat, and run one read-only workspace task.
- **Tool-schema behavior:** after a deliberate schema change, confirm ChatGPT observes the current tool snapshot through the product's current refresh/review flow.
- **Update from a previous release:** verify discovery, download, integrity verification, and restart-to-install against the production GitHub Releases feed.
- **Color and theme review:** inspect Overview, Workspaces, Sessions, Activity, Tools, Settings, Diagnostics, setup, and recovery in light and dark themes at normal and narrow widths.
- **Accessibility review:** verify high-contrast and common color-vision-deficiency scenarios; focus, selection, status, and errors must not rely on color alone.

Do not automate installer/uninstaller execution on the same machine that is running the Rel.AI connector used to modify the repository. Production application identity and single-instance behavior can interfere with the active bridge.

## Interpretation

A successful automated gate proves the repository tests pass, reviewed tunnel-client bytes are packaged, the local MCP authentication boundary works, the packaged backend can execute the canonical tool workflow, and required Electron/package hardening is present.

It does **not** prove that a real external tunnel is reachable, that ChatGPT account state is configured correctly, that an administrator has accepted a changed integration, that an antivirus vendor will classify a candidate favorably, or that production update delivery is available. Those require the explicit manual/external evidence above.
