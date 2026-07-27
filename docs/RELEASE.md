# Release Checklist

## Pre-release verification

- [ ] `npm run test:all` passes
- [ ] `npm run electron:build` produces the unpacked Windows application
- [ ] `npm run verify:packaged` passes without launching or installing the Electron application
- [ ] `npm run test:connector-acceptance` passes against the packaged backend, including OAuth/PKCE, tools/resources, explicit task completion, reconnect rejection, and removed legacy MCP routes
- [ ] Manual installer check on a disposable Windows VM: install the exact NSIS candidate, complete first run, close it, uninstall it, and inspect the result
- [ ] Manual clean-first-run tunnel check: complete setup with a real ngrok account and confirm the permanent endpoint is externally reachable
- [ ] Manual ChatGPT UI check: add or reconnect `/mcp` with Authentication: OAuth, approve the existing app, select it in a chat, start one read-only task, and complete it
- [ ] Manual approval-token rotation check: type `REPLACE`, confirm current grants are rejected, retry the existing ChatGPT app, and reconnect without changing the MCP URL
- [ ] Manual update check: install the previous published release and confirm it discovers, verifies, downloads, and installs the candidate through GitHub Releases
- [ ] Release assets include the installer, portable executable, `latest.yml`, blockmap, and `SHA256SUMS.txt`
- [ ] `latest.yml` contains a nonempty SHA-512 value and every SHA-256 value in `SHA256SUMS.txt` matches its published asset
- [ ] Release notes state that Windows artifacts are currently unsigned

## Supported platforms

The shipped product is a self-contained Windows desktop app; end users install nothing else.

Building from source requires Node.js >= 22.13 (CI tests 22 and 24). The packaging config currently targets Windows only.

## Publishing

Releases are published automatically. Pushing a version bump to `main` triggers `.github/workflows/release.yml`, which runs the tests, fetches the ngrok seed, builds the executables, verifies the unpacked package layout without executing it, validates SHA-512 updater metadata, creates `SHA256SUMS.txt`, and creates the GitHub release from the matching `CHANGELOG.md` section.

Installed-app behavior and the logged-in ChatGPT UI remain manual release checks on a disposable machine. The packaged Node backend may be launched by `test:connector-acceptance`; the release workflow must never install, launch, or uninstall the Electron application on the runner or on a developer workstation. See [USABILITY_ACCEPTANCE.md](USABILITY_ACCEPTANCE.md) for the exact boundary.

To verify a downloaded executable in PowerShell:

```powershell
Get-FileHash .\Rel.AI*.exe -Algorithm SHA256
```

Compare the reported hash with the matching line in `SHA256SUMS.txt`. The checksum can detect a changed download, but it does not prove publisher identity. Windows artifacts are currently unsigned and may trigger an unidentified-publisher warning.

See [../RELEASE.md](../RELEASE.md) for the full release process.

**Do not bump the version until all checklist items pass.**
