# Release Checklist

## Pre-release verification

- [ ] `npm run test:all` passes
- [ ] Manual oneclick smoke: `npm run oneclick` starts and prints ChatGPT URL
- [ ] Manual dashboard smoke: open dashboard, verify workspaces and workflow mode display
- [ ] Manual ChatGPT connector smoke: add `/mcp` to ChatGPT with Authentication: OAuth, complete the dashboard-token sign-in, call relai_status
- [ ] Manual Electron launch smoke: open Electron app, start server, copy MCP URL
- [ ] OAuth credential rotation: rotate `REL_AI_MCP_TOKEN` and verify the next ChatGPT OAuth sign-in requires the new token
- [ ] Windows command construction: `npm run test:windows-archive` passes on Windows

## Supported platforms

- Windows (Node.js >= 18, tested on Node 22)
- macOS (Node.js >= 18)
- Linux (Node.js >= 18)

## Publishing (when ready)

1. Remove `"private": true` from `package.json`
2. Update version in `package.json` and `CHANGELOG.md`
3. `npm publish`

**Do not publish until all checklist items pass.**
