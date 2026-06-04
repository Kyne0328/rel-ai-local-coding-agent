// MAIN-world keep-alive: makes ChatGPT believe the tab is foreground so its own
// visibilitychange/hidden logic does not pause work when the tab is backgrounded.
//
// Runs in the page's JS realm (world: "MAIN") because the page reads its OWN
// document.visibilityState — an isolated content script overriding it would not be
// seen by the page. Gated by a postMessage toggle from the isolated content script,
// so it only spoofs while the extension is enabled.
//
// Scope note: this defeats the page's *own* pause-on-hidden. Native timer/rAF
// throttling is enforced in the browser's C++ layer keyed on real visibility and is
// NOT affected by these getters — the audio keep-alive (isolated world) covers
// throttle/freeze, and the "Always keep this site active" browser setting is the
// guaranteed backstop.
(() => {
  if (window.__relaiKeepAliveInstalled) return;
  window.__relaiKeepAliveInstalled = true;

  let active = false;

  function spoofGetter(prop, spoofValue) {
    // Find the real accessor anywhere on the prototype chain.
    let desc = Object.getOwnPropertyDescriptor(document, prop);
    let obj = Object.getPrototypeOf(document);
    while (!desc && obj) {
      desc = Object.getOwnPropertyDescriptor(obj, prop);
      obj = Object.getPrototypeOf(obj);
    }
    const realGet = desc && desc.get ? desc.get.bind(document) : () => (desc ? desc.value : undefined);
    try {
      Object.defineProperty(document, prop, {
        configurable: true,
        get() { return active ? spoofValue : realGet(); }
      });
    } catch (_) { /* property not redefinable in this browser */ }
  }

  spoofGetter('hidden', false);
  spoofGetter('visibilityState', 'visible');
  spoofGetter('webkitHidden', false);
  spoofGetter('webkitVisibilityState', 'visible');

  const realHasFocus = document.hasFocus ? document.hasFocus.bind(document) : null;
  if (realHasFocus) {
    document.hasFocus = function () { return active ? true : realHasFocus(); };
  }

  // Stop the page's own handlers from running on these events while active.
  const swallow = (event) => { if (active) event.stopImmediatePropagation(); };
  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'freeze']) {
    window.addEventListener(type, swallow, true);
    document.addEventListener(type, swallow, true);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === 'relai-keepalive-control' && typeof data.active === 'boolean') {
      active = data.active;
    }
  });
})();
