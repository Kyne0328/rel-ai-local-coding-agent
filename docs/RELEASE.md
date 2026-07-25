# Release Checklist

## Pre-release verification

- [ ] `npm run test:all` passes
- [ ] `npm run test:installed` passes on Windows and produces a valid `release-readiness.json` plus all four required screenshots
- [ ] The exact NSIS installer intended for publication passes `npm run test:installed` through `REL_AI_SMOKE_INSTALLER`
- [ ] Manual clean-first-run tunnel check: complete setup with a real ngrok account and confirm the permanent endpoint is externally reachable
- [ ] Manual ChatGPT OAuth check: add `/mcp` with Authentication: OAuth, approve the existing app, and call `relai_status`
- [ ] Manual approval-token rotation check: type `REPLACE`, confirm current grants are rejected, retry the existing ChatGPT app, and reconnect without changing the MCP URL
- [ ] Manual update check: install the previous published release and confirm it discovers, verifies, downloads, and installs the candidate through GitHub Releases
- [ ] Release assets include the installer, portable executable, `latest.yml`, blockmap, `release-readiness.json`, `release-usability-evidence.zip`, and `SHA256SUMS.txt`
- [ ] `latest.yml` contains a nonempty SHA-512 value and every SHA-256 value in `SHA256SUMS.txt` matches its published asset
- [ ] Release notes state that Windows artifacts are currently unsigned

## Supported platforms

The shipped product is a self-contained Windows desktop app; end users install nothing else.

Building from source requires Node.js >= 22.13 (CI tests 22 and 24). The packaging config currently targets Windows only.

## Publishing

Releases are published automatically. Pushing a version bump to `main` triggers `.github/workflows/release.yml`, which runs the tests, fetches the ngrok seed, builds the executables, installs and smokes the exact release installer, validates the machine-readable usability evidence, validates SHA-512 updater metadata, creates `SHA256SUMS.txt`, and creates the GitHub release from the matching `CHANGELOG.md` section.

Automated acceptance is intentionally incomplete without the four external checks above. See [USABILITY_ACCEPTANCE.md](USABILITY_ACCEPTANCE.md) for the exact scenario manifest, evidence format, commands, and interpretation.

To verify a downloaded executable in PowerShell:

```powershell
Get-FileHash .\Rel.AI*.exe -Algorithm SHA256
```

Compare the reported hash with the matching line in `SHA256SUMS.txt`. The checksum can detect a changed download, but it does not prove publisher identity. Windows artifacts are currently unsigned and may trigger an unidentified-publisher warning.

See [../RELEASE.md](../RELEASE.md) for the full release process.

**Do not bump the version until all checklist items pass.**
