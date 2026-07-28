# Release status

## 0.23.0 ESM hard cutover

Version `0.23.0` remains unreleased. The consolidated `main` candidate now contains the runtime-hardening, task-observability, and ESM workstreams in one history and has passed all automated repository and packaged-runtime gates available on this machine.

### Implemented

- Root, backend, CLI, MCP transports, OAuth, telemetry, task/process/worktree runtime, build/release scripts, Electron main process, renderers, and tests use ESM.
- `electron/preload.cjs` is the only retained CommonJS boundary and is restricted to Electron's sandbox preload API.
- Duplicate preload files and obsolete dashboard route aliases are removed.
- Generated color assets have a non-mutating freshness gate before tests, release checks, and packaging.
- BrowserWindow startup canvases use one neutral main-process-owned pre-render color.
- OAuth CSS is tested through the production HTTP route.
- MCP SDK runtime resources exclude build-only source, test, TypeScript, and declaration trees.

### Automated gates passed

- Full repository suite: 137/137 test files.
- JavaScript syntax, ESLint, TypeScript boundaries, Knip dependency analysis, repository-health budgets, and release consistency.
- Real Electron Chromium dashboard acceptance with retained screenshot evidence.
- Root and Electron production dependency audits: zero advisories.
- Windows x64 unpacked build, NSIS installer, portable executable, blockmap, and update metadata generation.
- Packaged layout, ESM runtime, OAuth/MCP connector, task attribution, validation, completion, reconnect rejection, and removed-route acceptance.
- Electron fuse-policy verification.
- Strict 0.23.0 package-size baseline with one locale, zero source maps, zero source CSS, and zero packaged TypeScript files.
- CycloneDX SBOM generation.

### Publication and manual gates remaining

- Local artifacts are unsigned because protected Windows signing credentials are not available in this environment. Publication must run through the protected release workflow and produce valid Authenticode signatures.
- Installer install/uninstall, first-run desktop renderer, production-identity startup, real ngrok publication, logged-in ChatGPT app selection, and upgrade behavior remain manual checks on a disposable Windows machine.
- The release tag and GitHub publication have not been created.
- Electron packaging development dependencies currently report 16 high-severity transitive advisories. Shipped production dependencies report zero advisories; npm's proposed automatic fix is an unsafe downgrade of `electron-builder` from 26.15.7 to 22.14.13.

See [ESM_ARCHITECTURE.md](ESM_ARCHITECTURE.md), [COLOR_SYSTEM.md](COLOR_SYSTEM.md), [ELECTRON_PACKAGE_SIZE.md](ELECTRON_PACKAGE_SIZE.md), and [RELEASE.md](RELEASE.md).
