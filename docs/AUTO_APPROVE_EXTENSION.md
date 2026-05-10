# ChatGPT app-request auto-approve Chrome extension

Rel.AI MCP now uses a Chrome extension only for optional ChatGPT app-request auto-approval. The userscript workflow was removed because background tabs and userscript managers were unreliable.

Author: [@Kyne0328](https://github.com/Kyne0328)

## Required double opt-in

Auto-approve runs only when both toggles are enabled:

1. Dashboard setting: **Settings -> General -> ChatGPT web app-request auto-approve extension**.
2. Chrome extension popup: **Enable in this browser**.

Either side disables automation.

## Install

1. Start the Rel.AI MCP dashboard.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this package folder:

   ```text
   public/extensions/chrome-auto-approve
   ```

6. Click the Rel.AI MCP extension icon.
7. Set the dashboard URL, usually:

   ```text
   http://127.0.0.1:3333
   ```

8. Paste the dashboard token if your dashboard requires one.
9. Enable the extension toggle only while supervising a trusted task.

## Why extension-only

Chrome throttles background tabs. Userscripts can pause or run late when ChatGPT is not the foreground tab. A Chrome extension can use a background service worker, alarms, tab messaging, and injected content scripts, so it is the supported path.

## What it can approve

The extension detects small Rel.AI MCP app-request cards on ChatGPT and clicks only a valid action button inside that card. It recognizes actions such as:

- Read Local Repo Paths
- Read File / Read Files
- Edit File / Write File
- Verify
- Browser
- Diff
- Reset

It requires Rel.AI MCP card text and a Deny/Cancel-style button nearby, so ordinary ChatGPT buttons such as message edit controls are not approval targets.

## Warning

This can authorize local repository reads, full-file writes, verification commands, browser checks, diffs, or resets without a manual click. Use only on your own trusted machine and disable it when done.

## Approval button coverage

The extension recognizes approval cards for every normal Rel.AI bridge tool: repository snapshot, read, write/edit file, verify, browser/UI check, diff review, and reset/rollback actions such as `Reset Workspace`. It first identifies the small Rel.AI MCP approval card, then clicks only the primary non-negative action button inside that card.
