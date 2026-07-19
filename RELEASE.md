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

CI also builds and installs the packaged Windows app (`npm run test:installed`), which asserts that every bundled resource is present — including the ngrok seed binary.

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

Pushing a version bump to `main` triggers `.github/workflows/release.yml`, which fetches the ngrok seed binary, builds the Windows installers, and publishes a GitHub release with the matching `CHANGELOG.md` section.

To package locally, fetch the seed first — the binaries are gitignored, so a clean checkout has none:

```bash
npm run fetch:ngrok        # Windows (pwsh); use scripts/fetch-ngrok.sh elsewhere
npm run electron:dist      # installers into dist/
```

`electron:build` and `electron:dist` run `npm run verify:ngrok` first and refuse to package without a valid seed. An installer built without it starts normally and only fails when the user tries to open a tunnel, so this gate exists to keep that failure out of a release.
