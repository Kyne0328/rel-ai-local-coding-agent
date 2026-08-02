# Release process

Rel.AI MCP uses a strict release path so a tag cannot ship mismatched versions, protocol behavior, documentation, or packaged runtime files.

## 1. Validate source

```bash
npm run test:native-tasks-release-gate
npm run test:all
npm run knip:production
npm run audit:production
npm run audit:packaging
npm run benchmark:observability
```

`test:all` builds the dashboard CSS, performs JavaScript checks, runs ESLint with zero warnings, type-checks module boundaries, verifies release consistency, and executes every test file. CI and release packaging use Node.js 24.

When working through Rel.AI itself, use:

```text
relai_work action=status
relai_validate action=checks level=release
relai_changes action=diff
```

## 2. Verify the MCP contract

The release must retain one 12-tool compact surface for stdio and HTTP/OAuth clients, with the count and manifest hash derived from the registered schema rather than duplicated constants.

Required invariants:

- MCP protocol handling is provided by `@modelcontextprotocol/server` and `@modelcontextprotocol/node`.
- HTTP MCP is exposed only at `POST /mcp`.
- Legacy MCP `/sse` and `/messages` routes remain absent.
- HTTP and stdio advertise native Tasks support, but return a native task only when the current request advertises `io.modelcontextprotocol/tasks`.
- Clients without Tasks support receive bounded synchronous results for safe eligible operations; no request may run indefinitely or continue as hidden background work.
- Repository work sessions, native MCP Tasks, and managed processes retain separate identifiers and lifecycle semantics.
- `relai_work` with `action=begin` creates a new opaque `work_id`.
- Every later task-scoped call requires the exact ID.
- Transport, conversation, workspace, and timestamp inference remain absent.
- `relai_edit` is the only file-change tool.
- `relai_publish` with `action=draft_pr` prepares local text only and does not contact a hosting provider.

The native Tasks source release gate is `npm run test:native-tasks-release-gate`. It covers both transport capability matrices, lifecycle and persistence, authorization, synchronous limits, cancellation cleanup, process separation, public surface, dashboard states, and ChatGPT-compatible fallback. The complete packaged gate additionally requires `verify:packaged` and `test:connector-acceptance`. See `docs/NATIVE_TASKS_RELEASE_GATE.md`.

## 3. Build and verify the desktop package

```bash
npm run fetch:ngrok
npm run verify:ngrok
npm run electron:build
npm run verify:packaged
npm run test:connector-acceptance
```

The ngrok fetch is accepted only when it matches `vendor/ngrok/manifest.json`; Windows verification also requires the declared version and a valid upstream Authenticode identity. `verify:packaged` checks the unpacked application layout and packaged ngrok hash without launching the Electron executable. `test:connector-acceptance` launches only the packaged Node backend from `resources/` and verifies the actual packaged OAuth and MCP stack:

- OAuth discovery and dynamic client registration;
- authorization-code flow with PKCE S256;
- tool and resource discovery;
- explicit task start and several task-scoped calls;
- explicit completion;
- reconnect followed by rejection of a completed task ID;
- absence of legacy `/sse` and `/messages` routes.

This automated check does not control the logged-in ChatGPT web UI. Before publishing, use a disposable Windows environment to create or reconnect the real ChatGPT app, approve it through OAuth, select it in a chat, and run one read-only workspace task.

## 4. Review breaking changes

For 0.22.0 and later, release notes must state that the hard cutover:

- ignores removed configuration properties instead of migrating them;
- deletes old task-history session files on first current-version access;
- removes MCP `/sse` and `/messages`;
- requires standards-compliant MCP initialization fields;
- requires explicit `work_id` on task-scoped calls;
- packages MCP SDK runtime dependencies.

See `docs/RELEASE_NOTES_0.22.0.md` for the 0.22.0 notice.

## 5. Version and changelog

Use the release helper so all version surfaces move together:

```bash
npm run release:bump -- 0.22.0 --date 2026-07-27 --no-changelog
```

Then add the dated changelog section and run:

```bash
npm run release:check
```

The synchronized surfaces are:

- root `package.json` and `package-lock.json`;
- Electron `package.json` and `package-lock.json`;
- Electron status version badge;
- `CHANGELOG.md`.

## 6. Package-size baseline

A release package-size report requires final installer and portable artifacts:

```bash
npm run electron:dist
npm run electron:size
```

The size gate is blocking. It requires the exact canonical installer and portable filenames, rejects packaged source CSS, source maps, unsupported locales, missing metrics, and any measured value more than the documented 3% tolerance above the accepted baseline. Update `scripts/electron-size-baseline.json` only from a reviewed final release candidate with an explicit explanation for every increase.

## 7. Manual release checks

Use a disposable Windows VM or dedicated release machine for operations that affect installed applications:

- NSIS install and uninstall;
- first-run rendering and real ngrok publication;
- real ChatGPT UI connection and app selection;
- approval-token replacement and existing-app reapproval;
- update from the previous published release.

Do not run installer lifecycle tests on a developer machine that is hosting active Rel.AI work.

## 8. Publish

Pushing the version commit to `main` triggers `.github/workflows/release.yml`. The workflow builds the installer and portable executable and publishes:

- `Rel.AI-MCP-Setup-<version>.exe`;
- `Rel.AI-MCP-Portable-<version>.exe`;
- `Rel.AI-MCP-Setup-<version>.exe.blockmap`;
- `latest.yml`;
- the CycloneDX SBOM;
- the strict package-size report;
- `SHA256SUMS.txt`.

The workflow requires exact release-asset basenames, matching release versions, nonempty and byte-correct SHA-512 updater metadata, and SHA-256 coverage. Rel.AI-owned Windows artifacts are currently published unsigned with certificate auto-discovery disabled. SHA-256 binds every published asset to `SHA256SUMS.txt`; the packaged ngrok bytes must also match the reviewed manifest and retain ngrok's valid upstream Authenticode signature.

Scan the installer, portable executable, unpacked Rel.AI executable, and bundled ngrok executable as separate samples before broad distribution. A Trojan or malware classification on a Rel.AI-owned executable blocks publication until investigated. Generic PUA/PUP labels limited to the authentic ngrok component require documented vendor submission and review; do not evade them through renaming, repacking, or post-install downloads. See `docs/ANTIVIRUS_FALSE_POSITIVES.md`.

A local release-preparation commit must not be pushed until all automated and manual checks required for the candidate are complete.
