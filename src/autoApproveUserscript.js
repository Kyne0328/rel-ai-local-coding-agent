const pkg = require("../package.json");

function autoApproveSettings(config) {
  const cfg = config.autoApproveAppRequests || {};
  return {
    ok: true,
    enabled: cfg.enabled === true,
    requireUserscriptToggle: cfg.requireUserscriptToggle !== false,
    pollMs: Number(cfg.pollMs || 1200),
    warningAccepted: cfg.warningAccepted === true,
    product: pkg.name,
    version: pkg.version,
    warning: "Auto-approving ChatGPT app requests can authorize local repo reads/writes/verification without a manual click. Enable only on your own trusted machine and disable it after the task."
  };
}

function escapeJsString(value) {
  return JSON.stringify(String(value || ""));
}

function renderUserscript({ baseUrl = "", token = "" } = {}) {
  const defaultBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const defaultToken = String(token || "");
  return String.raw`// ==UserScript==
// @name         Rel.AI MCP ChatGPT App Request Auto-Approve
// @namespace    rel-ai-mcp
// @version      ${pkg.version}
// @description  Optional, dangerous helper that can auto-approve Rel.AI MCP app requests in ChatGPT after explicit dashboard and userscript opt-in.
// @author       Kyne0328
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_PREFIX = 'relai_mcp_auto_approve_';
  const DEFAULT_BASE_URL = ${escapeJsString(defaultBaseUrl)};
  const DEFAULT_TOKEN = ${escapeJsString(defaultToken)};
  const TOOL_NAMES = ['relai_repo_snapshot', 'relai_read', 'relai_write', 'relai_verify', 'relai_browser', 'relai_diff', 'relai_reset'];
  const BRIDGE_ACTION_LABELS = [
    'repo snapshot', 'repository snapshot', 'snapshot repository',
    'read', 'read file', 'read files', 'read local repo paths', 'read local repo', 'read paths', 'read repository paths', 'read directory', 'read directories', 'batch-read files',
    'write', 'write file', 'write files', 'edit file', 'edit files', 'update file', 'overwrite file',
    'verify', 'run verification', 'browser', 'browser check',
    'diff', 'inspect diff', 'reset', 'reset repo', 'reset repository'
  ];
  const POSITIVE_LABELS = [
    'allow', 'allow once', 'approve', 'approve request', 'continue', 'confirm',
    'run', 'use app', 'connect', 'authorize', 'yes', 'ok', 'okay',
    ...BRIDGE_ACTION_LABELS
  ];
  const NEGATIVE_LABELS = ['cancel', 'deny', 'decline', 'reject', 'not now', 'stop', 'close', 'dismiss'];
  const WARNING = 'Rel.AI MCP auto-approve can click ChatGPT app-request approvals for local repo actions. This may authorize reads, full-file writes, verification commands, browser checks, diffs, or resets without a manual click. Use only on your own trusted machine and turn it off when done.';
  let lastStatus = 'starting';
  let tickInFlight = false;
  let scheduled = false;
  let lastClickAt = 0;
  let approvalsSinceQuiet = 0;
  let doneTimer = null;
  let browserArmed = gmGet('enabled', false) === true || gmGet('armed', false) === true;
  const QUIET_DONE_MS = 12000;

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch (_) {}
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') return GM_setValue(key, value);
    } catch (_) {}
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch (_) {}
  }

  function getBaseUrl() {
    return String(gmGet('baseUrl', DEFAULT_BASE_URL || 'http://127.0.0.1:3333')).replace(/\/$/, '');
  }

  function getToken() {
    return String(gmGet('token', DEFAULT_TOKEN || ''));
  }

  function localEnabled() {
    const stored = gmGet('enabled', false) === true || gmGet('armed', false) === true;
    browserArmed = stored;
    return browserArmed;
  }

  function setLocalEnabled(enabled) {
    if (enabled && gmGet('warningAccepted', false) !== true) {
      const ok = window.confirm(WARNING + '\n\nEnable auto-approve in this browser?');
      if (!ok) return false;
      gmSet('warningAccepted', true);
    }
    browserArmed = Boolean(enabled);
    gmSet('enabled', Boolean(enabled));
    gmSet('armed', Boolean(enabled));
    updateFloatingStatus(enabled ? 'browser on' : 'browser off');
    return true;
  }

  function notify(message) {
    try {
      if (typeof GM_notification === 'function') return GM_notification({ title: 'Rel.AI MCP', text: message, timeout: 3500 });
    } catch (_) {}
    console.info('[Rel.AI MCP auto-approve]', message);
  }

  function log(message) {
    console.info('[Rel.AI MCP auto-approve]', message);
  }

  function wantsStatusPill() {
    return gmGet('showStatusPill', false) === true || gmGet('debug', false) === true;
  }

  function removeFloatingStatusIfHidden() {
    const el = document.getElementById('relai-auto-approve-status');
    if (el && !wantsStatusPill()) el.remove();
  }

  function scheduleDoneNotification() {
    if (doneTimer) window.clearTimeout(doneTimer);
    doneTimer = window.setTimeout(() => {
      doneTimer = null;
      if (!localEnabled()) return;
      const stillVisible = findApprovalButtons().concat(findBridgeActionButtonsSafe()).length > 0;
      if (stillVisible) {
        scheduleDoneNotification();
        return;
      }
      if (approvalsSinceQuiet > 0) {
        const count = approvalsSinceQuiet;
        approvalsSinceQuiet = 0;
        notify('Rel.AI MCP app requests are quiet. Auto-approved ' + count + ' request' + (count === 1 ? '' : 's') + ' in the last task.');
      }
    }, QUIET_DONE_MS);
  }

  function markAutoApproved(label) {
    approvalsSinceQuiet += 1;
    log('Auto-approved: ' + (label || 'app request'));
    scheduleDoneNotification();
  }

  function settingsUrl() {
    const token = getToken();
    const url = new URL(getBaseUrl() + '/api/auto-approve/settings');
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  function gmHttpGetJson(url, token) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        timeout: 5000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('settings request failed: HTTP ' + response.status));
            return;
          }
          try { resolve(JSON.parse(response.responseText || '{}')); }
          catch (err) { reject(err); }
        },
        onerror: () => reject(new Error('settings request failed')),
        ontimeout: () => reject(new Error('settings request timed out')),
      });
    });
  }

  async function fetchSettings() {
    const token = getToken();
    const url = settingsUrl();
    if (typeof GM_xmlhttpRequest === 'function') return gmHttpGetJson(url, token);
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) throw new Error('settings request failed: HTTP ' + res.status);
    return res.json();
  }

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function elementText(element) {
    if (!element) return '';
    const parts = [
      element.innerText,
      element.textContent,
      element.getAttribute && element.getAttribute('aria-label'),
      element.getAttribute && element.getAttribute('title'),
      element.getAttribute && element.getAttribute('value'),
      element.getAttribute && element.getAttribute('data-testid'),
    ];
    return compactText(parts.filter(Boolean).join(' '));
  }

  function isBridgeActionText(text) {
    const lower = compactText(text);
    return BRIDGE_ACTION_LABELS.some(label => lower === label || lower.includes(label));
  }

  function isRelAiApprovalSurfaceText(text) {
    const lower = compactText(text);
    if (!lower) return false;
    const hasRelAi = lower.includes('rel-ai-mcp') || lower.includes('rel.ai mcp') || lower.includes('relai mcp') || lower.includes('rel ai mcp');
    const hasRiskCopy = lower.includes('using tools comes with risks') || lower.includes('learn more');
    const hasFileWriteCopy = lower.includes('will overwrite the file') || lower.includes('workspace');
    const hasToolAction = isBridgeActionText(lower) || TOOL_NAMES.some(name => lower.includes(name.toLowerCase()));
    return hasRelAi && hasToolAction && (hasRiskCopy || hasFileWriteCopy || lower.includes('app request') || lower.includes('mcp'));
  }

  function requestTextMatches(text) {
    const lower = compactText(text);
    if (!lower) return false;
    const hasRelAi = lower.includes('rel-ai-mcp') || lower.includes('rel.ai mcp') || lower.includes('relai') || lower.includes('rel.ai') || lower.includes('rel ai');
    const hasTool = TOOL_NAMES.some(name => lower.includes(name.toLowerCase()));
    const hasBridgeAction = isBridgeActionText(lower);
    const hasRequestLanguage = [
      'app request', 'use this app', 'wants to', 'allow', 'approve', 'connector',
      'mcp', 'tool', 'running app request', 'run app request', 'app response',
      'write file', 'read file', 'read local repo paths', 'read paths', 'verify', 'diff', 'reset'
    ].some(term => lower.includes(term));
    return (hasRelAi && (hasRequestLanguage || hasBridgeAction)) ||
      (hasTool && (hasRequestLanguage || hasBridgeAction)) ||
      (hasBridgeAction && hasRequestLanguage);
  }

  function buttonLabelMatches(button) {
    const text = elementText(button);
    if (!text) return false;
    if (NEGATIVE_LABELS.some(label => text === label || text.includes(label))) return false;
    return POSITIVE_LABELS.some(label => text === label || text.includes(label));
  }

  function likelyAppRequestSurface(element) {
    if (!element) return false;
    const text = elementText(element);
    return isRelAiApprovalSurfaceText(text) || requestTextMatches(text);
  }

  function candidateButtons(root) {
    return Array.from((root || document).querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
  }

  function countButtons(element) {
    try { return candidateButtons(element).filter(visibleEnough).length; } catch (_) { return 99; }
  }

  function cardHasDenyAndAction(element) {
    const buttons = candidateButtons(element).filter(visibleEnough);
    const hasDeny = buttons.some((b) => {
      const label = clickableLabel(b);
      return label === 'deny' || label.includes('deny') || label === 'cancel';
    });
    const hasAction = buttons.some((b) => {
      if (b.disabled || b.ariaDisabled === 'true') return false;
      const label = clickableLabel(b);
      if (NEGATIVE_LABELS.some((negative) => label === negative || label.includes(negative))) return false;
      return POSITIVE_LABELS.some((positive) => label === positive || label.includes(positive));
    });
    return hasDeny && hasAction;
  }

  function isRelAiApprovalCard(element) {
    if (!element || !visibleEnough(element)) return false;
    const text = elementText(element);
    const lower = compactText(text);
    const hasRelAi = lower.includes('rel-ai-mcp') || lower.includes('rel.ai mcp') || lower.includes('relai mcp') || lower.includes('rel ai mcp');
    if (!hasRelAi) return false;
    const hasSpecificRequestCopy = lower.includes('will overwrite the file') ||
      lower.includes('workspace') ||
      lower.includes('edit ') ||
      lower.includes('write file') ||
      lower.includes('read file') ||
      lower.includes('read local repo paths') ||
      lower.includes('read paths') ||
      lower.includes('batch-read') ||
      lower.includes('verify') ||
      lower.includes('diff') ||
      lower.includes('reset');
    if (!hasSpecificRequestCopy) return false;
    const buttons = countButtons(element);
    if (buttons < 1 || buttons > 6) return false;
    return cardHasDenyAndAction(element);
  }

  function findApprovalCardForButton(button) {
    // Only approve buttons inside the small Rel.AI app-request card itself.
    // Do not keep climbing into the whole assistant message/conversation, since
    // that can contain unrelated ChatGPT controls such as "Edit message".
    let node = button;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      if (isRelAiApprovalCard(node)) return node;
      if (node !== button && node.getAttribute && node.getAttribute('data-message-author-role')) break;
      const role = String(node.getAttribute && node.getAttribute('role') || '').toLowerCase();
      if ((role === 'dialog' || role === 'alertdialog') && !isRelAiApprovalCard(node)) break;
      if (countButtons(node) > 8 && !isRelAiApprovalCard(node)) break;
    }
    return null;
  }

  function findApprovalButtons() {
    const buttons = candidateButtons();
    return buttons.filter((button) => {
      if (!button || button.disabled || button.ariaDisabled === 'true' || button.dataset.relaiAutoApproved === '1') return false;
      if (!visibleEnough(button)) return false;
      if (!buttonLabelMatches(button)) return false;
      return Boolean(findApprovalCardForButton(button));
    });
  }

  function findBridgeActionButtonsSafe() {
    // ChatGPT can label the app-request approval button with the tool action,
    // e.g. title="Edit File". Only click those labels when the button is inside
    // a Rel.AI MCP app-request card; never click standalone ChatGPT Edit buttons.
    return candidateButtons().filter((button) => {
      if (!button || button.disabled || button.ariaDisabled === 'true' || button.dataset.relaiAutoApproved === '1') return false;
      if (!visibleEnough(button)) return false;
      const text = clickableLabel(button);
      if (!isBridgeActionText(text)) return false;
      if (NEGATIVE_LABELS.some(label => text === label || text.includes(label))) return false;
      return Boolean(findApprovalCardForButton(button));
    });
  }

  function describeCandidates() {
    const labels = candidateButtons()
      .filter(visibleEnough)
      .map(clickableLabel)
      .filter(Boolean)
      .slice(0, 12);
    return labels.join(' | ');
  }

  function clickableLabel(button) {
    return elementText(button) || compactText(button && button.getAttribute && button.getAttribute('title'));
  }

  function visibleEnough(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickButton(button) {
    const now = Date.now();
    if (now - lastClickAt < 750) return false;
    lastClickAt = now;
    button.dataset.relaiAutoApproved = '1';
    try { button.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    try { button.focus({ preventScroll: true }); } catch (_) {}
    const eventInit = { bubbles: true, cancelable: true, view: window };
    // React/ChatGPT buttons are most reliable when events arrive in normal pointer order.
    for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try { button.dispatchEvent(new MouseEvent(type, eventInit)); } catch (_) {}
    }
    try { button.click(); } catch (_) {
      try { button.dispatchEvent(new MouseEvent('click', eventInit)); } catch (_) {}
    }
    return true;
  }

  async function tick() {
    if (tickInFlight) return;
    if (!localEnabled()) { updateFloatingStatus('browser off'); return; }
    tickInFlight = true;
    try {
      const settings = await fetchSettings();
      if (!settings || settings.enabled !== true || settings.warningAccepted !== true) {
        updateFloatingStatus('dashboard off');
        return;
      }
      let buttons = findApprovalButtons();
      if (buttons.length === 0) buttons = findBridgeActionButtonsSafe();
      if (buttons.length === 0) {
        updateFloatingStatus('watching' + (gmGet('debug', false) ? ' · seen: ' + describeCandidates() : ''));
        return;
      }
      updateFloatingStatus('clicking ' + clickableLabel(buttons[0]));
      if (clickButton(buttons[0])) {
        // Keep the browser-local toggle armed after a successful approval.
        // Some userscript managers can momentarily desync GM storage during page
        // mutations; never auto-disable unless the user explicitly disables it.
        if (browserArmed) {
          gmSet('enabled', true);
          gmSet('armed', true);
        }
        const label = clickableLabel(buttons[0]);
        updateFloatingStatus('approved ' + label);
        markAutoApproved(label);
      }
    } catch (err) {
      updateFloatingStatus('settings error');
      console.warn('[Rel.AI MCP auto-approve] Could not read dashboard settings:', err);
    } finally {
      tickInFlight = false;
    }
  }

  function scheduleTick(delay) {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      tick();
    }, delay == null ? 150 : delay);
  }

  function updateFloatingStatus(status) {
    lastStatus = status;
    if (!wantsStatusPill()) { removeFloatingStatusIfHidden(); return; }
    installFloatingToggle();
    const el = document.getElementById('relai-auto-approve-status');
    if (el) {
      el.textContent = 'Rel.AI auto-approve: ' + status;
      el.title = 'Click to toggle browser-local auto-approve. Dashboard setting must also be enabled. Server: ' + getBaseUrl();
    }
  }

  function installFloatingToggle() {
    removeFloatingStatusIfHidden();
    if (!wantsStatusPill()) return;
    if (document.getElementById('relai-auto-approve-status')) return;
    const el = document.createElement('button');
    el.id = 'relai-auto-approve-status';
    el.type = 'button';
    el.textContent = 'Rel.AI auto-approve: ' + lastStatus;
    el.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
      'font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif',
      'padding:8px 10px', 'border-radius:999px', 'border:1px solid rgba(120,120,120,.35)',
      'background:rgba(20,20,20,.86)', 'color:white', 'cursor:pointer',
      'box-shadow:0 6px 24px rgba(0,0,0,.25)'
    ].join(';');
    el.addEventListener('click', (event) => {
      const next = !localEnabled();
      if (setLocalEnabled(next)) log(next ? 'Auto-approve enabled locally. Dashboard setting must also be enabled.' : 'Auto-approve disabled locally.');
      scheduleTick(0);
    });
    document.documentElement.appendChild(el);
    updateFloatingStatus(localEnabled() ? 'browser on' : 'browser off');
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('Rel.AI: Toggle auto-approve in this browser', () => {
      const next = !localEnabled();
      if (setLocalEnabled(next)) log(next ? 'Auto-approve enabled locally. Dashboard setting must also be enabled.' : 'Auto-approve disabled locally.');
      scheduleTick(0);
    });
    GM_registerMenuCommand('Rel.AI: Enable auto-approve in this browser', () => {
      if (setLocalEnabled(true)) log('Auto-approve enabled locally. Dashboard setting must also be enabled.');
      scheduleTick(0);
    });
    GM_registerMenuCommand('Rel.AI: Disable auto-approve in this browser', () => {
      setLocalEnabled(false);
      log('Auto-approve disabled locally.');
      scheduleTick(0);
    });
    GM_registerMenuCommand('Rel.AI: Configure local server/token', () => {
      const base = window.prompt('Rel.AI MCP dashboard base URL', getBaseUrl());
      if (base) gmSet('baseUrl', base.replace(/\/$/, ''));
      const token = window.prompt('Dashboard token. Leave blank only if local dashboard auth is disabled.', getToken());
      if (token != null) gmSet('token', token.trim());
      log('Rel.AI MCP userscript configuration saved.');
      scheduleTick(0);
    });
    GM_registerMenuCommand('Rel.AI: Toggle debug labels', () => {
      gmSet('debug', !gmGet('debug', false));
      log('Debug labels ' + (gmGet('debug', false) ? 'enabled' : 'disabled') + '.');
      scheduleTick(0);
    });
    GM_registerMenuCommand('Rel.AI: Toggle status pill', () => {
      gmSet('showStatusPill', !gmGet('showStatusPill', false));
      if (wantsStatusPill()) installFloatingToggle();
      else removeFloatingStatusIfHidden();
      log('Status pill ' + (gmGet('showStatusPill', false) ? 'shown' : 'hidden') + '.');
      scheduleTick(0);
    });
    GM_registerMenuCommand('Rel.AI: Click matching button now', () => {
      const buttons = findApprovalButtons().concat(findBridgeActionButtonsSafe());
      if (!buttons.length) {
        log('No matching Rel.AI approval button found. Visible buttons: ' + describeCandidates());
        updateFloatingStatus('no match');
        return;
      }
      const label = clickableLabel(buttons[0]);
      updateFloatingStatus('manual click ' + label);
      if (clickButton(buttons[0])) {
        if (browserArmed) {
          gmSet('enabled', true);
          gmSet('armed', true);
        }
        markAutoApproved(label);
      }
    });
  }

  function startObserver() {
    const observer = new MutationObserver(() => scheduleTick(100));
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  registerMenu();
  installFloatingToggle();
  startObserver();
  window.setInterval(() => scheduleTick(0), Math.max(500, Number(gmGet('pollMs', 1200)) || 1200));
  scheduleTick(250);
})();
`;
}

module.exports = { autoApproveSettings, renderUserscript };
