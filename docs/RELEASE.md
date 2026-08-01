# Release Checklist

## Pre-release verification

- [ ] `npm run test:native-tasks-release-gate` passes the HTTP/stdio capability matrix, lifecycle, security, bounds, process-separation, public-surface, dashboard, and ChatGPT-fallback checks
- [ ] `npm run test:all` passes
- [ ] `npm run electron:build` produces the unpacked Windows application
- [ ] `node scripts/current-unpacked.mjs` resolves the promoted unpacked application and `npm run verify:packaged -- --dir <resolved-directory>` passes without launching or installing Electron
- [ ] `npm run verify:fuses -- "<resolved-directory>/Rel.AI MCP.exe"` passes for the exact executable in the resolved unpacked directory; the verifier refuses to select a build implicitly
- [ ] `npm run knip:production` passes against the shipped root, dashboard, and Electron runtime entries
- [ ] `npm run audit:production` reports zero high-severity production advisories
- [ ] `npm run audit:packaging` passes its fail-closed, expiry-bound build-tool policy
- [ ] `npm run benchmark:observability` completes every required backend and Electron renderer metric with no failed or incomplete result
- [ ] `npm run electron:size` passes the strict 3% package budget
- [ ] `npm run verify:ngrok` confirms the exact reviewed ngrok version, size, SHA-256, Authenticode publisher, and certificate issuer
- [ ] `npm run test:connector-acceptance` passes against the packaged backend, including OAuth/PKCE, native Tasks, bounded fallback, tools/resources, explicit task completion, reconnect rejection, and removed legacy MCP routes
- [ ] Manual installer check on a disposable Windows VM: install the exact NSIS candidate, complete first run, close it, uninstall it, and inspect the result
- [ ] Manual clean-first-run tunnel check: complete setup with a real ngrok account and confirm the permanent endpoint is externally reachable
- [ ] Manual ChatGPT UI check: add or reconnect `/mcp` with Authentication: OAuth, approve the existing app, select it in a chat, start one read-only task, and complete it
- [ ] Manual approval-token rotation check: type `REPLACE`, confirm current grants are rejected, retry the existing ChatGPT app, and reconnect without changing the MCP URL
- [ ] Manual update check: install the previous published release and confirm it discovers, verifies, downloads, and installs the candidate through GitHub Releases
- [ ] Release assets use the exact canonical basenames `Rel.AI-MCP-Setup-<version>.exe`, `Rel.AI-MCP-Portable-<version>.exe`, and `Rel.AI-MCP-Setup-<version>.exe.blockmap`, plus `latest.yml`, the CycloneDX SBOM, `electron-size-report.json`, and `SHA256SUMS.txt`
- [ ] `npm run verify:updater-artifacts -- --dir dist --asset-list dist/release-assets.txt` confirms exact-name publication, blockmap presence, byte-correct SHA-512 metadata, and SHA-256 coverage
- [ ] The bundled ngrok executable reports a valid upstream Authenticode signature; Rel.AI-owned executables are expected to be unsigned and their SHA-256 hashes match `SHA256SUMS.txt`
- [ ] The packaged ngrok hash matches `vendor/ngrok/manifest.json` and appears in the CycloneDX SBOM
- [ ] Scan the installer, portable executable, unpacked Rel.AI executable, and ngrok executable separately; investigate any Trojan/malware classification and submit incorrect detections before broad distribution
- [ ] GitHub build-provenance and SBOM attestations are created for the release assets

## Supported platforms

The shipped product is a self-contained Windows desktop app; end users install nothing else.

Building from source requires Node.js 24 LTS and npm 11. The packaging and automated release configuration target Windows x64 only.

## Publishing

Releases are published automatically. Pushing a version bump to `main` triggers `.github/workflows/release.yml`, which authenticates the pinned ngrok seed, runs the native Tasks release gate and full tests, production analysis, production audit, expiry-bound packaging audit, executable observability benchmark, and strict package-size gate, builds unsigned Windows artifacts with certificate auto-discovery disabled, resolves the promoted unpacked directory, verifies Electron fuses, ngrok provenance and its upstream Authenticode signature, the package layout, and the packaged OAuth/MCP flow, validates the exact updater artifact contract, creates a CycloneDX SBOM and `SHA256SUMS.txt`, attests provenance and the SBOM, and creates the GitHub release from the matching `CHANGELOG.md` section.

Installed-app behavior and the logged-in ChatGPT UI remain manual release checks on a disposable machine. The packaged Node backend may be launched by `test:connector-acceptance`; the release workflow must never install, launch, or uninstall the Electron application on the runner or on a developer workstation. See [USABILITY_ACCEPTANCE.md](USABILITY_ACCEPTANCE.md) for the exact boundary.

To verify a downloaded executable in PowerShell:

```powershell
Get-FileHash .\Rel.AI-MCP-*.exe -Algorithm SHA256
```

Compare the reported hash with the matching line in `SHA256SUMS.txt`. The Rel.AI installer, portable executable, and unpacked application are currently unsigned, so `Get-AuthenticodeSignature` is expected to report `NotSigned` for those files. The bundled ngrok executable must still report a valid upstream Authenticode signature and match the pinned manifest hash.

See [../RELEASE.md](../RELEASE.md) for the full release process and [ANTIVIRUS_FALSE_POSITIVES.md](ANTIVIRUS_FALSE_POSITIVES.md) for component-level scan triage and vendor submissions.

The release gate fails on Tasks without negotiation, HTTP/stdio divergence, public probe registration, unauthorized task access, invalid terminal transitions, cancellation cleanup failure, unbounded synchronous execution, persistent-process regressions, or packaged runtime failure. See [NATIVE_TASKS_RELEASE_GATE.md](NATIVE_TASKS_RELEASE_GATE.md).

**Do not bump the version until all checklist items pass.**
