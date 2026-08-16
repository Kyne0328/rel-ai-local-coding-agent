# Release process

Rel.AI MCP uses a strict release path so a tag cannot ship mismatched versions, protocol behavior, tunnel-client bytes, documentation, or runtime files.

## 1. Validate source

```bash
npm run test:native-tasks-release-gate
npm run test:all
npm run knip:production
npm run audit:production
npm run audit:packaging
npm run benchmark:observability
```

`test:all` builds generated UI assets, performs syntax/lint/type/dependency checks, verifies release consistency, and executes the curated release-critical regression suite. CI and packaging use Node.js 24.

When working through Rel.AI itself, use the task-aware validation and diff tools so the evidence remains associated with the current work session.

## 2. Verify the MCP contract

The release retains one canonical public tool surface for stdio and private HTTP clients. Its exact size and action contracts come from the current tool registry rather than release documentation.

Required invariants:

- modern protocol behavior targets `2026-07-28`;
- HTTP MCP is exposed only at `POST /mcp`;
- local HTTP MCP requires the private bearer token except in explicit local-only test mode;
- removed `/register`, `/authorize`, `/token`, `/sse`, and `/messages` routes remain absent;
- HTTP may retain the tested stateless `2025-11-25` ChatGPT initialization compatibility flow;
- native Tasks are returned only when the current request advertises the capability;
- repository work sessions, native MCP Tasks, and managed processes retain separate identifiers;
- task-scoped calls require the exact `work_id` created by `relai_work action=begin`;
- transport or conversation identity never substitutes for work-session ownership;
- `relai_edit` is the repository file-change surface; and
- publishing actions remain explicit.

The native Tasks source gate is `npm run test:native-tasks-release-gate`.

## 3. Verify the tunnel component

```bash
npm run fetch:tunnel-client
npm run verify:tunnel-client
```

`vendor/tunnel-client/manifest.json` pins the reviewed OpenAI tunnel-client version, source, license, per-platform URL, file size, and SHA-256. Fetch and verification fail closed when the downloaded or extracted bytes differ from the manifest.

The application packages only the target platform's binary under `resources/bin/tunnel-client/`. Packaged verification hashes those bytes again.

## 4. Build and verify the desktop package

Windows:

```bash
npm run electron:build:windows
npm run verify:packaged -- --platform win32
npm run test:connector-acceptance
npm run verify:fuses -- --platform win32
```

Linux is built and verified in its native release job with the corresponding Linux platform arguments.

`test:connector-acceptance` launches only the isolated packaged Node backend. It verifies bearer-authenticated MCP discovery, tool/resource contracts, a guarded repository mutation, validation, dashboard history, reconnect persistence, ChatGPT-compatible stateless initialization, and the absence of removed routes. It does not need a production tunnel credential and does not pretend to prove external ChatGPT account state.

## 5. Review breaking changes

Release notes for the Secure MCP Tunnel hard cutover must clearly state that the previous connection transports and local OAuth authorization flow were removed. Historical release-specific behavior belongs in `CHANGELOG.md`; do not preserve obsolete runtime paths only to avoid documenting a breaking change.

## 6. Version and changelog

Use the release helper so version surfaces move together:

```bash
npm run release:bump -- <next-version> --date <YYYY-MM-DD> --no-changelog
```

Then add the dated changelog section and run:

```bash
npm run release:check
```

The synchronized surfaces include the root and Electron package manifests/lockfiles, Electron status version, release metadata, plugin metadata where applicable, and changelog.

## 7. Package-size and artifact gates

Build final artifacts and enforce the committed size policy:

```bash
npm run electron:dist:windows
npm run electron:size:windows
npm run verify:updater-artifacts
npm run generate:sbom
```

Release publication requires canonical filenames, matching versions, updater SHA-512 integrity, SHA-256 coverage, SBOM generation, and GitHub attestations.

## 8. Manual release checks

Use a disposable Windows VM or dedicated release machine for operations that affect installed applications or require external credentials:

- NSIS install and uninstall;
- first-run Secure MCP Tunnel configuration;
- real Tunnel ID/runtime API key connection and reconnect after restart;
- real ChatGPT Tunnel integration and one read-only workspace request;
- tool-schema refresh/review after a deliberate schema change;
- update from the previous published release; and
- light/dark, narrow-layout, and accessibility review.

Do not run installer lifecycle tests on the developer machine hosting the active Rel.AI connector.

## 9. Publish

Pushing the version commit to `main` triggers `.github/workflows/release.yml`. The workflow builds platform release artifacts, verifies them, prepares checksums and SBOM evidence, and publishes only after the blocking jobs pass.

Rel.AI-owned Windows artifacts currently disable certificate auto-discovery and are covered by SHA-256 plus GitHub attestations. The packaged OpenAI tunnel-client bytes must match the reviewed provenance manifest.

Scan the installer, portable executable, unpacked Rel.AI executable, and extracted tunnel client as separate samples before broad distribution. A malware/Trojan classification blocks publication pending investigation. See `docs/ANTIVIRUS_FALSE_POSITIVES.md` for component-level handling.

A release-preparation commit must not be pushed until the automated gates and the manual/external checks required for that candidate are complete.
