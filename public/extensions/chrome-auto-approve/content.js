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

    // relai_verify
    'verify', 'verify local repo', 'verify workspace', 'run verification', 'run verify',
    'run checks', 'run tests', 'run command', 'run commands', 'execute verification',

    // relai_browser
    'browser', 'browser check', 'run browser check', 'open browser', 'check browser',
    'ui check', 'run ui check', 'validate ui',

    // relai_diff
    'diff', 'review diff', 'review local repo diff', 'inspect diff', 'inspect local repo diff',
    'show diff', 'get diff', 'load diff', 'view diff',

    // relai_reset
    'reset', 'reset repo', 'reset repository', 'reset workspace', 'reset local repo',
    'reset local repo changes', 'rollback changes', 'discard changes', 'restore files',
    'reset files', 'reset path', 'reset paths'
  ];
  const NEGATIVE = ['cancel', 'deny', 'decline', 'reject', 'not now', 'stop', 'close', 'dismiss'];
  let lastClickAt = 0;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'relai-auto-approve-scan') {
      const count = scanAndApprove();
      sendResponse({ ok: true, count });
      return true;
    }
    return false;
  });

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scanAndApprove, 1500);

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scanAndApprove();
    }, 150);
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
    if (clicked) chrome.runtime.sendMessage({ type: 'relai-approved', count: clicked }).catch(() => {});
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
    if (!text.includes('using tools comes with risks') && !text.includes('workspace') && !text.includes('will overwrite') && !text.includes('local repo')) return false;
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
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) !== 0;
  }

  function trustedClick(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    try { el.click(); } catch (_) {}
  }
})();
