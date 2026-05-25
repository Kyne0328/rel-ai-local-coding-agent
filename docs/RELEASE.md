# Release Checklist

## Pre-release verification

- [ ] `npm run test:all` passes
- [ ] Manual oneclick smoke: `npm run oneclick` starts and prints ChatGPT URL
- [ ] Manual dashboard smoke: open dashboard, verify workspaces and workflow mode display
- [ ] Manual ChatGPT connector smoke: add `/mcp/<secret>` to ChatGPT with No Authentication, call relai_status
- [ ] Manual extension approval smoke: install Chrome extension, enable from popup only, verify approval works
- [ ] Manual Electron launch smoke: open Electron app, start server, copy MCP URL
- [ ] Secret URL rotation: verify changing `REL_AI_MCP_CHATGPT_SECRET` invalidates old URL
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
