const pkg = require("../package.json");
const { normalizeChatgptRequestHelper } = require("./config");

function publicRequestHelperConfig(config) {
  return {
    ok: true,
    name: "Rel.AI ChatGPT request helper",
    version: pkg.version,
    warning: "The helper is disabled by default. It only targets visible ChatGPT app/tool request dialogs that mention Rel.AI or allowed bridge tools.",
    config: normalizeChatgptRequestHelper(config && config.chatgptRequestHelper)
  };
}

function renderUserscript(config, options = {}) {
  const helper = normalizeChatgptRequestHelper(config && config.chatgptRequestHelper);
  const baseUrl = String(options.baseUrl || "http://127.0.0.1:3333").replace(/\/+$/, "");
  const policy = JSON.stringify(helper, null, 2).replace(/<\//g, "<\\/");
  const base = JSON.stringify(baseUrl);
  return `// ==UserScript==
// @name         Rel.AI MCP ChatGPT Request Helper
// @namespace    rel-ai-mcp
// @version      ${pkg.version}
// @description  Optional local helper for ChatGPT app/tool request dialogs. Disabled unless enabled in the embedded policy.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const RELAI_BASE_URL = ${base};
  const POLICY = ${policy};
  const STATE_KEY = "relai_request_helper_state_v1";
  const LOG_PREFIX = "[rel-ai-mcp request helper]";
  const APPROVE_WORDS = normalizeList(POLICY.approveButtonText);
  const ALLOWED_TOOLS = normalizeList(POLICY.allowedToolNames);
  const ALLOWED_APP_TEXT = normalizeList(POLICY.allowedAppText);
  const clicks = [];
  let lastClickAt = 0;
  let overlay;

  function normalizeList(value) {
    return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  }

  function localOverride() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || "{}"); }
    catch (_) { return {}; }
  }

  function effectivePolicy() {
    const override = localOverride();
    return { ...POLICY, ...override };
  }

  function setOverride(patch) {
    const next = { ...localOverride(), ...patch };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    updateOverlay("settings updated");
  }

  function textOf(node) {
    return String(node && (node.innerText || node.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function closestRequestRoot(button) {
    const selectors = ["[role='dialog']", "[data-testid*='modal']", "main", "body"];
    for (const selector of selectors) {
      const found = button.closest(selector);
      if (found) return found;
    }
    return document.body;
  }

  function containsAny(haystack, needles) {
    const lower = String(haystack || "").toLowerCase();
    return needles.some((needle) => lower.includes(String(needle).toLowerCase()));
  }

  function isApproveButton(button) {
    if (!button || button.disabled) return false;
    const label = textOf(button) || button.getAttribute("aria-label") || "";
    if (!label) return false;
    return APPROVE_WORDS.some((word) => label.toLowerCase() === String(word).toLowerCase() || label.toLowerCase().includes(String(word).toLowerCase()));
  }

  function isAllowedRequest(button) {
    const policy = effectivePolicy();
    const root = closestRequestRoot(button);
    const text = textOf(root);
    const relaiOk = policy.requireRelaiText === false || containsAny(text, ALLOWED_APP_TEXT);
    const toolOk = policy.requireToolName !== true || containsAny(text, ALLOWED_TOOLS);
    return relaiOk && toolOk;
  }

  function rateLimited(policy) {
    const now = Date.now();
    while (clicks.length && now - clicks[0] > 60000) clicks.shift();
    if (clicks.length >= Number(policy.maxClicksPerMinute || 12)) return true;
    if (now - lastClickAt < Number(policy.cooldownMs || 1500)) return true;
    return false;
  }

  function recordClick() {
    lastClickAt = Date.now();
    clicks.push(lastClickAt);
  }

  function scan() {
    const policy = effectivePolicy();
    if (!policy.enabled) return updateOverlay("disabled");
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const candidates = buttons.filter(isApproveButton).filter(isAllowedRequest);
    if (!candidates.length) return updateOverlay(policy.autoApprove ? "watching" : "watching (manual mode)");
    const button = candidates[0];
    button.style.outline = "2px solid #4ea1ff";
    button.style.outlineOffset = "2px";
    if (!policy.autoApprove) return updateOverlay("request found; auto-approve off");
    if (rateLimited(policy)) return updateOverlay("request found; rate limited");
    console.info(LOG_PREFIX, "approving visible Rel.AI request", { label: textOf(button), baseUrl: RELAI_BASE_URL });
    recordClick();
    button.click();
    updateOverlay("approved request");
  }

  function ensureOverlay() {
    const policy = effectivePolicy();
    if (!policy.showOverlay) {
      if (overlay) overlay.remove();
      overlay = null;
      return null;
    }
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#0b1220;color:#dbeafe;border:1px solid #334155;border-radius:10px;padding:10px 12px;font:12px system-ui, sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:280px;";
    overlay.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">Rel.AI request helper</div><div data-relai-status>starting</div><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;"><button data-relai-toggle style="font:inherit">toggle</button><button data-relai-auto style="font:inherit">auto</button></div>';
    document.documentElement.appendChild(overlay);
    overlay.querySelector("[data-relai-toggle]").onclick = () => setOverride({ enabled: !effectivePolicy().enabled });
    overlay.querySelector("[data-relai-auto]").onclick = () => setOverride({ autoApprove: !effectivePolicy().autoApprove });
    return overlay;
  }

  function updateOverlay(status) {
    const el = ensureOverlay();
    if (!el) return;
    const policy = effectivePolicy();
    const target = el.querySelector("[data-relai-status]");
    if (target) target.textContent = String(status) + "; enabled=" + Boolean(policy.enabled) + "; auto=" + Boolean(policy.autoApprove);
  }

  if (!POLICY.enabled) {
    console.info(LOG_PREFIX, "installed but disabled. Enable it from the embedded dashboard policy or overlay.");
  }
  ensureOverlay();
  setInterval(scan, 500);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
}

module.exports = { publicRequestHelperConfig, renderUserscript };
