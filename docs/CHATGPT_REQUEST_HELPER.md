# ChatGPT request helper userscript

Rel.AI MCP includes an optional userscript for ChatGPT Web that can detect visible Rel.AI app/tool request dialogs and, when explicitly enabled, click the approval button for you.

## Safety model

The helper is intentionally limited:

- Disabled by default.
- Only targets visible buttons in ChatGPT pages.
- Requires nearby dialog text to mention Rel.AI / rel-ai-mcp by default.
- Can require exact bridge tool names if you enable that setting.
- Has a cooldown and max-clicks-per-minute limit.
- Does not read cookies, passwords, files, or conversation history.
- Does not approve browser, OS, payment, login, or account-security prompts.

## Install

1. Open the Rel.AI dashboard.
2. Go to Settings → General → ChatGPT request helper.
3. Enable the helper and optionally enable auto-approve.
4. Click **Download userscript**.
5. Install it in a userscript manager. On Android, use a browser/userscript manager combination that supports userscripts on `chatgpt.com`.
6. Reinstall the userscript after changing helper settings, because the policy is embedded into the script at download time.

## Normal behavior

When auto-approve is off, the helper only highlights matching request buttons and shows a small overlay.

When auto-approve is on, it clicks only matching visible approval buttons and then rate-limits itself.

## Troubleshooting

If ChatGPT changes its UI, the helper may stop detecting request dialogs. That is safer than clicking unrelated buttons. Update the userscript policy or disable it from the overlay.
