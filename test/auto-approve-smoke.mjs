import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDefaultConfig, normalizeConfig } from '../src/config.js';
import { autoApproveSettings, renderUserscript } from '../src/autoApproveUserscript.js';

const cfg = normalizeConfig(makeDefaultConfig());
assert.equal(cfg.autoApproveAppRequests.enabled, false);
assert.equal(cfg.autoApproveAppRequests.requireUserscriptToggle, true);
assert.equal(autoApproveSettings(cfg).enabled, false);
assert.match(autoApproveSettings(cfg).warning, /Auto-approving ChatGPT app requests/);

const enabled = normalizeConfig({ ...makeDefaultConfig(), autoApproveAppRequests: { enabled: true, warningAccepted: true, pollMs: 700 } });
const settings = autoApproveSettings(enabled);
assert.equal(settings.enabled, true);
assert.equal(settings.warningAccepted, true);
assert.equal(settings.pollMs, 700);

const script = renderUserscript({ baseUrl: 'http://127.0.0.1:4999', token: 'tok-test' });
assert.match(script, /==UserScript==/);
assert.match(script, /@match\s+https:\/\/chatgpt\.com\/\*/);
assert.match(script, /api\/auto-approve\/settings/);
assert.match(script, /tok-test/);
assert.match(script, /Rel\.AI: Toggle auto-approve/);
assert.match(script, /Rel\.AI: Disable auto-approve/);
assert.match(script, /@author\s+Kyne0328/);
assert.match(script, /edit file/);
assert.match(script, /read local repo paths/);
assert.match(script, /gmSet\('armed', Boolean\(enabled\)\)/);
assert.match(script, /Click to toggle browser-local auto-approve/);
assert.match(script, /findBridgeActionButtonsSafe/);
assert.doesNotMatch(script, /findBridgeActionButtonsUnsafe/);
assert.doesNotMatch(script, /'edit',/);
assert.match(script, /never click standalone ChatGPT Edit buttons/);
assert.match(script, /findApprovalCardForButton/);
assert.match(script, /isRelAiApprovalCard/);
assert.match(script, /countButtons\(node\) > 8/);
assert.doesNotThrow(() => new Function(script));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = readFileSync(path.join(root, 'docs', 'AUTO_APPROVE_USERSCRIPT.md'), 'utf8');
assert.match(docs, /Required double opt-in/);
console.log('Auto-approve userscript smoke test passed.');
