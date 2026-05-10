# ChatGPT app-request auto-approve userscript

Rel.AI MCP includes an optional userscript for ChatGPT web that can click Rel.AI MCP app-request approval buttons automatically.

## Warning

This is intentionally **off by default**. Auto-approve can authorize local repo reads, full-file writes, verification commands, browser checks, diffs, or resets without a manual click. Use it only on your own trusted machine while you are supervising a task. Turn it off when the task is done.

## Required double opt-in

Auto-approve runs only when both switches are enabled:

1. Dashboard setting: **Settings -> General -> ChatGPT web app-request auto-approve**.
2. Userscript local setting: open the userscript menu on ChatGPT and choose **Rel.AI: Enable auto-approve in this browser**.

Either switch disables the behavior.

## Install

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Open the Rel.AI dashboard.
3. Go to **Settings -> General**.
4. Use **Open userscript** or **Open with token embedded**.
5. Review and install the script.
6. Open ChatGPT web and use the userscript menu to configure the local server/token if needed.
7. Enable the local userscript toggle only while you want auto-approval active.

## How it works

The userscript runs only on `chatgpt.com` and `chat.openai.com`. It polls your local Rel.AI MCP dashboard endpoint:

```text
/api/auto-approve/settings
```

If the dashboard setting is enabled and the browser-local userscript toggle is enabled, it looks for ChatGPT app-request dialogs that mention Rel.AI MCP or one of the bridge tools:

```text
relai_repo_snapshot
relai_read
relai_write
relai_verify
relai_browser
relai_diff
relai_reset
```

Then it clicks one matching approval button at a time.

## Disable

Disable either side:

- Dashboard: turn off **Enable dashboard-side auto-approve**.
- ChatGPT page: userscript menu -> **Rel.AI: Disable auto-approve in this browser**.


## Troubleshooting: userscript installed but nothing clicks

Version 0.11.23 uses a stricter userscript path:

- It uses `GM_xmlhttpRequest` instead of page `fetch` when available, which avoids common HTTPS-to-localhost and CORS failures on ChatGPT pages.
- It is quiet by default while approving requests. Use the userscript menu to enable/disable it.
- The bottom-right status pill is hidden by default. Use **Rel.AI: Toggle status pill** or debug mode to show it temporarily.
- It watches DOM mutations instead of only polling, so newly-rendered app-request dialogs are detected faster.
- It only clicks approval-like buttons whose nearby dialog/container text mentions Rel.AI MCP or one of the bridge tools.

If it still does not click:

1. Confirm the dashboard setting is enabled and warning accepted.
2. Open ChatGPT and click the bottom-right **Rel.AI auto-approve** pill so it says browser on / watching.
3. If it says **settings error**, open the userscript menu and configure the local server/token, or reinstall with **Open with token embedded** from the dashboard.
4. Confirm the MCP dashboard URL is reachable from the same browser.
5. Keep the ChatGPT tab focused while testing the first approval.

## ChatGPT button labels

Current ChatGPT app-request prompts can label the confirmation button with the tool action itself, for example **Edit File** or **Write File**, instead of a generic **Allow** or **Approve** button. The userscript treats Rel.AI bridge action labels as approval buttons only when they appear inside a Rel.AI MCP app-request card. It does not click ordinary ChatGPT buttons such as message **Edit** buttons.

### If the button still does not click

Use the userscript menu on ChatGPT:

- **Rel.AI: Toggle debug labels** shows visible button labels in the optional status pill.
- **Rel.AI: Toggle status pill** shows or hides the bottom-right status pill.
- **Rel.AI: Click matching button now** tries a one-shot click using the same matcher.

The userscript treats visible bridge-action buttons such as `title="Edit File"` or `title="Write File"` as approval candidates only when their ancestor card contains Rel.AI MCP app-request text, such as `rel-ai-mcp`, `Using tools comes with risks`, workspace details, or file overwrite text.


## Notification behavior

Notifications are quiet by default while app requests are being approved. The userscript does not notify for every approval. After a quiet period with no more matching app-request buttons, it sends one summary notification so you know the request burst has finished.

## Toggle behavior

The browser-local toggle stays on after approving app requests. The status pill does not disable auto-approve on a normal click; use the userscript menu to disable it, or Shift-click the pill intentionally.

The matcher supports ChatGPT approval buttons labelled with bridge actions such as `Edit File`, `Write File`, `Read Local Repo Paths`, `Verify`, `Diff`, and `Reset`, but only when they are inside the Rel.AI MCP app-request card.
