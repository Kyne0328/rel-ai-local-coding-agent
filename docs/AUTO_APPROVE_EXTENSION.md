# ChatGPT app-request approval helper Chrome extension

Rel.AI MCP now uses a Chrome extension only for optional ChatGPT app-request approval assistance. The userscript workflow was removed because background tabs and userscript managers were unreliable.

Author: [@Kyne0328](https://github.com/Kyne0328)

## Enable/disable control

The Chrome extension popup is the only enable/disable control. The dashboard does not need to be enabled.

To enable approval assistance, open the Chrome extension popup and toggle **Enable in this browser**. To stop, toggle it off. No dashboard setting is required.

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
9. Enable the extension toggle only while supervising a local workspace task.

## Why extension-only

Chrome throttles background tabs. Userscripts can pause or run late when ChatGPT is not the foreground tab. A Chrome extension can use a background service worker, alarms, tab messaging, and injected content scripts, so it is the supported path.

## What it can approve

The extension detects small Rel.AI MCP app-request cards on ChatGPT and clicks only a valid action button inside that card. It recognizes requests such as:

- Repository Snapshot
- Read Local Repo Paths
- Replace Exact Text
- Write Local Repo File
- Clear Local Repo Files
- Apply Prepared Update
- Apply Prepared Bundle
- Package Workspace Zip
- Run Workspace Checks
- Browser/UI Check
- Review Local Repo Diff
- Restore Workspace Changes

It requires Rel.AI MCP card text and a Deny/Cancel-style button nearby, so ordinary ChatGPT buttons such as message edit controls are not approval targets.

## Usage note

This can approve local repository reads, file changes, validation checks, browser checks, diffs, or restores without a manual click. Use only on your own machine while supervising the task, then disable it when done.

## Request button coverage

The extension recognizes request cards for the Rel.AI workspace tools: repository snapshot, read, exact text replacement, file write, file clear, prepared update, prepared bundle, workspace package, validation check, browser/UI check, diff review, and restore actions such as `Restore Workspace`. It first identifies the small Rel.AI MCP request card, then clicks only the primary non-negative action button inside that card.
