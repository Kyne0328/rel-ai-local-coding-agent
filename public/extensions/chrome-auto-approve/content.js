(() => {
  if (window.__relaiMcpExtensionContentLoaded) return;
  window.__relaiMcpExtensionContentLoaded = true;

  const ACTION_LABELS = [
    'repo snapshot', 'repository snapshot', 'snapshot repository',
    'read', 'read file', 'read files', 'read local repo paths', 'read local repo', 'read paths', 'read repository paths', 'read directory', 'read directories', 'batch-read files',
    'write', 'write file', 'write files', 'edit file', 'edit files', 'update file', 'overwrite file',
    'verify', 'run verification', 'browser', 'browser check',
    'diff', 'inspect diff', 'reset', 'reset repo', 'reset repository'
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
    if (countButtons(node) < 2 || countButtons(node) > 8) return false;
    const text = compact(node.innerText || node.textContent || '');
    if (!text.includes('rel-ai-mcp')) return false;
    if (!text.includes('using tools comes with risks') && !text.includes('workspace') && !text.includes('will overwrite') && !text.includes('local repo')) return false;
    const buttons = buttonElements(node);
    if (!buttons.some((button) => NEGATIVE.includes(labelFor(button)))) return false;
    if (!buttons.some((button) => ACTION_LABELS.includes(labelFor(button)))) return false;
    return true;
  }

  function findApprovalButton(card) {
    return buttonElements(card).find((button) => {
      if (!isVisible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      const label = labelFor(button);
      if (NEGATIVE.includes(label)) return false;
      return ACTION_LABELS.includes(label);
    }) || null;
  }

  function buttonElements(root) {
    return Array.from(root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
  }

  function countButtons(root) {
    return buttonElements(root).filter(isVisible).length;
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
