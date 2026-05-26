(() => {
  if (window.__relaiMcpExtensionContentLoaded) return;
  window.__relaiMcpExtensionContentLoaded = true;

  // Keep this list broad enough to cover ChatGPT's generated approval labels for
  // every Rel.AI bridge tool. The actual safety boundary is the Rel.AI approval
  // card detector below; inside a verified card we click the primary non-negative
  // action even if ChatGPT changes the exact label.
  const ACTION_LABELS = [
    // relai_repo_snapshot
    'repo snapshot', 'repository snapshot', 'snapshot repository', 'local repository snapshot',
    'take repository snapshot', 'take repo snapshot', 'snapshot local repo', 'snapshot workspace',

    // relai_read
    'read', 'read file', 'read files', 'read path', 'read paths', 'read directory', 'read directories',
    'read local repo', 'read local repo path', 'read local repo paths', 'read repository',
    'read repository path', 'read repository paths', 'read workspace', 'read workspace paths',
    'batch-read files', 'batch read files', 'batch-read local repo paths', 'read local repository paths',

    // relai_write
    'write', 'write file', 'write files', 'write local repo file', 'write local repo files',
    'edit file', 'edit files', 'update file', 'update files', 'overwrite file', 'overwrite files',
    'save file', 'save files', 'stage write', 'append write', 'commit write',

    // relai_replace
    'replace exact text', 'exact replace', 'replace text', 'apply exact replacement',
    'replace in file', 'localized edit', 'targeted edit', 'remove duplicate import',

    // relai_clear_files
    'clear file', 'clear files', 'clear local repo file', 'clear local repo files',
    'remove file', 'remove files', 'remove obsolete file', 'remove obsolete files',

    // relai_run_checks
    'verify', 'verify local repo', 'verify workspace', 'run verification', 'run verify',
    'run checks', 'run tests', 'run command', 'run commands', 'execute verification',

    // relai_browser
    'browser', 'browser check', 'run browser check', 'open browser', 'check browser',
    'ui check', 'run ui check', 'validate ui',

    // relai_diff
    'diff', 'review diff', 'review local repo diff', 'inspect diff', 'inspect local repo diff',
    'show diff', 'get diff', 'load diff', 'view diff',

    // relai_restore_changes
    'reset', 'reset repo', 'reset repository', 'reset workspace', 'reset local repo',
    'reset local repo changes', 'rollback changes', 'discard changes', 'restore files',
    'reset files', 'reset path', 'reset paths',

    // ChatGPT generic approval button labels
    'approve', 'allow', 'allow once', 'confirm', 'yes', 'ok', 'proceed', 'continue'
  ];
  const NEGATIVE = ['cancel', 'deny', 'decline', 'reject', 'not now', 'stop', 'close', 'dismiss'];
  let lastClickAt = 0;

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message && message.type === 'relai-auto-approve-scan') {
          const count = safeScanAndApprove('message');
          safeSendResponse(sendResponse, { ok: true, count });
          return true;
        }
        if (message && message.type === 'relai-heartbeat') {
          try {
            document.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true, cancelable: true, clientX: 1, clientY: 1
            }));
          } catch (_) {}
          safeSendResponse(sendResponse, { ok: true });
          return true;
        }
        return false;
      });
    }
  } catch (error) {
    reportContentError('message listener', error);
  }

  const SCAN_DEBOUNCE_MS = 900;
  const observer = new MutationObserver((mutations) => {
    try {
      if (mutations.some(isRelevantMutation)) scheduleScan('mutation');
    } catch (error) {
      reportContentError('mutation observer', error);
    }
  });
  try {
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'disabled', 'data-testid', 'class'] });
    }
  } catch (error) {
    reportContentError('observer setup', error);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleScan('visible');
  });
  window.addEventListener('focus', () => scheduleScan('focus'));
  window.addEventListener('pageshow', () => scheduleScan('pageshow'));

  let scheduledTimer = 0;
  scheduleScan('startup');

  // Polling fallback for foreground — catches cards that appear without DOM mutations.
  // Background tabs rely on alarm-driven scans from background.js (timers are throttled there).
  setInterval(() => {
    if (!document.hidden) safeScanAndApprove('poll');
  }, 2000);

  function scheduleScan(reason) {
    try {
      if (scheduledTimer) clearTimeout(scheduledTimer);
      scheduledTimer = setTimeout(() => {
        scheduledTimer = 0;
        runWhenIdle(() => safeScanAndApprove(reason || 'timer'));
      }, SCAN_DEBOUNCE_MS);
    } catch (error) {
      reportContentError('schedule scan', error);
    }
  }

  function runWhenIdle(fn) {
    const runner = () => {
      try { fn(); } catch (error) { reportContentError('idle scan', error); }
    };
    // requestIdleCallback is deferred indefinitely in background tabs — skip it when hidden
    if (!document.hidden && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runner, { timeout: 1200 });
      return;
    }
    setTimeout(runner, 0);
  }



  function safeScanAndApprove(reason) {
    try {
      return scanAndApprove();
    } catch (error) {
      reportContentError(`scan ${reason || ''}`.trim(), error);
      return 0;
    }
  }

  function safeSendResponse(sendResponse, payload) {
    try { sendResponse(payload); } catch (error) { reportContentError('message response', error); }
  }

  function safeSendRuntimeMessage(payload) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id || !chrome.runtime.sendMessage) return;
      const result = chrome.runtime.sendMessage(payload);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_error) {
      // Extension context can be invalidated while ChatGPT is already open.
    }
  }

  function reportContentError(scope, error) {
    try {
      const message = error && error.message ? error.message : String(error || 'unknown error');
      console.debug(`[rel-ai-mcp] content script ${scope || 'scan'} skipped: ${message}`);
    } catch (_error) {}
  }

  function isRelevantMutation(mutation) {
    if (mutation.type === 'attributes') {
      const target = mutation.target;
      return target instanceof HTMLElement && (target.matches('button, [role="button"]') || target.closest('button, [role="button"]'));
    }
    for (const node of mutation.addedNodes || []) {
      if (isPotentialApprovalNode(node)) return true;
    }
    return false;
  }

  function isPotentialApprovalNode(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches('button, [role="button"]')) return true;
    const text = compact(node.innerText || node.textContent || '');
    if (text.includes('rel-ai-mcp') || text.includes('using tools comes with risks')) return true;
    return Boolean(node.querySelector && node.querySelector('button, [role="button"]'));
  }

  function scanAndApprove() {
    const now = Date.now();
    if (now - lastClickAt < 450) return 0;
    const cards = findApprovalCards();
    let clicked = 0;
    for (const card of cards) {
      const button = findApprovalButton(card);
      if (!button) continue;
      lastClickAt = Date.now();
      trustedClick(button);
      clicked += 1;
      break;
    }
    if (clicked) safeSendRuntimeMessage({ type: 'relai-approved', count: clicked });
    return clicked;
  }

  function findApprovalCards() {
    const candidates = Array.from(document.querySelectorAll('div, section, article'));
    return candidates.filter(isApprovalCard).slice(0, 3);
  }

  function isApprovalCard(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (!isVisible(node)) return false;
    const visibleButtons = buttonElements(node).filter(isVisible);
    if (visibleButtons.length < 2 || visibleButtons.length > 8) return false;

    const text = compact(node.innerText || node.textContent || '');
    if (!text.includes('rel-ai-mcp')) return false;
    if (!visibleButtons.some(isNegativeButton)) return false;
    if (!visibleButtons.some(isActionButton)) return false;

    // Avoid accidentally treating an entire assistant turn or conversation column as
    // the approval card. Real approval cards are compact and have only the request UI.
    if (text.length > 2500) return false;
    if ((node.querySelectorAll('[data-message-author-role]').length || 0) > 0) return false;
    return true;
  }

  function findApprovalButton(card) {
    const buttons = buttonElements(card).filter((button) => {
      if (!isVisible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      return !isNegativeButton(button);
    });

    // Prefer explicit known Rel.AI action labels.
    const exact = buttons.find((button) => ACTION_LABELS.includes(labelFor(button)));
    if (exact) return exact;

    // ChatGPT may render the primary approval button using a new verb such as
    // "Reset Workspace". Once the card is already verified as Rel.AI's approval
    // surface, the safest future-proof fallback is the primary non-negative button.
    return buttons.find(isPrimaryButton) || null;
  }

  function isActionButton(button) {
    const label = labelFor(button);
    if (NEGATIVE.includes(label)) return false;
    if (ACTION_LABELS.includes(label)) return true;
    return isPrimaryButton(button);
  }

  function isNegativeButton(button) {
    const label = labelFor(button);
    return NEGATIVE.includes(label) || NEGATIVE.some((negative) => label === negative || label.startsWith(`${negative} `));
  }

  function isPrimaryButton(button) {
    const cls = String(button.className || '').toLowerCase();
    const label = labelFor(button);
    if (!label || isNegativeButton(button)) return false;
    if (cls.includes('btn-primary') || cls.includes('primary')) return true;
    if (button.getAttribute('data-color') === 'primary') return true;
    if (button.getAttribute('data-variant') === 'solid' && button.getAttribute('data-color') !== 'secondary') return true;
    if (button.getAttribute('data-testid') && String(button.getAttribute('data-testid')).toLowerCase().includes('confirm')) return true;
    return false;
  }

  function buttonElements(root) {
    return Array.from(root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
  }

  function labelFor(el) {
    return compact(el.getAttribute('title') || el.getAttribute('aria-label') || el.value || el.innerText || el.textContent || '');
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    // getBoundingClientRect returns zero dimensions in background tabs — skip it when hidden
    if (document.hidden) return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function trustedClick(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    try { el.click(); } catch (_) {}
  }
})();
