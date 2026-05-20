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

const background = readFileSync(path.join(extDir, 'background.js'), 'utf8');
assert.match(background, /chrome\.alarms/);
assert.match(background, /api\/auto-approve\/settings/);
assert.doesNotThrow(() => new Function('chrome', background));

const docs = readFileSync(path.join(root, 'docs', 'AUTO_APPROVE_EXTENSION.md'), 'utf8');
assert.match(docs, /extension only/i);
assert.match(docs, /@Kyne0328/);
console.log('Auto-approve Chrome extension smoke test passed.');
