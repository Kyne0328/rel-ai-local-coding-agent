# Electron Package Size Policy

## Purpose

Rel.AI measures packaged size as a release regression signal. The authoritative numeric baselines live in `scripts/electron-size-baseline.json` and `scripts/electron-size-baseline-linux.json`; this document explains the policy rather than duplicating numbers that can become stale.

## Current package architecture

The desktop packages:

- Electron 43 and the production updater runtime;
- the Electron main/preload/renderer files in `resources/app.asar`;
- the complete Rel.AI backend/runtime trees required by the local MCP service;
- compiled dashboard assets rather than build-only source CSS;
- the MCP SDK, OpenTelemetry, Tree-sitter, and other explicitly required runtime dependencies;
- reviewed Zoekt binaries for repository search; and
- one platform-specific OpenAI `tunnel-client` binary plus its provenance manifest.

Windows builds include only the Windows tunnel client; Linux builds include only the Linux tunnel client.

## Largest controllable native component

The pinned OpenAI tunnel client is a deliberate runtime dependency. The current manifest records approximately 20 MB per supported platform. It is copied outside ASAR under:

```text
resources/bin/tunnel-client/<platform>/
```

The binary is not optional in the current product contract because the desktop must be able to start its only supported ChatGPT transport without asking the user to install a second executable.

A future on-demand delivery design would require integrity verification, rollback, offline behavior, update/version policy, and substantially more release complexity. YAGNI applies until there is measured product pressure that justifies that architecture.

## Existing size controls

The package retains the proven low-risk optimizations:

- Electron locales are limited to `en-US`;
- generated dashboard CSS is minified;
- source maps are excluded from production packaging;
- runtime dependency source/test/declaration trees are excluded when not needed at runtime;
- source CSS is not packaged when compiled output is the runtime artifact;
- unsupported platform tunnel binaries are excluded;
- tests, fixtures, repository metadata, and build-only sources are not copied into the application;
- packaging reuses one verified unpacked application where the release wrapper can do so safely.

Electron/Chromium remains the dominant installed payload. Removing ICU, graphics fallbacks, media libraries, accessibility resources, or browser runtime files without cross-hardware proof is not an acceptable size optimization.

## Verification

Windows:

```powershell
npm run electron:dist:windows
npm run electron:size:windows
```

Linux:

```bash
npm run electron:dist:linux
npm run electron:size:linux
```

The size gate verifies canonical release artifacts, required metrics, locale policy, generated CSS, and packaging leaks. A measured value above the committed tolerance fails the release. A smaller package does not require weakening the baseline simply to make the report look close to the old value.

Update a baseline only from a reviewed final candidate and explain every accepted increase in the release change.

## Package validation

Size is not correctness. The release also requires:

- source tests and dependency policy gates;
- `npm run verify:tunnel-client`;
- `npm run verify:packaged` against the authoritative unpacked directory;
- packaged bearer-authenticated MCP acceptance;
- Electron fuse verification; and
- updater/release-artifact verification where applicable.

`verify:packaged` checks the actual packaged tunnel-client size and SHA-256 against the reviewed manifest. It also rejects obsolete transport directories and unexpected runtime dependency trees.

## Deferred opportunities

Potential future reductions must be evidence-driven:

1. duplicate image consolidation after all installer/window/tray call sites are proven;
2. private source-map artifacts if production diagnostics require them;
3. backend bundling only if profiling shows a meaningful startup or distribution benefit; and
4. optional tunnel-client delivery only if the package-size benefit outweighs the new integrity, recovery, and offline failure modes.

The current priority is deterministic packaging, not the smallest possible executable at the cost of additional runtime states.
