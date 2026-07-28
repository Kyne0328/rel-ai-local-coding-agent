# Rel.AI MCP Dependency Audit and Upgrade Report

> Historical audit for the 0.21.0 implementation state. Current runtime, dependency, packaging-security, and package-management policy is defined by `package.json`, `electron/package.json`, `docs/PACKAGING_SECURITY.md`, and `docs/PACKAGE_MANAGEMENT.md`.

**Audit date:** 2026-07-26
**Repository:** `rel-ai-mcp`
**Application version:** `0.21.0`
**Primary platform:** Windows desktop application with a Node.js development and test toolchain
**Decision:** **Complete with documented exceptions**

## 1. Executive summary

The repository dependency surface was inspected from the root Node.js project and the nested Electron application. Direct dependencies were traced to their actual repository owners, current versions were checked through npm, lockfiles were regenerated through normal package-manager operations, production and development audit results were separated, and the upgraded desktop application was built and exercised as a packaged Electron application.

The implemented upgrade is:

| Area | Before | After | Result |
| --- | --- | --- | --- |
| ESLint | `10.6.0` | `10.8.0` | Upgraded; root audit reduced from one high finding to zero |
| Electron | `31.7.7` installed from `^31.0.0` | `43.2.0` installed from `^43.2.0` | Major runtime upgrade completed |
| electron-builder | `24.13.3` | `26.15.3` | Major packaging upgrade completed and pinned exactly |
| electron-updater | `6.8.9` | `6.8.9` | Already current; retained |
| Other root direct dependencies | Current | Current | Retained |

Both root and Electron projects return no entries from `npm outdated --json` as of the audit date.

The root dependency graph now has zero npm audit findings. The Electron production graph also has zero npm audit findings. The full Electron development graph still reports 16 high-severity findings in transitive packaging dependencies. These findings are not reachable from the shipped application runtime because they are under the `electron-builder` development/tooling graph, but they remain a build-host and release-pipeline concern and must be tracked.

The Electron 43 package builds successfully, generates Windows installer and portable artifacts, starts with the expected embedded runtime, exposes the packaged HTTP service, contains all required resources, and passed packaged renderer interaction checks at the dependency-validation checkpoint. That checkpoint passed **101/101 test files** on the then-current 24-tool surface. Subsequent concurrent work briefly expanded the surface, then final reconciliation removed six compatibility tools in tool-surface version 10 and replaced the host-destructive installed-app harness with a read-only packaged-layout gate. The current aggregate worktree passes **106/106 test files** on the final 20-tool active-only surface, rebuilds successfully on Electron 43.2.0, and passes `verify:packaged` with all 10 required files present.

The primary tradeoff is distribution size. The application payload remained nearly flat, but the newer Electron/Chromium runtime increased the Windows installer by approximately 19.04 MiB and the unpacked application by approximately 81.18 MiB. This is an expected runtime-platform increase rather than application dependency bloat.

## 2. Scope and evidence rules

The audit covered:

- `package.json` and `package-lock.json` at the repository root.
- `electron/package.json` and `electron/package-lock.json`.
- Direct production, development, optional, peer, and bundled dependency classifications.
- Repository usage of every direct dependency.
- npm outdated and audit output.
- Lockfile structure, duplicate package names, and installation footprint.
- Electron runtime compatibility, packaging, distribution, and packaged execution.
- Existing Electron security boundaries and API usage relevant to the major runtime upgrade.
- Build and test commands declared by the repository.

The audit did not treat package age, file names, or npm output alone as proof that a dependency was removable. A direct dependency was retained only when repository configuration or source usage established an owner.

No unsupported operating system claim is made. Rel.AI MCP is packaged and validated here as a Windows application. The repository's configured CI references other Node.js environments, but CI itself was not executed during this local audit.

## 3. Baseline

### 3.1 Runtime and toolchain baseline

Before the upgrade:

- Root Node engine requirement: `>=22.13.0`.
- Installed Electron: `31.7.7`.
- Electron 31 embedded Node runtime: `20.18.0`.
- Electron 31 embedded Chromium: `126.0.6478.234`.
- Electron 31 V8: `12.6`.
- Electron module ABI: `125`.
- Installed electron-builder: `24.13.3`.
- Installed electron-updater: `6.8.9`.

The pre-upgrade standard validation passed with 100/100 test files. The root npm audit reported one high-severity `brace-expansion` finding through the ESLint/minimatch development graph.

Electron 31 was outside Electron's current three-major-line support window at the audit date. Continuing to package a network-facing desktop application on that runtime carried avoidable Chromium, Node.js, and Electron maintenance risk.

### 3.2 Dependency graph baseline

| Metric | Root before | Electron before |
| --- | ---: | ---: |
| Lockfile version | 3 | 3 |
| Installed lockfile entries | 156 | 332 |
| Unique package names | 154 | 262 |
| Package names present at multiple versions | 2 | 22 |
| `node_modules` bytes | 59,651,459 | 462,140,099 |

Root duplicate names were `detect-libc` and `eslint-visitor-keys`. Electron duplication was concentrated in the packaging graph.

### 3.3 Distribution baseline

| Artifact or component | Before |
| --- | ---: |
| NSIS installer | 80,604,737 bytes |
| Portable executable | 80,342,087 bytes |
| Unpacked application | 266,665,259 bytes |
| Resources | 35,896,695 bytes |
| `app.asar` | 1,692,241 bytes |
| Packaged Node dependency payload | 1,091,187 bytes |
| Locales | 464,976 bytes |
| Bundled ngrok | 32,774,984 bytes |
| Generated CSS | 111,236 bytes |

## 4. Direct dependency ownership and classification

### 4.1 Root project

The root manifest has no direct production dependencies. All direct packages are development-only and are correctly classified under `devDependencies`.

| Dependency | Installed version | Repository owner and use | Classification decision | Disposition |
| --- | --- | --- | --- | --- |
| `@eslint/js` | `10.0.1` | Imported by `eslint.config.mjs` for ESLint's JavaScript rules | Development-only | Retain |
| `@tailwindcss/cli` | `4.3.3` | Invoked by `build:css` and `watch:css` | Development/build-only | Retain |
| `eslint` | `10.8.0` | Invoked by the `lint` command and included in `test:all` | Development/test-only | Upgrade and retain |
| `globals` | `17.7.0` | Imported by `eslint.config.mjs` | Development-only | Retain |
| `tailwindcss` | `4.3.3` | Provides the CSS engine used by the Tailwind CLI and source stylesheet | Development/build-only | Retain |
| `typescript` | `7.0.2` | Invoked by `typecheck` against `tsconfig.boundaries.json` | Development/test-only | Retain |

No root direct dependency was proven unused. None should be moved into production dependencies.

### 4.2 Electron project

| Dependency | Installed version | Repository owner and use | Classification decision | Disposition |
| --- | --- | --- | --- | --- |
| `electron-updater` | `6.8.9` | Imported by `electron/main.js` and used by updater modules at application runtime | Production runtime | Retain in `dependencies` |
| `electron` | `43.2.0` | Development launch, runtime bundling, Electron API surface, and packaged execution | Development/build dependency because the runtime is bundled into artifacts | Upgrade and retain in `devDependencies` |
| `electron-builder` | `26.15.3` | Windows directory build and NSIS/portable distribution generation | Development/release dependency | Upgrade, pin exactly, and retain |

No direct optional, peer, or bundled dependency declarations exist in either manifest. No direct native Node module dependency was found. Electron's native dependency rebuild phase still runs during packaging and completed successfully.

## 5. Upgrade decisions

### 5.1 ESLint 10.8.0

`eslint` was upgraded from `^10.6.0` to `^10.8.0`. The repository was already on ESLint 10 and Node 22+, so this was a minor update within the existing major-version contract. No ESLint configuration migration was required.

A normal `npm audit fix`, without `--force`, refreshed allowed transitive versions and removed the root `brace-expansion` vulnerability. The root lockfile remains version 3 and is reproducible through `npm ci`.

### 5.2 Electron 43.2.0

Electron was upgraded from major version 31 to 43. The upgrade was justified because Electron only supports its latest three stable major lines and Electron 31 was materially outside that window.

The resulting embedded runtime was executed directly and reported:

- Node.js `24.18.0`.
- Electron `43.2.0`.
- Chromium `150.0.7871.129`.
- V8 `15.0` series.

Repository searches did not identify removed Electron APIs that required application-source migration. The existing security posture remained intact:

- Context isolation remains enabled.
- Renderer Node integration remains disabled.
- Sandboxing remains enabled for relevant windows.
- Navigation, popup, download, and external-link behavior remains guarded.
- Privileged clipboard and desktop operations remain mediated through preload/main-process IPC.
- Packaged HTTP authentication remains bearer-token based.

The package was rebuilt and executed rather than assuming source compatibility from search results.

### 5.3 electron-builder 26.15.3

The packaging tool was upgraded from 24.13.3 to 26.15.3. The manifest uses the exact version `26.15.3`, not a caret range. During the audit, an anomalous higher version could be resolved through a range even though the npm `latest` distribution tag identified 26.15.3. Exact pinning keeps release infrastructure deterministic and prevents an unreviewed packaging-tool change.

The upgraded builder completed:

- `@electron/rebuild` for Electron 43.2.0 x64.
- Windows unpacked packaging.
- ASAR integrity update.
- NSIS installer generation.
- Portable executable generation.
- Update metadata and blockmap generation.
- Verification and packaging of the bundled ngrok executable.

### 5.4 electron-updater 6.8.9

`electron-updater` was already current and remains unchanged. Its production classification is correct because it is imported and used by the installed desktop application.

## 6. Manifest and packaging changes

Dependency-specific manifest and packaging changes include:

- Root `eslint` range updated to `^10.8.0`.
- Electron updated to `^43.2.0`.
- electron-builder updated and exactly pinned to `26.15.3`.
- Electron packaging restricted to the `en-US` locale.
- Source maps excluded from the Electron application file set.
- Build and distribution scripts explicitly use `--publish never`, preventing local validation from attempting release publication.
- Package-size measurement is available through `npm run electron:size`.
- Root validation includes the declared ESLint command.

The locale and source-map exclusions reduce avoidable distribution content but do not offset the larger Electron 43 runtime.

## 7. Lockfile and installation results

### 7.1 Reproducibility

Both projects successfully completed `npm ci` after the lockfile updates.

Current `npm outdated --json` output is empty for both projects.

### 7.2 Graph metrics after upgrade

| Metric | Root after | Electron after | Electron change |
| --- | ---: | ---: | ---: |
| Lockfile version | 3 | 3 | No change |
| Installed lockfile entries | 156 | 289 | -43 |
| Unique package names | 154 | 244 | -18 |
| Duplicate package names | 2 | 18 | -4 |
| `node_modules` bytes | 59,651,459 | 451,090,791 | -11,049,308 (-2.39%) |

The Electron development installation became smaller despite the major runtime and builder upgrades. This improvement is in the local dependency/tooling graph and should not be confused with the larger packaged Electron runtime.

Current Electron duplicate package names are:

- `fs-extra` at nine graph locations.
- `balanced-match`, `brace-expansion`, and `minimatch` at six locations each.
- `semver` at five locations.
- `env-paths`, `isexe`, `jsonfile`, `universalify`, and `which` at three locations each.
- `@electron/get`, `@noble/hashes`, `ci-info`, `commander`, `isbinaryfile`, `mimic-response`, `undici`, and `yallist` at two locations each.

These duplicates are transitive. Direct overrides were not added because forcing convergence across packaging tools without upstream range support would create an unsupported dependency combination.

## 8. Security findings and reachability

### 8.1 Root graph

| State | Result |
| --- | --- |
| Before | One high-severity `brace-expansion` finding in the ESLint/minimatch development graph |
| After | Zero vulnerabilities |

The affected package is not part of the installed desktop runtime, but resolving it still reduces development-machine and CI exposure to malicious or untrusted glob patterns.

### 8.2 Electron production graph

`npm audit --omit=dev --json` reports:

- 0 critical.
- 0 high.
- 0 moderate.
- 0 low.
- 0 total.

This is the relevant result for dependencies shipped as runtime Node packages in the Electron application.

### 8.3 Electron full development graph

The full Electron graph reports 16 high-severity package findings under the packaging toolchain:

- `@electron/asar`
- `@electron/universal`
- `app-builder-lib`
- `brace-expansion`
- `dir-compare`
- `dmg-builder`
- `ejs`
- `electron-builder`
- `electron-builder-squirrel-windows`
- `electron-winstaller`
- `filelist`
- `glob`
- `jake`
- `minimatch`
- `rimraf`
- `temp`

Reachability assessment:

- These packages are not direct runtime dependencies of the installed Rel.AI MCP application.
- They execute on developer or CI release hosts while discovering files, preparing ASAR archives, generating installers, or performing platform-specific packaging.
- The shipped application production audit remains clean.
- The findings therefore do not justify blocking normal application runtime use, but they do affect the trust boundary of release inputs and build machines.

A forced npm audit fix was rejected. npm's proposed forced remediation would move the project to an obsolete electron-builder line rather than produce a supported, current packaging graph. That would trade known transitive tooling findings for an older and less maintainable release stack.

Required controls until upstream packages resolve the graph:

1. Build releases only from trusted repository contents and reviewed dependency lockfiles.
2. Do not package untrusted pull-request content with release credentials available.
3. Keep release signing credentials isolated from ordinary test jobs.
4. Continue checking `npm audit --omit=dev` separately from the full development audit.
5. Reassess electron-builder and its transitive graph on each stable release.

## 9. Packaged size and performance impact

### 9.1 Distribution comparison

| Artifact or component | Before | After | Delta |
| --- | ---: | ---: | ---: |
| NSIS installer | 80,604,737 | 100,568,173 | +19,963,436 bytes (+24.77%) |
| Portable executable | 80,342,087 | 100,251,375 | +19,909,288 bytes (+24.78%) |
| Unpacked application | 266,665,259 | 351,785,706 | +85,120,447 bytes (+31.92%) |
| Resources | 35,896,695 | 35,901,649 | +4,954 bytes (+0.01%) |
| `app.asar` | 1,692,241 | 1,680,413 | -11,828 bytes (-0.70%) |
| Packaged Node dependency payload | 1,091,187 | 1,107,187 | +16,000 bytes (+1.47%) |
| Locales | 464,976 | 566,095 | +101,119 bytes (+21.75%) |
| Bundled ngrok | 32,774,984 | 32,774,984 | No change |
| Generated CSS | 111,236 | 111,236 | No change |

The application-owned payload is effectively stable: resources changed by approximately 5 KiB, `app.asar` became smaller, and packaged Node dependencies increased by only approximately 16 KiB. The material increase is in the Electron/Chromium runtime.

This size regression should be accepted only as the cost of moving from an unsupported Electron generation to a current supported generation. It should not be hidden by replacing the historical package-size baseline without review. The previous optimized baseline remains useful for identifying how much of the increase is attributable to the runtime upgrade.

### 9.2 Observed local durations

Representative final local results:

- Electron unpacked build: approximately 10 seconds on the audit machine after dependencies and runtime archives were available locally.
- Windows distribution generation: approximately 32.5 seconds in the measured run.
- Complete standard repository validation: approximately 64 seconds.
- Packaged backend and renderer smoke sequence: approximately 6.7 seconds against the rebuilt unpacked application.

These are local observations, not service-level guarantees.

## 10. Compatibility and packaged validation

### 10.1 Electron runtime execution

The Electron executable was run with `ELECTRON_RUN_AS_NODE` to verify the actual embedded runtime versions. It started successfully under Electron 43.2.0 and Node 24.18.0.

### 10.2 Electron source and packaging checks

The following passed:

- `npm run test:electron`.
- `npm run electron:build`.
- `npm run electron:dist`.
- `npm run electron:size -- --json dist/dependency-upgrade-size-report.json`.
- Bundled ngrok verification.
- Native dependency rebuild phase.
- ASAR integrity update.
- NSIS and portable artifact generation.
- Update metadata generation.

### 10.3 Dependency-checkpoint packaged backend smoke

Before the installed-app harness was removed for host-safety reasons, the rebuilt dependency-checkpoint package passed all backend checks:

- `app.isPackaged === true`.
- Every required packaged resource was present.
- The local HTTP service started successfully.
- `/health` returned an OK result.
- The dashboard returned HTTP 200.
- The packaged public tool count matched the registry at 24 tools in the dependency-validation checkpoint. A separate concurrent feature later increased the source registry count and was not part of this package build.
- Streamable HTTP and SSE transports were reported.
- Bearer authentication remained active.

### 10.4 Dependency-checkpoint packaged renderer smoke

Before the harness removal, the rebuilt dependency-checkpoint package passed six renderer scenarios:

1. First-run setup renderer loads with styles, valid dimensions, non-empty visual content, and hidden inactive setup steps.
2. Recovery renderer loads with styles, valid dimensions, and the current flex-based status badge layout.
3. Desktop dashboard overview becomes interactive and renders the expected secured layout.
4. The current workspace menu applies `smoke` scope and persists it in `#tasks?workspace=smoke`.
5. The canonical `#settings/advanced` route loads the current Advanced settings content; removed aliases fall back to Overview.
6. A session tool event opens the exact Activity detail route and drawer.

Four screenshots were captured and checked for dimensions, sampled visual color content, and SHA-256 identity.

The packaged smoke contract itself required maintenance because concurrent UI changes had already removed the obsolete global workspace selector and manual refresh button. The smoke was updated to test the current workspace menu and live-dashboard behavior instead of weakening coverage.

### 10.5 Current aggregate repository validation

The final aggregate standard check completed successfully after all concurrent changes present in the worktree were reconciled:

- CSS build passed.
- JavaScript syntax check passed across 269 JavaScript files.
- ESLint passed with zero warnings.
- TypeScript boundary checking passed.
- Release consistency check passed for `0.21.0`.
- **106/106 test files passed.**

The validation covered repository, HTTP, authentication, OAuth, Electron launcher, IPC security, installer-test safety, window security, release workflow, UI contracts, the 20-tool active-only registry, code intelligence, patch/edit safety, workspace operations, and task-history behavior.

### 10.6 Current non-destructive package verification

The current aggregate worktree then completed:

- `npm run electron:build` with Electron `43.2.0` and electron-builder `26.15.3`.
- Native dependency rebuild and ASAR integrity update.
- Creation of `dist/build-check/win-unpacked`.
- `npm run verify:packaged`.
- Verification of all 10 required packaged files, including the executable, ASAR, server, tool registry, configuration, CLI, dashboard, package metadata, changelog, and bundled Windows ngrok binary.

The verifier reads package contents only. It does not launch, install, upgrade, or uninstall Rel.AI MCP.

## 11. Deferred and rejected changes

### 11.1 Deferred: Electron build-tool audit findings

**Reason:** No safe supported direct upgrade is currently available in the selected latest stable electron-builder line, and force-fixing proposes an obsolete builder change.
**Risk:** Build-time processing of malicious repository paths, patterns, templates, or archives could expose release hosts to the affected transitive behavior.
**Mitigation:** Trusted release inputs, isolated signing credentials, locked dependencies, and repeated audit review.
**Revisit trigger:** A stable electron-builder release removes or updates the affected transitive packages.

### 11.2 Resolved: remove installer lifecycle automation from the active product workflow

The former `test:installed` flow launched an NSIS package with the production application identity and could close, replace, or uninstall the Rel.AI MCP instance hosting the active repository connector. The harness, hidden packaged smoke modes, release-evidence pipeline, and ordinary CI/release entry points were removed.

Automated dependency validation now stops at a successful Windows package build and read-only packaged-layout verification. Real installer, uninstall, and update lifecycle checks remain manual on a disposable Windows VM or dedicated machine that is not hosting the test controller.

### 11.3 Rejected: `npm audit fix --force`

Rejected because it would permit unsupported major changes or an obsolete packaging-tool downgrade without proving application compatibility.

### 11.4 Rejected: direct transitive overrides

Rejected because the vulnerable packages are spread across multiple independent packaging-tool ranges. An override could produce a graph that installs but is not supported by electron-builder's tested dependency contracts.

### 11.5 Rejected: removing direct dependencies

No direct dependency was shown to be unused. Removing any current direct package would remove an active lint, typecheck, CSS build, Electron runtime, packaging, or updater capability.

## 12. Issue-ready follow-ups

### DEP-1: Clear electron-builder transitive audit findings

**Goal:** Reach a zero-finding full Electron development audit without downgrading the packaging stack.
**Acceptance criteria:**

- Upgrade to a stable electron-builder release whose supported graph removes the listed findings.
- `npm audit --omit=dev` remains zero.
- Full `npm audit` is zero or every remaining finding has a documented unreachable path.
- `electron:build`, `electron:dist`, updater metadata, and `verify:packaged` all pass.

### DEP-2: Record manual installer lifecycle validation in isolation

**Goal:** Validate installation, first run, upgrade behavior, and uninstall without exposing a developer workstation or active Rel.AI controller.
**Acceptance criteria:**

- Run on a disposable Windows VM or dedicated isolated machine.
- Use the exact generated NSIS release candidate.
- Complete first-run setup and verify the desktop application opens normally.
- Test update behavior from the previous published release where applicable.
- Uninstall successfully and verify only expected application files are removed.
- Record the tested artifact checksum, environment, observations, and result.

### DEP-3: Establish an Electron-runtime size budget

**Goal:** Prevent future application payload growth from being obscured by runtime changes.
**Acceptance criteria:**

- Track Electron runtime, `app.asar`, extra resources, packaged dependencies, locales, and bundled tools separately.
- Keep a historical Electron 31 baseline and add an explicitly approved Electron 43 baseline only after product review.
- Fail or warn independently for application payload growth and runtime-platform growth.

### DEP-4: Add scheduled dependency review

**Goal:** Keep Electron within its supported major-version window.
**Acceptance criteria:**

- Review direct packages at least monthly and on every Electron stable major release.
- Separate production and development audit output.
- Require a release build, `verify:packaged`, and an isolated manual installer-lifecycle record for every Electron major upgrade.
- Record deferrals with owner, reason, risk, and revisit trigger.

## 13. Final decision

The dependency upgrade is **complete with documented exceptions**.

The selected direct versions are current as of 2026-07-26, classifications are correct, no direct dependency is proven unused, both lockfiles are reproducible, and production audit surfaces are clean. The Electron 43 dependency-checkpoint package passed executed backend and renderer checks. The final 20-tool active-only aggregate worktree passes 106/106 tests, rebuilds successfully, and passes the current read-only packaged-layout verification.

Release approval should still require two explicit acknowledgements:

1. The approximately 24.8% installer-size increase is accepted as the cost of the current Electron runtime.
2. The 16 high-severity development findings in the electron-builder transitive graph are accepted temporarily under the documented release-host controls.

A production release should also complete and record the manual NSIS install, first-run, upgrade, and uninstall checklist in an isolated Windows environment. This is the only material release gate not completed end-to-end in the active connector-hosted session.

## 14. External references

- [Electron Releases](https://releases.electronjs.org/)
- [Electron Versioning and Support](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- [Electron 43 release notes](https://www.electronjs.org/blog/electron-43-0)
- [ESLint 10 migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0)
- [GitHub Advisory GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
- [NVD CVE-2026-14257](https://nvd.nist.gov/vuln/detail/CVE-2026-14257)
