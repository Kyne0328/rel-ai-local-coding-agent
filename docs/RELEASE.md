# Release Checklist

## Pre-release verification

- [ ] `npm run test:all` passes
- [ ] `npm run test:installed` passes on Windows (builds, installs, and smoke-tests the packaged app)
- [ ] Manual first-run smoke: install the built app on a clean machine, complete the wizard, confirm the tunnel reaches **running**
- [ ] Manual dashboard smoke: open dashboard, verify workspaces and workflow mode display
- [ ] Manual ChatGPT connector smoke: add `/mcp` to ChatGPT with Authentication: OAuth, complete the dashboard-token sign-in, call relai_status
- [ ] OAuth credential rotation: rotate the dashboard token in Settings and verify the next ChatGPT OAuth sign-in requires the new value

## Supported platforms

The shipped product is a self-contained Windows desktop app; end users install nothing else.

Building from source requires Node.js >= 22.13 (CI tests 22 and 24). The packaging config currently targets Windows only.

## Publishing

Releases are published automatically. Pushing a version bump to `main` triggers `.github/workflows/release.yml`, which runs the tests, fetches the ngrok seed, builds the installers, and creates the GitHub release from the matching `CHANGELOG.md` section.

See [../RELEASE.md](../RELEASE.md) for the full release process.

**Do not bump the version until all checklist items pass.**
