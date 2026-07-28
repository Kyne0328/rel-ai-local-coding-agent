# Release status

## 0.23.0 ESM hard cutover

Version `0.23.0` remains unreleased while the first-party ESM migration and production validation are completed. Repository tags and the configured `origin` did not contain a `0.23.0` release tag when the isolated release branch was created.

### Implemented

- Root, backend, CLI, MCP transports, OAuth, telemetry, task/process/worktree runtime, build/release scripts, Electron main process, renderers, and tests use ESM.
- `electron/preload.cjs` is the only retained CommonJS boundary and is restricted to Electron's sandbox preload API.
- Duplicate preload files and obsolete dashboard route aliases are removed.
- Generated color assets have a non-mutating freshness gate before tests, release checks, and packaging.
- BrowserWindow startup canvases use one neutral main-process-owned pre-render color.
- OAuth CSS is tested through the production HTTP route.

### Release gates

The release remains blocked until the exact release commit passes the complete test suite, circular and dependency analysis, unpacked and installer builds, packaged backend acceptance, rendered UI review, installed-app launch, and active connector workflow. The release tag must not be created before those gates pass.

See [ESM_ARCHITECTURE.md](ESM_ARCHITECTURE.md), [COLOR_SYSTEM.md](COLOR_SYSTEM.md), and [RELEASE.md](RELEASE.md).
