import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDefaultConfig, normalizeConfig } from '../src/config.js';
import { autoApproveSettings } from '../src/autoApproveExtension.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = normalizeConfig(makeDefaultConfig());
assert.equal(cfg.autoApproveAppRequests.enabled, false);
assert.equal(cfg.autoApproveAppRequests.mode, 'chrome_extension');
assert.equal(autoApproveSettings(cfg).enabled, false);
assert.equal(autoApproveSettings(cfg).extensionOnly, true);
assert.match(autoApproveSettings(cfg).warning, /Chrome extension/);

const enabled = normalizeConfig({ ...makeDefaultConfig(), autoApproveAppRequests: { enabled: true, warningAccepted: true, pollMs: 700 } });
const settings = autoApproveSettings(enabled);
assert.equal(settings.enabled, true);
assert.equal(settings.warningAccepted, true);
assert.equal(settings.pollMs, 700);
assert.equal(settings.mode, 'chrome_extension');

const extDir = path.join(root, 'public', 'extensions', 'chrome-auto-approve');
for (const file of ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css', 'relai-logo-192.png']) {
  assert.equal(existsSync(path.join(extDir, file)), true, `${file} should exist`);
}

const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.author, 'Kyne0328');
assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*', 'https://chat.openai.com/*']);
assert.ok(manifest.permissions.includes('alarms'));
assert.ok(manifest.permissions.includes('scripting'));

const content = readFileSync(path.join(extDir, 'content.js'), 'utf8');
assert.match(content, /edit file/);
assert.match(content, /read local repo paths/);
assert.match(content, /reset workspace/);
assert.match(content, /reset local repo changes/);
assert.match(content, /snapshot workspace/);
assert.match(content, /isPrimaryButton/);
assert.match(content, /visibleButtons.length > 8/);
assert.match(content, /safeScanAndApprove/);
assert.match(content, /safeSendRuntimeMessage/);
assert.match(content, /reportContentError/);
assert.equal(content.includes('chrome.runtime.sendMessage(payload).catch'), false);
assert.doesNotMatch(content, /'edit',/);
assert.doesNotThrow(() => new Function(content));

// --- Regression: single activation per approval (no duplicate tool submissions) ---
// trustedClick must dispatch ONLY the press half of the pointer/mouse sequence. A
// pointerup/mouseup here would fire a button that activates on pointer-up AND again
// on the native el.click(), submitting the same approval twice. Lock the dispatch
// list to press-only and require exactly one el.click() activation.
const dispatchMatch = content.match(/for \(const type of (\[[^\]]*\])\)\s*\{\s*el\.dispatchEvent/);
assert.ok(dispatchMatch, 'trustedClick should have a pointer/mouse dispatch loop');
assert.equal(
  dispatchMatch[1],
  "['pointerdown', 'mousedown']",
  'trustedClick must dispatch only press events (pointerdown/mousedown); pointerup/mouseup double-activate the button'
);
assert.equal(
  (content.match(/try \{ el\.click\(\); \}/g) || []).length,
  1,
  'trustedClick must call el.click() exactly once (the single activation)'
);

// --- Regression: cross-tab arbitration (no duplicate approvals across ChatGPT tabs) ---
// The content script must claim a request signature from the background worker before
// clicking, and guard against overlapping async scans.
assert.match(content, /function claimApproval/, 'content.js should claim approvals before clicking');
assert.match(content, /'relai-claim-approval'/, 'content.js should send the cross-tab claim message');
assert.match(content, /scanInFlight/, 'content.js should guard against overlapping async scans');

const background = readFileSync(path.join(extDir, 'background.js'), 'utf8');
assert.match(background, /chrome\.alarms/);
assert.match(background, /api\/auto-approve\/settings/);
assert.match(background, /'relai-claim-approval'/, 'background.js should arbitrate cross-tab approval claims');
assert.match(background, /granted/, 'background.js claim handler should grant/deny');
assert.doesNotThrow(() => new Function('chrome', background));

const docs = readFileSync(path.join(root, 'docs', 'AUTO_APPROVE_EXTENSION.md'), 'utf8');
assert.match(docs, /extension only/i);
assert.match(docs, /@Kyne0328/);
console.log('Auto-approve Chrome extension smoke test passed.');
