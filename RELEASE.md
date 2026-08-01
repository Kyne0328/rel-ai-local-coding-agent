# Release process

Rel.AI MCP uses a strict release path so a tag cannot ship mismatched versions, protocol behavior, documentation, or packaged runtime files.

## 1. Validate source

```bash
npm run test:all
npm run knip:production
npm run audit:production
npm run audit:packaging
npm run benchmark:observability
```

`test:all` builds the dashboard CSS, performs JavaScript checks, runs ESLint with zero warnings, type-checks module boundaries, verifies release consistency, and executes every test file. CI and release packaging use Node.js 24.

When working through Rel.AI itself, use:

```text
relai_status
relai_run_checks level=release
relai_diff
```

## 2. Verify the MCP contract

The release must retain one 35-tool surface for stdio and HTTP/OAuth clients, with the count and manifest hash derived from the registered schema rather than duplicated constants.

Required invariants:

- MCP protocol handling is provided by `@modelcontextprotocol/server` and `@modelcontextprotocol/node`.
- HTTP MCP is exposed only at `POST /mcp`.
- Legacy MCP `/sse` and `/messages` routes remain absent.
- `relai_start_task` creates a new opaque `task_id`.
- Every later task-scoped call requires the exact ID.
- Transport, conversation, workspace, and timestamp inference remain absent.
- `relai_edit` is the only file-change tool.
- `relai_git_draft_pr` prepares local text only and does not contact a hosting provider.

The main protocol tests are `smoke.mjs`, `http-smoke.mjs`, `oauth-smoke.mjs`, `multi-chat-mcp-integration.mjs`, and `mcp-task-scope-unit.mjs`.

## 3. Build and verify the desktop package

```bash
npm run fetch:ngrok
npm run verify:ngrok
npm run electron:build
npm run verify:packaged
npm run test:connector-acceptance
```

The package contains only `vendor/ngrok/manifest.json`; it must not contain `ngrok.exe`. `npm run verify:ngrok -- --download` exercises the exact official archive acquisition in a temporary directory and requires the declared archive and executable sizes, SHA-256 values, version, and upstream Authenticode identity. `verify:packaged` checks the manifest-only application boundary without launching Electron. `test:connector-acceptance` launches only the packaged Node backend from `resources/` and verifies the actual packaged OAuth and MCP stack:

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
- requires explicit `task_id` on task-scoped calls;
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

The workflow requires exact release-asset basenames, matching release versions, nonempty and byte-correct SHA-512 updater metadata, SHA-256 coverage, protected Windows signing credentials, and `forceCodeSigning`. It verifies valid Authenticode signatures for the installer, portable executable, and unpacked Rel.AI executable. It separately proves that the package contains no ngrok executable and that the reviewed official ngrok archive can be downloaded, hashed, extracted, signature-checked, and version-checked. SHA-256 binds every published Rel.AI asset to `SHA256SUMS.txt`; the acquisition manifest binds the external ngrok component.

Scan the installer, portable executable, and unpacked Rel.AI executable as Rel.AI-owned samples before broad distribution. Separately scan the exact ngrok executable acquired through the reviewed manifest. A Trojan or malware classification on a Rel.AI-owned executable blocks publication until investigated. Generic PUA/PUP labels limited to the authentic upstream ngrok component require documented vendor submission and review; do not evade them through renaming, repacking, proxying, or exclusions. See `docs/ANTIVIRUS_FALSE_POSITIVES.md`.

A local release-preparation commit must not be pushed until all automated and manual checks required for the candidate are complete.
