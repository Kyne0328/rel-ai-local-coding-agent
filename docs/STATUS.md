# Release status

## 0.23.0 ESM hard cutover

Version `0.23.0` remains unreleased. The consolidated `main` candidate now contains the reconciled runtime-hardening, task-observability, release, ESM, ChatGPT connection-scan compatibility, and native-task storage work. Aggregate source, dashboard, packaging, dependency, updater, protocol, and benchmark validation passes; publication still requires the protected signed build and disposable-machine lifecycle checks.

### Implemented

- Root, backend, CLI, MCP transports, OAuth, telemetry, task/process/worktree runtime, build/release scripts, Electron main process, renderers, and tests use ESM.
- `electron/preload.cjs` is the only retained CommonJS boundary and is restricted to Electron's sandbox preload API.
- Duplicate preload files and obsolete dashboard route aliases are removed.
- Generated color assets have a non-mutating freshness gate before tests, release checks, and packaging.
- BrowserWindow startup canvases use one neutral main-process-owned pre-render color.
- OAuth CSS is tested through the production HTTP route.
- MCP SDK runtime resources exclude build-only source, test, TypeScript, and declaration trees.
- HTTP accepts the SDK-supported stateless ChatGPT `2025-11-25` initialization and tool-scan envelope while native `2026-07-28` requests and stdio remain strict.
- Native-task storage errors are typed and sanitized, corrupt records are quarantined, and release rebuilds invalidate stale derived evidence before regeneration.

### Automated gates passed

- JavaScript syntax, ESLint, TypeScript boundaries, production and dependency Knip models, release consistency, and the complete 157-file aggregate test suite pass.
- Real Electron Chromium dashboard acceptance across 640px, 320 CSS-pixel, 375 CSS-pixel, and 400% zoom scenarios; temporary screenshots are reviewed during the test and removed.
- Root and Electron production dependency audits: zero advisories; production Knip covers shipped root, dashboard, and Electron runtime entries.
- Windows x64 unpacked build, NSIS installer, portable executable, blockmap, and update metadata generation.
- Packaged layout, ESM runtime, OAuth/MCP connector, task attribution, validation, completion, reconnect rejection, and removed-route acceptance.
- Electron fuse-policy verification.
- Strict 0.23.0 package-size baseline with exact canonical filenames, a 3% tolerance, one locale, zero source maps, zero source CSS, and zero packaged TypeScript files.
- Executable observability benchmark: 18/18 backend and Electron renderer metrics passed, with incomplete runs failing closed.
- Exact updater artifact verification binds `latest.yml` SHA-512 metadata and `SHA256SUMS.txt` to the published installer basename and bytes.
- CycloneDX SBOM generation.

### Publication and manual gates remaining

- Local artifacts are unsigned because protected Windows signing credentials are not available in this environment. Publication must run through the protected release workflow and produce valid Authenticode signatures.
- Installer install/uninstall, first-run desktop renderer, production-identity startup, real ngrok publication, logged-in ChatGPT app selection, and upgrade behavior remain manual checks on a disposable Windows machine.
- The release tag and GitHub publication have not been created.
- Electron packaging development dependencies currently report one advisory across 16 transitive build-only packages. A fail-closed policy accepts only the reviewed advisory and package set through 2026-08-31; any new, runtime-reachable, critical, or expired finding blocks publication. Shipped production dependencies report zero advisories.

See [ESM_ARCHITECTURE.md](ESM_ARCHITECTURE.md), [COLOR_SYSTEM.md](COLOR_SYSTEM.md), [ELECTRON_PACKAGE_SIZE.md](ELECTRON_PACKAGE_SIZE.md), and [RELEASE.md](RELEASE.md).
