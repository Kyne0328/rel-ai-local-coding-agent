# Release Checklist

## Pre-release verification

- [ ] `npm run test:all` passes
- [ ] `npm run electron:build` produces the unpacked Windows application
- [ ] `node scripts/current-unpacked.mjs` resolves the promoted unpacked application and `npm run verify:packaged -- --dir <resolved-directory>` passes without launching or installing Electron
- [ ] Electron fuse verification passes for the executable in the resolved unpacked directory
- [ ] `npm run knip:production` passes against the shipped root, dashboard, and Electron runtime entries
- [ ] `npm run audit:production` reports zero high-severity production advisories
- [ ] `npm run audit:packaging` passes its fail-closed, expiry-bound build-tool policy
- [ ] `npm run benchmark:observability` completes every required backend and Electron renderer metric with no failed or incomplete result
- [ ] `npm run electron:size` passes the strict 3% package budget
- [ ] `npm run verify:ngrok` validates the schema-v2 acquisition manifest, and `npm run verify:ngrok -- --download` confirms the exact reviewed archive and executable sizes, SHA-256 values, version, Authenticode publisher, and certificate issuer
- [ ] `npm run test:connector-acceptance` passes against the packaged backend, including OAuth/PKCE, tools/resources, explicit task completion, reconnect rejection, and removed legacy MCP routes
- [ ] Manual installer check on a disposable Windows VM: install the exact NSIS candidate, complete first run, close it, uninstall it, and inspect the result
- [ ] Manual clean-first-run tunnel check: complete setup with a real ngrok account and confirm the permanent endpoint is externally reachable
- [ ] Manual ChatGPT UI check: add or reconnect `/mcp` with Authentication: OAuth, approve the existing app, select it in a chat, start one read-only task, and complete it
- [ ] Manual approval-token rotation check: type `REPLACE`, confirm current grants are rejected, retry the existing ChatGPT app, and reconnect without changing the MCP URL
- [ ] Manual update check: install the previous published release and confirm it discovers, verifies, downloads, and installs the candidate through GitHub Releases
- [ ] Release assets use the exact canonical basenames `Rel.AI-MCP-Setup-<version>.exe`, `Rel.AI-MCP-Portable-<version>.exe`, and `Rel.AI-MCP-Setup-<version>.exe.blockmap`, plus `latest.yml`, the CycloneDX SBOM, `electron-size-report.json`, and `SHA256SUMS.txt`
- [ ] `npm run verify:updater-artifacts -- --dir dist --asset-list dist/release-assets.txt` confirms exact-name publication, blockmap presence, byte-correct SHA-512 metadata, and SHA-256 coverage
- [ ] Authenticode verification reports `Valid` for the installer, portable executable, and unpacked Rel.AI executable
- [ ] Packaged verification confirms `ngrok.exe` is absent and the acquisition manifest appears in the package and CycloneDX SBOM
- [ ] Scan the installer, portable executable, and unpacked Rel.AI executable as Rel.AI-owned samples; scan the separately acquired ngrok executable independently and submit incorrect detections before broad distribution
- [ ] GitHub build-provenance and SBOM attestations are created for the release assets

## Supported platforms

The shipped product is a Windows desktop app; end users install nothing else manually. First-run setup requires network access and explicit consent so Rel.AI can acquire and configure the official pinned ngrok component.

Building from source requires Node.js 24 LTS and npm 11. The packaging and automated release configuration target Windows x64 only.

## Publishing

Releases are published automatically. Pushing a version bump to `main` triggers `.github/workflows/release.yml`, which requires protected Windows signing credentials, exercises the pinned official ngrok acquisition in a temporary directory, runs the full tests, production analysis, production audit, expiry-bound packaging audit, executable observability benchmark, and strict package-size gate, builds with `forceCodeSigning`, resolves the promoted unpacked directory, verifies Electron fuses, Rel.AI Authenticode signatures, the manifest-only ngrok package boundary, the package layout, and the packaged OAuth/MCP flow, validates the exact updater artifact contract, creates a CycloneDX SBOM and `SHA256SUMS.txt`, attests provenance and the SBOM, and creates the GitHub release from the matching `CHANGELOG.md` section.

Installed-app behavior and the logged-in ChatGPT UI remain manual release checks on a disposable machine. The packaged Node backend may be launched by `test:connector-acceptance`; the release workflow must never install, launch, or uninstall the Electron application on the runner or on a developer workstation. See [USABILITY_ACCEPTANCE.md](USABILITY_ACCEPTANCE.md) for the exact boundary.

To verify a downloaded executable in PowerShell:

```powershell
Get-FileHash .\Rel.AI-MCP-*.exe -Algorithm SHA256
```

Compare the reported hash with the matching line in `SHA256SUMS.txt`, then confirm `Get-AuthenticodeSignature` reports `Valid`. Checksums detect byte changes; Authenticode establishes the configured publisher identity. The release workflow refuses to publish unsigned Windows executables.

See [../RELEASE.md](../RELEASE.md) for the full release process and [ANTIVIRUS_FALSE_POSITIVES.md](ANTIVIRUS_FALSE_POSITIVES.md) for component-level scan triage and vendor submissions.

**Do not bump the version until all checklist items pass.**
