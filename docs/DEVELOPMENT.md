# Rel.AI MCP Development Guide

This document owns source development, build, test, packaging, and local protocol details. Installed-app instructions belong in `README.md`, `docs/ONE_CLICK_SETUP.md`, and `docs/CONNECTING_TO_CHATGPT.md`.

## Supported toolchain

- Node.js 24
- npm 11
- Electron and MCP versions pinned by the repository manifests
- the pinned OpenAI tunnel-client artifact for the target platform

The root package and Electron package have separate lockfiles. Keep both synchronized when dependencies change.

## Install source dependencies

```powershell
npm ci --ignore-scripts
npm ci --prefix electron
```

Electron packaging automatically fetches the pinned OpenAI tunnel client when the target-platform binary is absent, then verifies its size and SHA-256 before packaging. You can also prefetch and verify it explicitly:

```powershell
npm run fetch:tunnel-client
npm run verify:tunnel-client
```

## Run from source

```powershell
npm run electron:dev
```

The desktop application owns normal startup. Direct HTTP entry points are maintained for development, protocol testing, and packaged-runtime verification only.

```powershell
npm run start:http
```

The default loopback service commonly uses `http://127.0.0.1:3333`. Health and dashboard routes are development diagnostics, not user setup steps.

## Generated assets

Dashboard CSS is generated from `src/ui/styles/app.css` and its feature imports:

```powershell
npm run build:css
```

Color tokens are generated for dashboard, Electron, and documentation surfaces:

```powershell
npm run generate:color-tokens
npm run verify:color-tokens
```

Do not hand-edit generated output when a source generator owns it.

## Validation

Run the smallest checks that prove the change, then the complete gate before release work.

```powershell
npm run check
npm run lint
npm run typecheck
npm run knip:dependencies
node test/run-tests.mjs
```

Complete verification:

```powershell
npm test
```

Tests are risk controls. Prefer the smallest non-overlapping set that protects business behavior, security, validation, transactions or concurrency, data integrity, external protocol compatibility, or a meaningful release contract.

## Dashboard architecture

- `src/http/dashboard.js` renders the application shell.
- `public/dashboard.js` owns dashboard startup and live data integration.
- `src/ui/navigation-catalog.js` owns route and navigation metadata.
- `src/ui/router.js` owns canonical hash routing.
- `src/ui/features/` owns page behavior.
- `src/ui/components/` owns shared controls.
- `src/ui/styles/app.css` is the generated CSS entry.

Feature styles are split into:

- `src/ui/features/home/styles.css`
- `src/ui/features/onboarding/styles.css`
- `src/ui/features/settings/styles.css`
- `src/ui/features/system/styles.css`
- `src/ui/components/filter-controls.css`

Keep route metadata centralized. Compatibility redirects may remain in `route-policy.js`, but removed routes must not return as visible destinations.

## Electron architecture

- `electron/main.js` owns desktop lifecycle and window orchestration.
- `electron/renderer/wizard.html` and `wizard.js` own first-run and connection-recovery editing.
- preload files expose narrow IPC contracts.
- `electron/ipc-handlers.js` validates renderer requests and sender ownership.
- the dashboard is the routine application surface; the status window is recovery-only.

The wizard owns the minimal installed-app connection setup: Tunnel ID, write-only runtime API key, optional advanced local port, and a single action to start the secure connection.

Developer-only file paths, commands, and diagnostic URLs must not appear in that flow.

## Configuration

Repository development may create or inspect the application’s JSON configuration and environment-backed secrets. Production UI must use secured Electron IPC and must not instruct users to edit those files directly.

Useful development commands include:

```powershell
npm run init-config
npm run workspace:add
```

Rel.AI discovers validation commands from the project's current manifests. Use `relai_validate` for explicit one-off checks and `relai_exec` for other bounded one-shot commands; command aliases are not stored in Rel.AI configuration.

## Packaging

Build unpacked applications:

```powershell
npm run electron:build:windows
npm run electron:build:linux
```

Build release artifacts:

```powershell
npm run electron:dist:windows
npm run electron:dist:linux
```

Verify package contents and budgets:

```powershell
npm run audit:packaging
npm run verify:packaged
npm run verify:fuses
npm run electron:size:windows
npm run electron:size:linux
```

Electron runtime resources are fail-closed against packaging drift. Runtime roots listed by the root package (`src/`, `bin/`, `public/`, and `skills/`) are copied as complete trees instead of extension allowlists. `examples/` and `types/` are the explicit non-Electron package roots. `test/electron-launcher-smoke.mjs` requires every runtime root to have an Electron resource mapping, and `scripts/verify-packaged-app.mjs` recursively compares the built artifact's file list and SHA-256 content with source. Adding a new root runtime directory therefore fails verification until it is packaged or deliberately classified as non-Electron.

## Release validation

```powershell
npm run release:check
npm run test:release
npm run verify:updater-artifacts
```

Release publication, signing status, checksums, updater metadata, and artifact policy are documented in the release and security documents. Do not publish from an unverified dirty tree.

## Public product-path scanner

`test/electron-product-path-unit.mjs` protects the installed-app path from developer-only setup language. Add new public documents or visible connection copy to its declared surface list when appropriate.

The scanner intentionally excludes this development guide and other internal engineering documents.

### ChatGPT setup review note

Treat generic claims that Rel.AI's Secure MCP Tunnel setup must move to **Settings / Workspace settings → Apps → Create** as stale review evidence unless the actual Tunnel setup flow has been revalidated against the shipped ChatGPT UI. Rel.AI's supported product contract is the tested **Tunnel + No authentication** flow in `docs/CONNECTING_TO_CHATGPT.md` and the current dashboard handoff. Do not file an onboarding defect solely because generic OpenAI Apps documentation uses different navigation labels or because the implementation uses the existing ChatGPT connector setup route.

## Engineering principles

- Use DRY, KISS, and YAGNI.
- Prefer direct imports for stable stateless utilities.
- Inject only real runtime boundaries.
- Keep factories limited to state, resources, framework objects, or external clients.
- Consolidate each task against all earlier changes before moving forward.
- Preserve existing staged and user-authored work.
- Verify generated output after source changes.
- Do not commit release artifacts or secrets.

## Related documents

- `docs/ARCHITECTURE.md`
- `docs/DESKTOP_UX_ARCHITECTURE.md`
- `docs/MCP_PROTOCOL_POLICY.md`
- `docs/PACKAGE_MANAGEMENT.md`
- `RELEASE.md`
- `docs/SECURITY.md`
- `CONTRIBUTING.md`
