import { normalizeReasoningLevel } from './contracts.js';

const LOGIN_TEXT = /log in|sign in|sign up/i;
const PICKER_TEXT = /^(?:instant|medium|high|extra high|pro|pro standard|pro extended)$/i;
const PERSISTENT_PERMISSION_TEXT = /always.*allow|allow.*always|never ask/i;
const REASONING_LABELS = Object.freeze({
  instant: Object.freeze(['Instant']),
  medium: Object.freeze(['Medium']),
  high: Object.freeze(['High']),
  extra_high: Object.freeze(['Extra High']),
  pro: Object.freeze(['Pro', 'Pro Extended', 'Pro Standard'])
});

class ChatGptPageAdapter {
  async isAuthenticated(page) {
    const login = await findLoginControl(page);
    if (login) return false;
    const composer = await findComposer(page);
    if (composer) return true;
    if (!await waitForComposer(page, 5_000)) return false;
    return !(await findLoginControl(page));
  }

  async prepareSession(page, options = {}) {
    if (options.temporary !== true) {
      throw adapterError('CHATGPT_TEMPORARY_MODE_REQUIRED', 'Delegated ChatGPT sessions must use Temporary Chat.');
    }
    await this.enableTemporaryChat(page);
    const reasoning = normalizeReasoningLevel(options.reasoning || 'medium');
    await this.selectReasoning(page, reasoning);
    return { temporary: true, reasoning };
  }

  async enableTemporaryChat(page) {
    if (await this.isTemporaryChat(page)) return true;

    const direct = await firstVisible([
      role(page, 'switch', /temporary chat/i),
      role(page, 'checkbox', /temporary chat/i),
      role(page, 'button', /^temporary chat$/i)
    ]);
    if (direct) {
      await direct.click();
      if (await waitForTemporaryChat(this, page)) return true;
    }

    const picker = await findPicker(page);
    if (picker) {
      await picker.click();
      await shortWait(page);
      const item = await firstVisible([
        role(page, 'menuitem', /temporary chat/i),
        role(page, 'option', /temporary chat/i),
        role(page, 'switch', /temporary chat/i),
        role(page, 'checkbox', /temporary chat/i),
        text(page, /^temporary chat$/i)
      ]);
      if (item) await item.click();
      if (await waitForTemporaryChat(this, page)) return true;
    }

    throw adapterError(
      'CHATGPT_TEMPORARY_MODE_REQUIRED',
      'Could not verify Temporary Chat. Rel.AI will not send the delegated prompt in a persistent chat.'
    );
  }

  async isTemporaryChat(page) {
    const controls = [
      role(page, 'switch', /temporary chat/i),
      role(page, 'checkbox', /temporary chat/i),
      role(page, 'button', /^temporary chat$/i)
    ];
    for (const control of controls) {
      const isVisible = await visible(control);
      if (!isVisible) continue;
      if (await activeControl(control)) return true;
    }
    return Boolean(await firstVisible([
      text(page, /won't appear in (?:your )?history/i),
      text(page, /not saved to history/i),
      text(page, /memory is disabled/i),
      locator(page, '[data-testid*="temporary" i][data-state="active"], [data-testid*="temporary" i][data-state="on"]')
    ]));
  }

  async listReasoningLevels(page) {
    const picker = await findPicker(page);
    if (!picker) return [];
    await picker.click();
    await shortWait(page);
    const levels = [];
    for (const level of Object.keys(REASONING_LABELS)) {
      if (await findReasoningOption(page, level)) levels.push(level);
    }
    await dismissMenu(page);
    return levels;
  }

  async selectReasoning(page, value) {
    const reasoning = normalizeReasoningLevel(value);
    const picker = await findPicker(page);
    if (!picker) {
      throw adapterError('CHATGPT_REASONING_PICKER_UNAVAILABLE', 'Could not find the ChatGPT reasoning picker.');
    }
    const current = reasoningFromText(await locatorLabel(picker));
    if (current === reasoning) return reasoning;

    await picker.click();
    await shortWait(page);
    const option = await findReasoningOption(page, reasoning);
    if (!option) {
      await dismissMenu(page);
      throw adapterError('CHATGPT_REASONING_UNAVAILABLE', `ChatGPT does not expose the requested ${reasoningDisplayName(reasoning)} option for this account.`);
    }
    await option.click();
    await shortWait(page);
    const refreshedPicker = await findPicker(page);
    const actual = refreshedPicker ? reasoningFromText(await locatorLabel(refreshedPicker)) : '';
    if (actual !== reasoning) {
      throw adapterError('CHATGPT_REASONING_SELECTION_FAILED', `Could not verify that ChatGPT switched to ${reasoningDisplayName(reasoning)}.`);
    }
    return reasoning;
  }

  async submitPrompt(page, prompt) {
    const value = String(prompt || '').trim();
    if (!value) throw adapterError('CHATGPT_PROMPT_REQUIRED', 'Delegated ChatGPT prompt is empty.');
    const composer = await findComposer(page);
    if (!composer) throw adapterError('CHATGPT_COMPOSER_UNAVAILABLE', 'Could not find the authenticated ChatGPT message composer.');
    await composer.fill(value);
    const send = await firstVisible([
      role(page, 'button', /^send(?: message)?$/i),
      locator(page, '[data-testid="send-button"]')
    ]);
    if (send) await send.click();
    else await composer.press('Enter');
    return { submitted: true };
  }

  async approveAppPermission(page) {
    const deny = await firstVisible([
      role(page, 'button', /^deny$/i),
      locator(page, 'button:has-text("Deny")')
    ]);
    if (!deny) return { approved: false, reason: 'not_present' };
    const card = scopedLocator(deny, 'xpath=ancestor::*[.//button[normalize-space()="Allow"]][1]');
    if (!await visible(card)) return { approved: false, reason: 'approval_card_unavailable' };

    const allow = await firstVisible([
      scopedRole(card, 'button', /^allow$/i),
      scopedLocator(card, 'button:has-text("Allow")')
    ]);
    if (!allow) return { approved: false, reason: 'allow_unavailable' };

    const dropdown = await firstVisible([
      scopedLocator(card, 'button:has-text("Allow") + button'),
      scopedLocator(card, 'button:has-text("Allow") ~ button[aria-haspopup="menu"]'),
      scopedRole(card, 'button', /allow.*(?:options|more)|(?:options|more).*allow/i),
      scopedLocator(card, 'button[aria-label*="allow" i][aria-haspopup="menu"]'),
      scopedLocator(card, 'button[aria-haspopup="menu"]')
    ]);

    if (dropdown) {
      await dropdown.click();
      const persistent = await waitForFirstVisible(page, [
        role(page, 'menuitem', PERSISTENT_PERMISSION_TEXT),
        role(page, 'option', PERSISTENT_PERMISSION_TEXT),
        role(page, 'button', PERSISTENT_PERMISSION_TEXT),
        text(page, PERSISTENT_PERMISSION_TEXT)
      ], 1_500);
      if (persistent) {
        await persistent.click();
        await shortWait(page);
        return { approved: true, persistent: true };
      }
      await dismissMenu(page);
    }

    await allow.click();
    await shortWait(page);
    return { approved: true, persistent: false };
  }
}

async function findComposer(page) {
  return firstVisible([
    locator(page, '#prompt-textarea'),
    locator(page, 'textarea[placeholder*="Message" i]'),
    role(page, 'textbox', /message|prompt|ask/i)
  ]);
}

async function findLoginControl(page) {
  return firstVisible([
    role(page, 'button', /log in|sign in|sign up/i),
    role(page, 'link', /log in|sign in|sign up/i),
    text(page, LOGIN_TEXT)
  ]);
}

async function findPicker(page) {
  return firstVisible([
    role(page, 'button', PICKER_TEXT),
    role(page, 'button', /model|reasoning|thinking/i),
    locator(page, '[data-testid="model-switcher-dropdown-button"]')
  ]);
}

async function findReasoningOption(page, value) {
  const reasoning = normalizeReasoningLevel(value);
  for (const label of REASONING_LABELS[reasoning]) {
    const pattern = new RegExp(`^${escapeRegex(label)}$`, 'i');
    const found = await firstVisible([
      role(page, 'menuitem', pattern),
      role(page, 'option', pattern),
      role(page, 'button', pattern),
      text(page, pattern)
    ]);
    if (found) return found;
  }
  return null;
}

function reasoningFromText(value) {
  const textValue = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/\bextra high\b/.test(textValue)) return 'extra_high';
  if (/\bpro(?: standard| extended)?\b/.test(textValue)) return 'pro';
  if (/\bhigh\b/.test(textValue)) return 'high';
  if (/\bmedium\b/.test(textValue)) return 'medium';
  if (/\binstant\b/.test(textValue)) return 'instant';
  return '';
}

function reasoningDisplayName(value) {
  const names = { instant: 'Instant', medium: 'Medium', high: 'High', extra_high: 'Extra High', pro: 'Pro' };
  return names[normalizeReasoningLevel(value)];
}

async function activeControl(value) {
  for (const attribute of ['aria-checked', 'aria-pressed']) {
    if (String(await safeAttribute(value, attribute)).toLowerCase() === 'true') return true;
  }
  return ['active', 'on', 'checked'].includes(String(await safeAttribute(value, 'data-state')).toLowerCase());
}

async function locatorLabel(value) {
  const aria = await safeAttribute(value, 'aria-label');
  if (aria) return aria;
  try { return await value.textContent() || ''; } catch { return ''; }
}

async function safeAttribute(value, name) {
  try { return await value.getAttribute(name); } catch { return null; }
}

async function firstVisible(values) {
  for (const value of values.filter(Boolean)) {
    const candidate = typeof value.first === 'function' ? value.first() : value;
    if (await visible(candidate)) return candidate;
  }
  return null;
}

async function waitForFirstVisible(page, values, timeoutMs) {
  let candidate = await firstVisible(values);
  if (candidate || typeof page?.waitForTimeout !== 'function') return candidate;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await shortWait(page, Math.min(100, Math.max(1, deadline - Date.now())));
    candidate = await firstVisible(values);
    if (candidate) return candidate;
  }
  return null;
}

async function visible(value) {
  if (!value || typeof value.isVisible !== 'function') return false;
  try { return await value.isVisible(); } catch { return false; }
}

async function waitForComposer(page, timeoutMs) {
  const primary = locator(page, '#prompt-textarea');
  if (!primary || typeof primary.waitFor !== 'function') return false;
  try {
    await primary.waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function waitForTemporaryChat(adapter, page, timeoutMs = 3_000) {
  if (await adapter.isTemporaryChat(page)) return true;
  if (typeof page?.waitForTimeout !== 'function') return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await shortWait(page, 100);
    if (await adapter.isTemporaryChat(page)) return true;
  }
  return false;
}

async function shortWait(page, ms = 125) {
  if (typeof page?.waitForTimeout !== 'function') return;
  try { await page.waitForTimeout(ms); } catch {}
}

async function dismissMenu(page) {
  try { await page.keyboard?.press('Escape'); } catch {}
}

function role(page, name, matcher) {
  if (!page || typeof page.getByRole !== 'function') return null;
  try { return page.getByRole(name, matcher ? { name: matcher } : undefined); } catch { return null; }
}

function scopedRole(scope, name, matcher) {
  if (!scope || typeof scope.getByRole !== 'function') return null;
  try { return scope.getByRole(name, matcher ? { name: matcher } : undefined); } catch { return null; }
}

function text(page, matcher) {
  if (!page || typeof page.getByText !== 'function') return null;
  try { return page.getByText(matcher, { exact: matcher instanceof RegExp ? undefined : true }); } catch { return null; }
}

function locator(page, selector) {
  if (!page || typeof page.locator !== 'function') return null;
  try { return page.locator(selector); } catch { return null; }
}

function scopedLocator(scope, selector) {
  if (!scope || typeof scope.locator !== 'function') return null;
  try { return scope.locator(selector); } catch { return null; }
}

function adapterError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  ChatGptPageAdapter,
  REASONING_LABELS,
  reasoningDisplayName,
  reasoningFromText
};
