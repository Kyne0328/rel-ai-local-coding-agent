# Electron Package-Size Audit and Optimization

## Executive summary

This audit measured the Windows x64 Electron artifacts, identified the dominant size contributors, implemented low-risk packaging changes, rebuilt both an unoptimized control and an optimized distribution from the same source state, and added release-time size reporting. The original comparison remains below as historical evidence; the active release baseline is now the 0.23.0 Electron 43, ESM, task-observability, and fuse-hardened candidate.

### Current 0.23.0 release baseline

| Metric | Bytes | Display size |
| --- | ---: | ---: |
| NSIS installer | 111,424,956 B | 106.26 MiB |
| Portable executable | 100,029,273 B | 95.40 MiB |
| Unpacked application | 363,459,639 B | 346.62 MiB |
| `resources/` | 47,575,582 B | 45.37 MiB |
| `resources/app.asar` | 1,668,963 B | 1.59 MiB |
| Electron packaged dependencies | 1,107,187 B | 1.06 MiB |
| `locales/en-US.pak` | 566,095 B | 552.83 KiB |
| Compiled dashboard CSS | 137,539 B | 134.32 KiB |

The baseline was recaptured from the reconciled 0.23.0 installer and portable artifacts on 2026-08-01. It includes Electron 43.2.0, the ESM runtime, fuse hardening, task observability, the explicitly packaged MCP SDK v2 and OpenTelemetry runtimes, and the pinned 31.73 MiB Windows ngrok seed. Relative to the earlier workstream baseline, the installer grew 1.31%, the portable executable shrank 8.79%, and the total unpacked application grew 1.87%; the larger `resources/` ratio is the deliberate telemetry dependency and ngrok update rather than duplicate locales, source maps, or source CSS. The committed strict policy now rejects any metric more than 3% above these reconciled measurements.

| Artifact | Before | After | Reduction | Reduction |
| --- | ---: | ---: | ---: | ---: |
| NSIS installer | 87,768,264 B (83.70 MiB) | 80,604,737 B (76.87 MiB) | 7,163,527 B (6.83 MiB) | 8.16% |
| Portable executable | 87,505,553 B (83.45 MiB) | 80,342,087 B (76.62 MiB) | 7,163,466 B (6.83 MiB) | 8.19% |
| Unpacked application | 306,819,731 B (292.61 MiB) | 266,665,259 B (254.31 MiB) | 40,154,472 B (38.29 MiB) | 13.09% |
| `resources/app.asar` | 2,143,336 B (2.04 MiB) | 1,692,241 B (1.61 MiB) | 451,095 B (0.43 MiB) | 21.05% |
| Electron locales | 40,139,718 B (38.28 MiB) | 464,976 B (0.44 MiB) | 39,674,742 B (37.84 MiB) | 98.84% |
| Compiled dashboard CSS | 135,682 B | 111,236 B | 24,446 B | 18.02% |

The primary avoidable cost was Electron shipping 55 Chromium locale packs for an English-only application. The optimized package ships only `en-US.pak`. Production dependency source maps were also removed from `app.asar`, and Tailwind output is now minified. Maximum electron-builder compression was tested and rejected because it made both Windows executables approximately 0.7 KiB larger.

The practical minimum remains dominated by Electron/Chromium and the bundled offline ngrok seed. The application-controlled runtime payload is comparatively small.

## Build and packaging architecture

The repository uses npm with separate root and Electron lockfiles:

- Root application: `package.json`, `package-lock.json`
- Electron launcher: `electron/package.json`, `electron/package-lock.json`
- Electron runtime: 43.2.0
- Packaging: electron-builder 26.15.3
- Root runtime and local service code: `src/**/*.js`
- CLI launchers: `bin/**/*.js`
- Dashboard assets: `public/**`
- Electron main entry: `electron/main.js`
- Electron preload boundary: `electron/preload.cjs` (sandbox-required, surface-gated)
- Electron renderer assets: `electron/renderer/**`
- Offline tunnel binary: `vendor/ngrok/win32/ngrok.exe`
- Windows targets: NSIS and portable
- Supported package produced by the current release workflow: Windows x64

The source-to-artifact flow is:

1. Tailwind compiles `src/ui/styles/app.css` to `public/dashboard.css`.
2. `scripts/verify-ngrok-seed.mjs` verifies the Windows ngrok seed.
3. The guarded release wrapper creates an OS-temporary output directory outside the VS Code workspace.
4. electron-builder packages the Electron main/preload/renderer files into `resources/app.asar` once.
5. Runtime backend JavaScript, public dashboard assets, the root package manifest, changelog, and Windows ngrok seed are copied under `resources/`.
6. NSIS and portable artifacts are generated sequentially from the same prepackaged application.
7. Completed artifacts are promoted into `dist`, and `dist/current-unpacked.json` records the authoritative unpacked directory when a legacy `dist/win-unpacked` is locked.

## Baseline methodology

The unoptimized control and optimized package were built from the same final source state. The control configuration restored the original packaging behavior for comparison:

- all Electron locales;
- dependency source maps in `app.asar`;
- unminified Tailwind output.

The optimized build used the committed production configuration. Measurements use raw bytes from final artifacts. MiB values are binary mebibytes. Installer and portable sizes are compressed executable sizes; `win-unpacked` and component measurements are raw installed sizes.

## Optimized package content breakdown

Largest files in `win-unpacked`:

| Path or component | Category | Raw size | Required at runtime | Action |
| --- | --- | ---: | --- | --- |
| `Rel.AI MCP.exe` | Electron runtime | 225,688,064 B | Yes | Retain despite size |
| `resources/bin/ngrok/win32/ngrok.exe` | Bundled platform binary | 33,273,672 B | Yes for offline first use | Retain; evaluate optional delivery separately |
| `dxcompiler.dll` | Chromium graphics compiler | 25,616,896 B | Hardware-dependent | Retain pending cross-hardware proof |
| `LICENSES.chromium.html` | Required legal notices | 20,313,957 B | Yes | Retain |
| `icudtl.dat` | Chromium ICU data | 10,876,560 B | Yes | Retain |
| `libGLESv2.dll` | Chromium graphics runtime | 8,024,064 B | Yes | Retain |
| `resources.pak` | Chromium resources | 7,148,145 B | Yes | Retain |
| `vk_swiftshader.dll` | Software graphics fallback | 5,502,464 B | Hardware-dependent | Retain pending cross-hardware proof |
| `d3dcompiler_47.dll` | Direct3D shader compiler | 4,741,488 B | Graphics-dependent | Retain |
| `ffmpeg.dll` | Chromium media runtime | 3,067,904 B | Runtime dependency | Retain |
| `resources/app.asar` | Electron application and updater dependencies | 1,668,963 B | Yes | Optimized |
| `dxil.dll` | DirectX intermediate language runtime | 1,509,760 B | Graphics-dependent | Retain |
| `vulkan-1.dll` | Vulkan loader | 930,304 B | Hardware-dependent | Retain pending proof |
| `locales/en-US.pak` | Supported locale | 566,095 B | Yes | Retain only supported locale |
| `resources/public/assets/relai-logo.png` | UI asset | 152,388 B | Yes | Retain |
| `resources/public/dashboard.css` | Compiled UI CSS | 137,539 B | Yes | Minified |
| `resources/CHANGELOG.md` | In-app release information | 138,857 B | Yes | Retain |

The current 0.23.0 `resources/` directory totals 47,575,582 B (45.37 MiB). It includes the allowlisted MCP SDK and OpenTelemetry runtimes and contains no `.map` files, TypeScript sources, tests, fixtures, examples, or `.git` metadata.

The source stylesheet `src/ui/styles/app.css` is no longer packaged. The desktop distribution includes only the compiled `resources/public/dashboard.css`, saving approximately 69 KiB raw and keeping build-only Tailwind source out of runtime resources.

## Findings

| Finding | Priority | Confidence | Evidence | Size impact | Action | Risk |
| --- | --- | --- | --- | ---: | --- | --- |
| All 55 Electron locale packs were shipped | P1 | Confirmed | Final baseline `win-unpacked/locales` inventory | 37.84 MiB raw; dominant installer reduction | Ship only `en-US` | Product language policy must remain English-only |
| Dependency source maps were included in `app.asar` | P1 | Confirmed | 47 `.map` files in baseline ASAR; zero after | 451,095 B ASAR reduction including archive overhead | Exclude `!**/*.map` | Public production debugging must use private/source-map artifacts if later required |
| SDK source and declaration trees were copied into `resources/node_modules` | P1 | Confirmed | Final 0.23.0 package inventory | 4.57 MiB raw resources reduction | Exclude dependency `src`, test, `.ts`, `.cts`, and `.mts` files | Low; packaged connector acceptance verifies runtime exports |
| Tailwind output was not minified | P2 | Confirmed | Final CSS comparison | 24,446 B raw | Add `--minify` to `build:css` | Low |
| Maximum electron-builder compression did not help | Retain | Confirmed | Isolated packaging experiment | Approximately 0.7 KiB larger per executable | Keep default compression | None |
| Electron runtime is the majority of installed size | Retain despite size | Confirmed | Final file inventory | 215.23 MiB main executable plus support files | Retain | Removing Chromium resources is unsafe without platform testing |
| Bundled ngrok is the largest application-controlled component | Deferred/P2 | Confirmed | `resources/bin/ngrok/win32/ngrok.exe` | 31.73 MiB raw | Keep for offline reliability; evaluate optional delivery only as a separate product decision | High operational and recovery risk |
| Production dependencies are explicitly allowlisted | Retain | Confirmed | Electron ASAR and root SDK resource inventory | Small relative to Electron/ngrok | Retain the updater and MCP SDK dependency sets | Low |
| Installed-app smoke shared the production application identity | Removed safety defect | Confirmed | Installer execution terminated the active Rel.AI host | Small package reduction | Replaced with read-only packaged-layout verification | High if restored on a developer machine |

## Dependency analysis

The Electron ASAR keeps `electron-updater` as its direct production dependency. The backend resources also include the explicitly allowlisted MCP SDK v2 packages and their required transitive modules from the root dependency tree.

Largest dependency payloads inside the optimized ASAR:

| Package | Raw size |
| --- | ---: |
| `electron-updater` | 383,536 B |
| `js-yaml` | 377,077 B |
| `argparse` | 162,580 B |
| `sax` | 52,263 B |
| `lodash.isequal` | 51,894 B |
| `graceful-fs` | 27,363 B |
| `debug` | 20,109 B |

No native Node.js modules are present. The only separately bundled native executable is the Windows ngrok seed. No macOS or Linux ngrok binaries are included in the Windows package.

`electron-updater` and its transitive packages should remain external runtime dependencies inside ASAR. Bundling or replacing them would provide little absolute saving and would increase updater risk.

## Bundler and minification analysis

The application does not use a conventional Vite/Webpack renderer bundle. Electron main/preload files are explicitly allowlisted, while backend JavaScript and public assets are copied as runtime resources. This is appropriate for the current dynamic module-loading architecture.

Implemented production controls:

- Tailwind output uses `--minify`.
- `app.asar` excludes `**/*.map`.
- Electron locales are filtered to `en-US`.
- ASAR remains enabled.
- Only the Windows ngrok binary is copied to the Windows build.
- The package contains no test trees, TypeScript source, repository metadata, or unsupported native binaries.

Potentially bundling all backend code would save less than 1 MiB raw while increasing dynamic-loading, diagnostics, and maintenance risk. It is not justified by the current package profile.

## Packaging configuration analysis

The existing packaging configuration already uses explicit top-level allowlists rather than copying the complete repository. The material corrections were made in `electron/package.json`:

- `electronLanguages: ["en-US"]`
- `!**/*.map` in the ASAR file list

The current `extraResources` entries remain explicit for backend JavaScript, MCP SDK runtime modules, CLI files, compiled public assets, package metadata, changelog, and Windows ngrok. Source CSS is excluded.

ASAR unpack rules are not required because there are no native Node modules. The ngrok executable is correctly copied outside ASAR. NSIS and portable targets remain because both are part of the documented release contract.

## Implemented changes

| File | Change | Purpose |
| --- | --- | --- |
| `electron/package.json` | Filter Electron locales to `en-US`; exclude source maps, TypeScript/declaration trees, dependency source/test trees, and source CSS; explicitly package MCP SDK runtime modules | Remove unnecessary payload while preserving the new protocol runtime |
| `package.json` | Minify Tailwind output; add `electron:size` | Reduce CSS and expose reproducible reporting |
| `scripts/electron-package-size.mjs` | Enforce exact canonical artifacts, final inventory, strict comparisons, and packaging-leak checks | Block unexplained package growth and packaging leaks |
| `scripts/electron-size-baseline.json` | Record the optimized Windows x64 baseline and strict 3% tolerance | Establish the release budget |
| `.github/workflows/release.yml` | Run the strict gate and upload its JSON report after a passing build | Block publication while preserving release evidence |
| `test/electron-launcher-smoke.mjs` | Assert the current packaged source-resource contract | Protect packaging configuration |
| `test/release-workflow-smoke.mjs` | Assert locale, source-map, minification, and CI reporting contracts | Prevent regression |
| `scripts/verify-packaged-app.mjs` | Verify unpacked executable and required resources without execution | Preserve package validation without installer risk |
| `public/dashboard.css` | Rebuilt as minified production CSS | Runtime size reduction |

## Validation results

### Passed

- Clean optimized Windows x64 build
- NSIS installer generation
- Portable executable generation
- `latest.yml` generation
- Installer blockmap generation: 117,386 B
- Package inventory checks
- One locale only: `en-US.pak`
- Zero packaged source maps
- Zero packaged TypeScript source or declaration files
- Zero tests, fixtures, examples, or `.git` metadata
- No duplicate production dependency versions
- JavaScript syntax, ESLint, and TypeScript boundary checks
- Knip dependency analysis and repository-health budgets
- Release consistency and workflow contract checks
- Package-size, release-workflow, updater-artifact, dashboard, and packaged-runtime focused tests passed; aggregate repository validation remains a final post-merge gate
- Real Electron Chromium dashboard acceptance
- Packaged OAuth/MCP connector acceptance against the directory resolved from `dist/current-unpacked.json`
- Electron fuse-policy verification against the final executable
- Root and Electron production dependency audits: zero advisories
- Strict package-size baseline comparison
- CycloneDX SBOM generation

### Historical 0.22.0 startup and memory comparison

Measurements used isolated user-data/state directories and sampled all four Electron processes approximately one second after a window appeared.

| Build | Launch | Window ready | Processes | Working set |
| --- | --- | ---: | ---: | ---: |
| Baseline | Cold | 363 ms | 4 | 300.3 MiB |
| Baseline | Warm | 350 ms | 4 | 296.7 MiB |
| Optimized | Cold | 402 ms | 4 | 296.7 MiB |
| Optimized | Warm | 318 ms | 4 | 296.6 MiB |

These historical 0.22.0 measurements were within normal launch variance. The 0.23.0 automated release gates validate the real Chromium renderer with the development Electron host and validate the packaged backend separately; installer and production-identity desktop startup remain manual on a disposable machine.

### Validation limitations

The former exact NSIS install/uninstall smoke was removed after it interfered with the active Rel.AI MCP installation hosting the repository connector. The production-identity installer, hidden packaged smoke modes, and teardown uninstaller were not sufficiently isolated for ordinary developer, CI, or release execution.

Package validation builds the unpacked Windows application, runs the read-only `verify:packaged` gate, and launches the isolated packaged Node backend for OAuth/MCP connector acceptance. The acceptance test does not launch or install Electron. Installer, uninstall, first-run renderer, real ngrok publication, logged-in ChatGPT app selection, and upgrade behavior remain manual checks on a disposable Windows machine.

## Regression protection

`npm run electron:size` inspects the final `dist` artifacts and reports:

- installer size;
- portable size;
- unpacked size;
- resources size;
- ASAR size;
- packaged dependency size;
- locale size and names;
- ngrok size;
- dashboard CSS size;
- largest packaged files;
- packaged source maps;
- packaged source CSS.

The committed baseline uses a strict 3% tolerance. The release workflow runs `npm run electron:size`, fails publication on any violation, and uploads `dist/electron-size-report.json` only as evidence for a passing candidate. The removed `--warn-only` mode is rejected by the script.

## Retained large components

- **Electron/Chromium runtime:** establishes the practical minimum. Removing graphics, ICU, media, accessibility, or software-rendering files without a hardware/platform matrix is unsafe.
- **Windows ngrok seed:** retained because the application promises offline first-use availability and managed tunnel recovery. On-demand delivery could save 31.73 MiB raw, but it introduces network, integrity, rollback, version-compatibility, and first-run failure modes.
- **Chromium license notices:** legally required.
- **Both NSIS and portable artifacts:** the 0.22.0 candidates are approximately 97.6–97.9 MiB each. Publishing both doubles release storage, not an individual user's download. Removing one is a distribution-policy decision.

## Deferred opportunities

1. **Optional ngrok component** — high potential raw reduction, high product and reliability risk. Requires signed/integrity-verified downloads, offline fallback, version pinning, atomic replacement, and recovery testing.
2. **Duplicate logo consolidation** — approximately 152 KiB raw per duplicate candidate, low installer impact. Requires confirming every renderer/icon call site.
3. **Private source-map publication** — source maps are currently excluded. Add a separate private artifact only if production crash diagnostics require it.
4. **Backend bundling proof of concept** — likely less than 1 MiB raw saving and not justified unless startup/module tracing demonstrates a separate benefit.

## Prioritized remaining tasks

### P2 — Evaluate optional ngrok delivery

- Affected: managed ngrok bootstrap/update/recovery and release distribution.
- Acceptance: offline behavior, signature/hash verification, atomic install, rollback, and version compatibility are proven before removing the seed.
- Rollback: retain the bundled seed.

### P3 — Review duplicate image assets

- Affected: `electron/build/icon.png`, renderer/public logos.
- Acceptance: all window, installer, tray, and dashboard icon paths remain valid after consolidation.
- Rollback: restore separate assets.

## Final recommendation

The Windows x64 distribution is appropriately bounded for the current Electron 43 and MCP SDK architecture. The historical locale/source-map/minification work remains effective, while the 0.23.0 release establishes a new measured baseline after the ESM cutover, runtime hardening, task-observability expansion, and removal of build-only SDK sources from packaged resources. Further large reductions require a product-level decision about the bundled ngrok binary or replacing Electron itself; neither is justified as routine cleanup.
