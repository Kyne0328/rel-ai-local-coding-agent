# Release process

Rel.AI MCP keeps a strict release path so a tagged build never ships an inconsistent tool surface, docs, or version.

## 1. Validate the working tree

Run the strict gate locally before bumping anything:

```bash
npm run check                  # syntax / static checks
npm run test:public-workflow   # public connector tool surface + write workflow
npm run test:checks            # validation-command behavior
npm run test:staged-write      # large-file staged-write fallback
npm run test:all               # full suite (also what CI runs)
```

CI runs `npm run test:all` on Node 22 and 24 (the package requires Node `>=22.13`). A release should be green on both.

CI also builds an unpacked Windows app and runs `npm run verify:packaged`. This read-only gate verifies the executable, ASAR, server, tool registry, configuration, CLI, dashboard, changelog, package metadata, and bundled ngrok binary without launching, installing, or uninstalling Rel.AI.

## 2. Inspect, validate, review (via the MCP tools)

```text
relai_git_status
relai_run_checks level=release
relai_diff
```

`level=release` runs the full release gate (the broadest detected test/build set). See [`docs/WORKFLOW_RELIABILITY.md`](docs/WORKFLOW_RELIABILITY.md) for the `quick` / `standard` / `release` presets.

## 3. Update version and changelog together

Bump every version surface in lockstep — root, lockfiles, the Electron launcher, and the status UI:

- `package.json` + `package-lock.json`
- `electron/package.json` + `electron/package-lock.json`
- `electron/renderer/status.html` (the `vX.Y.Z` badge)
- `CHANGELOG.md` (new dated section describing the change)

The helper scripts automate and verify this:

```bash
npm run release:bump       # bump versions across all surfaces
npm run release:check      # assert versions + changelog are consistent
npm run release:finalize   # finalize the release
```

`npm run release:check` (also part of `test:release`) fails if any surface drifts.

## 4. Connector surface invariants

Before tagging, confirm the public connector surface is still consistent:

- The public ChatGPT connector exposes **18 tools** (`PUBLIC_HTTP_TOOL_NAMES` in [`src/tools.js`](src/tools.js)).
- Docs that quote the count (`README.md`, `docs/CONNECTING_TO_CHATGPT.md`) match it.
- `relai_edit` is the documented primary write path; `relai_write` / `relai_replace` are fallbacks.
- Public cleanup guidance uses `relai_tidy_plan` / `relai_tidy_run` (+ `relai_restore_changes`), never `relai_clear_files`.

`npm run test:public-workflow` and `npm run test:connector-wording` enforce most of these.

## 5. Packaging

Pushing a version bump to `main` triggers `.github/workflows/release.yml`, which fetches the ngrok seed binary, builds the Windows installer and portable executable, and publishes a GitHub release with the matching `CHANGELOG.md` section.

The release must contain all updater and verification assets:

- the installed NSIS `.exe`
- the portable `.exe`
- `latest.yml`
- the installed-app `.blockmap`
- `SHA256SUMS.txt`

The installed app uses `latest.yml` and the blockmap for update discovery and differential download support. The workflow requires a nonempty SHA-512 value in `latest.yml`; the app refuses same-version, downgrade, prerelease, malformed, or downloaded-version-mismatch updates and enables installation only after electron-updater reports verified release metadata. The portable executable is manual-update only.

Before release assets are prepared, the workflow verifies the unpacked package layout without executing it. Installation, uninstall, first-run rendering, real ngrok publication, ChatGPT OAuth, live approval-token rotation, and update from a previous published release must be checked manually on a disposable Windows machine. See [`docs/USABILITY_ACCEPTANCE.md`](docs/USABILITY_ACCEPTANCE.md).

The workflow also generates `SHA256SUMS.txt` from the published executables, updater metadata, and usability evidence. To verify a downloaded executable in PowerShell:

```powershell
Get-FileHash .\Rel.AI*.exe -Algorithm SHA256
```

Compare the result with the matching line in `SHA256SUMS.txt`. A matching checksum confirms that the downloaded bytes match the release manifest, but it does not prove publisher identity.

Windows artifacts are currently unsigned. Until a Windows code-signing certificate and protected signing workflow are configured, Windows may show an unidentified-publisher warning. The release workflow fails before publishing if either executable, updater metadata class, SHA-512 metadata, or checksum manifest is missing.

No lifecycle migration is required during release packaging. On first launch of a new version, the installed app compares the packaged version with its non-secret `desktop-lifecycle.json` record and reports the transition after startup succeeds.

To package locally, fetch the seed first — the binaries are gitignored, so a clean checkout has none:

```bash
npm run fetch:ngrok        # Windows (pwsh); use scripts/fetch-ngrok.sh elsewhere
npm run electron:dist      # installers into dist/
```

`electron:build` and `electron:dist` run `npm run verify:ngrok` first and refuse to package without a valid seed. An installer built without it starts normally and only fails when the user tries to open a tunnel, so this gate exists to keep that failure out of a release.
