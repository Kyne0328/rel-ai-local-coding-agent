(() => {
  if (window.__relaiMcpExtensionContentLoaded) return;
  window.__relaiMcpExtensionContentLoaded = true;

  // Keep this list broad enough to cover ChatGPT's generated approval labels for
  // every Rel.AI bridge tool. The actual safety boundary is the Rel.AI approval
  // card detector below; inside a verified card we click the primary non-negative
  // action even if ChatGPT changes the exact label.
  const ACTION_LABELS = [
    // relai_repo_snapshot
    'repo snapshot', 'repository snapshot', 'repository overview', 'snapshot repository', 'local repository snapshot',
    'take repository snapshot', 'take repo snapshot', 'snapshot local repo', 'snapshot workspace',

    // relai_git_* (neutralized titles)
    'repository state', 'update remote refs', 'record commit', 'publish branch',
    'combine branches', 'branch merge plan', 'cancel in-progress merge', 'draft pull request',

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
    'discard workspace files', 'discard workspace file',
    'remove file', 'remove files', 'remove obsolete file', 'remove obsolete files',
    'retire obsolete file', 'retire file',

    // relai_run_checks (title: "Workspace Checks")
    'workspace checks', 'verify', 'verify local repo', 'verify workspace', 'run verification', 'run verify',
    'run checks', 'run tests', 'run command', 'run commands', 'execute verification',

    // relai_browser (title: "UI Route Check")
    'ui route check', 'route check', 'browser', 'browser check', 'run browser check', 'open browser', 'check browser',
    'ui check', 'run ui check', 'validate ui',

    // relai_diff
    'diff', 'review diff', 'review local repo diff', 'inspect diff', 'inspect local repo diff',
    'show diff', 'get diff', 'load diff', 'view diff',

    // relai_restore_changes
    'reset', 'reset repo', 'reset repository', 'reset workspace', 'reset local repo',
    'reset local repo changes', 'rollback changes', 'discard changes', 'restore files',
    'reset files', 'reset path', 'reset paths', 'revert to saved state', 'revert changes',

    // ChatGPT generic approval button labels
    'approve', 'allow', 'allow once', 'confirm', 'yes', 'ok', 'proceed', 'continue'
  ];
  const NEGATIVE = ['cancel', 'deny', 'decline', 'reject', 'not now', 'stop', 'close', 'dismiss'];
  let lastClickAt = 0;

  // Idle gate: the expensive full-DOM card scan only runs while an approval card
  // is actually likely to be present. The observer flips cardLikely on when it
  // sees the Rel.AI card hallmark text; consecutive empty scans flip it back off.
  // This keeps the 2s poll free in the common case (no card on screen).
  let cardLikely = false;
  let missStreak = 0;
  const MAX_MISS = 3;

  // Buttons already clicked, tracked by element identity (cheap exact-node guard).
  const clickedButtons = new WeakSet();

  // Primary dedupe: by request SIGNATURE (normalized approval-card text) within a
  // time window. ChatGPT re-renders the approval card while it works, producing a
  // fresh button node each time — node identity alone (WeakSet) does not survive
  // that, so the 2s poll re-clicked the new node and submitted the SAME approval
  // twice (the duplicate-tool-call bug seen in the Activity log). The signature is
  // stable across re-renders, so we approve a given request exactly once; the
  // window is refreshed while the card persists and a genuinely different request
  // (different text) is unaffected.
  const recentApprovals = new Map(); // signature -> last-seen timestamp
  const APPROVE_DEDUP_MS = 5000;
  // Guards against overlapping async scans (poll + message + mutation can fire close
  // together; the claim round-trip is async, so without this two scans could both
  // pass the local dedup before either records its signature).
  let scanInFlight = false;

  function approvalSignature(card) {
    // Whole-card text (tool name + args) identifies the request; cap length so a
    // long payload doesn't bloat the key. Stable across React re-renders.
    return compact(card.textContent || '').slice(0, 400);
  }

  // Cross-tab arbitration: ask the background service worker (the one shared arbiter)
  // to claim this request signature before clicking, so two ChatGPT tabs cannot both
  // approve the same request. Fail-open — if the worker is unreachable, approve anyway
  // so a single tab keeps working; the cross-tab guard only matters when tabs race.
  async function claimApproval(signature) {
    if (!signature) return true;
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id || !chrome.runtime.sendMessage) return true;
      const res = await chrome.runtime.sendMessage({ type: 'relai-claim-approval', signature });
      return !res || res.granted !== false;
    } catch (_) {
      return true;
    }
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message && message.type === 'relai-auto-approve-scan') {
          // Background tabs reach us via this alarm-driven message even when timers
          // are throttled. Opportunistically nudge the keep-alive audio back to
          // running (a prior user gesture may have unlocked autoplay by now), so the
          // tab regains "audible" exemption and the fast poll can resume.
          try { _resumeAudio(); } catch (_) {}
          // scan is async (cross-tab claim round-trip); reply once it resolves.
          safeScanAndApprove('message').then((count) => safeSendResponse(sendResponse, { ok: true, count }));
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
      let relevant = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes || []) {
            if (nodeLooksLikeCard(node)) { cardLikely = true; relevant = true; }
            else if (isPotentialApprovalNode(node)) relevant = true;
          }
        } else if (isRelevantMutation(mutation)) {
          relevant = true;
        }
      }
      // Only schedule the costly scan when a card is actually plausible. A bare
      // button/attribute mutation with no known card present is ignored.
      if (relevant && cardLikely) scheduleScan('mutation');
    } catch (error) {
      reportContentError('mutation observer', error);
    }
  });
  try {
    if (document.documentElement) {
      // 'class' churns on every hover/animation/streamed token, so it is left out;
      // approval cards arrive as childList insertions, and their buttons enable via
      // 'disabled'/'aria-label'.
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'disabled'] });
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

  // Polling fallback — catches cards whose buttons enable without a tracked mutation.
  // Gated by cardLikely so it stays free when no card is present.
  //
  // The poll also runs in a HIDDEN tab while keep-alive is active: the silent-audio
  // keep-alive marks the tab "audible", which exempts it from Chrome's background
  // timer throttling, so this interval still fires ~every 2s. Without this, a
  // backgrounded working tab fell back to the 30s background alarm only — approvals
  // lagged up to 30s and felt stalled. When keep-alive is off (or audio is suspended)
  // a hidden tab's timers are throttled anyway, so the alarm remains the safety net.
  setInterval(() => {
    if ((!document.hidden || keepAliveActive) && cardLikely) safeScanAndApprove('poll');
  }, 2000);

  // --- Background keep-alive (only while the extension is enabled) ---
  // #2 audio: a near-inaudible 19 kHz tone marks the tab "audible" so Chrome exempts
  //   it from background timer/rAF throttling and from tab discard/freeze.
  // #3 spoof: tell the MAIN-world keepalive.js to report the tab as visible so
  //   ChatGPT does not pause its own work on visibilitychange.
  let _audioCtx = null;
  let _gestureResumeBound = false;
  // True while the extension is enabled (keep-alive armed). Lets the 2s poll run in a
  // hidden-but-audible tab — see the setInterval above.
  let keepAliveActive = false;

  function _resumeAudio() {
    if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
  }

  function startKeepAliveAudio() {
    if (_audioCtx) { _resumeAudio(); return; }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      _audioCtx = new Ctx();
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 19000;   // above most adults' hearing range
      gain.gain.value = 0.001;       // ~-60 dB: registers as audible yet effectively silent
      osc.connect(gain).connect(_audioCtx.destination);
      osc.start();
      _resumeAudio();
      // Autoplay policy can start the context suspended; resume on the next user
      // gesture in the page (the user is interacting with ChatGPT anyway).
      if (!_gestureResumeBound) {
        _gestureResumeBound = true;
        window.addEventListener('pointerdown', _resumeAudio, { passive: true });
        window.addEventListener('keydown', _resumeAudio, { passive: true });
      }
    } catch (_) { _audioCtx = null; }
  }

  function stopKeepAliveAudio() {
    try { if (_audioCtx) _audioCtx.close(); } catch (_) {}
    _audioCtx = null;
  }

  function setSpoof(on) {
    try { window.postMessage({ source: 'relai-keepalive-control', active: !!on }, '*'); } catch (_) {}
  }

  function refreshKeepAlive() {
    try {
      chrome.storage.local.get({ enabled: false }, (cfg) => {
        keepAliveActive = !!(cfg && cfg.enabled);
        if (keepAliveActive) { startKeepAliveAudio(); setSpoof(true); }
        else { stopKeepAliveAudio(); setSpoof(false); }
      });
    } catch (_) {}
  }

  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.enabled) refreshKeepAlive();
      });
    }
  } catch (_) {}
  refreshKeepAlive();

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



  async function safeScanAndApprove(reason) {
    try {
      return await scanAndApprove();
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
    // textContent (not innerText) avoids forcing a layout reflow on every node
    // inserted during token streaming.
    const text = compact(node.textContent || '');
    if (text.includes('rel-ai-mcp') || text.includes('using tools comes with risks')) return true;
    return Boolean(node.querySelector && node.querySelector('button, [role="button"]'));
  }

  // Cheap, reflow-free check used to arm the scan gate: does this inserted node (or
  // its subtree) carry the Rel.AI approval-card hallmark text?
  function nodeLooksLikeCard(node) {
    if (!(node instanceof HTMLElement)) return false;
    const text = compact(node.textContent || '');
    return text.includes('rel-ai-mcp') || text.includes('using tools comes with risks');
  }

  async function scanAndApprove() {
    if (scanInFlight) return 0;
    const now = Date.now();
    if (now - lastClickAt < 450) return 0;
    const cards = findApprovalCards();
    if (cards.length === 0) {
      // No card found; after a few empty scans, disarm the gate so the poll idles.
      if (++missStreak >= MAX_MISS) cardLikely = false;
      return 0;
    }
    // A card is present (this scan may be the background-alarm safety net catching
    // one the observer missed) — keep the gate armed until it is gone.
    missStreak = 0;
    cardLikely = true;
    // Drop signatures whose window has lapsed (request is long gone).
    for (const [sig, ts] of recentApprovals) {
      if (now - ts > APPROVE_DEDUP_MS) recentApprovals.delete(sig);
    }
    scanInFlight = true;
    try {
      let clicked = 0;
      for (const card of cards) {
        const button = findApprovalButton(card);
        if (!button || clickedButtons.has(button)) continue;
        const signature = approvalSignature(card);
        if (signature && recentApprovals.has(signature)) {
          // Same request still on screen (likely a re-render) — refresh its window so
          // we keep skipping it until it is gone, and do not approve it again.
          recentApprovals.set(signature, now);
          continue;
        }
        // Cross-tab claim before any local mutation: lose the claim => another tab
        // owns this request, so skip it here (record locally so we stop retrying it).
        const granted = await claimApproval(signature);
        if (!granted) {
          if (signature) recentApprovals.set(signature, now);
          continue;
        }
        if (signature) recentApprovals.set(signature, now);
        clickedButtons.add(button);
        lastClickAt = Date.now();
        trustedClick(button);
        clicked += 1;
        break;
      }
      if (clicked) safeSendRuntimeMessage({ type: 'relai-approved', count: clicked });
      return clicked;
    } finally {
      scanInFlight = false;
    }
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
    // Only the PRESS half of the pointer/mouse sequence is dispatched — it primes
    // frameworks that key off pointerdown (focus/:active) WITHOUT activating the
    // button. The single native el.click() is then the one and only activation.
    // We must NOT dispatch pointerup/mouseup here: a button that activates on
    // pointer-up (common in React) would fire on the synthetic up AND again on
    // el.click(), submitting the same approval twice (the duplicate-tool-call bug).
    for (const type of ['pointerdown', 'mousedown']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    try { el.click(); } catch (_) {}
  }
})();
