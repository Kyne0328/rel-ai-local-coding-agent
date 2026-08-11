import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('electron/renderer/wizard.html');
const js = read('electron/renderer/wizard.js');
const preload = read('electron/preload.cjs');
const ipc = read('electron/ipc-handlers.js');
const main = read('electron/main.js');
const css = read('electron/renderer/app.css');

assert.match(html, /<strong>Connect ChatGPT<\/strong>/);
assert.match(html, /<strong>Secure this device<\/strong>/);
assert.match(html, /<strong>Next steps<\/strong>/);
assert.match(html, /Create pairing code/);
assert.match(html, /Plus or Pro[\s\S]*Plugins/i);
assert.match(html, /Business, Enterprise, or Edu[\s\S]*workspace Apps/i);
assert.doesNotMatch(html, /<strong>Welcome<\/strong>|<strong>Local service<\/strong>|<strong>Secure connection<\/strong>|<strong>Launch<\/strong>/);

const cloudStart = html.indexOf('data-cloud-flow');
const advancedStart = html.indexOf('id="advancedSetup"');
assert.ok(cloudStart >= 0 && advancedStart > cloudStart, 'Cloud flow must render before Advanced setup');
const normalCloudHtml = html.slice(cloudStart, advancedStart);
for (const hiddenInfrastructure of ['Cloudflare', 'ngrok account key', 'Local service port', 'Approval token', 'API key']) {
  assert.equal(normalCloudHtml.includes(hiddenInfrastructure), false, 'normal Cloud onboarding must hide ' + hiddenInfrastructure);
}

for (const id of ['connectChatgptBtn', 'pairingCode', 'pairingExpiry', 'continueSecurityBtn', 'showRecoveryBtn', 'finishCloudBtn', 'advancedSetup', 'directPortInput', 'directNgrokTokenInput', 'directDomainInput', 'launchDirectBtn', 'recoveryCodeInput', 'recoverIdentityBtn', 'createLinkCodeBtn', 'linkCodeOutput', 'linkCodeValue']) {
  assert.match(html, new RegExp('id=["\\\']' + id + '["\\\']'), 'wizard must expose ' + id);
}
assert.match(html, /short-lived pairing code/i);
assert.match(html, /Plus or Pro[\s\S]*Plugins/i, 'Plus and Pro onboarding must direct users to ChatGPT Plugins');
assert.match(html, /Business, Enterprise, or Edu[\s\S]*workspace Apps/i, 'managed plans must retain workspace Apps guidance');
assert.match(html, /private key[^<]*(?:never leaves|stays on) this (?:computer|device)/i);
assert.match(html, /recovery code/i);
assert.match(html, /Direct connection/i);
assert.match(html, /ngrok account key/i, 'Advanced Direct flow must retain ngrok controls');

for (const api of ['startCloudPairing', 'getCloudSetupStatus', 'cancelCloudPairing', 'getWizardRecoveryCode', 'createWizardDeviceLink', 'recoverCloudIdentity']) {
  assert.match(preload, new RegExp(api), 'wizard preload must expose ' + api);
  assert.match(js, new RegExp('electronAPI\\.' + api), 'wizard must use ' + api);
}
assert.match(ipc, /wizard:cloud-pair/);
assert.match(ipc, /wizard:cloud-status/);
assert.match(ipc, /wizard:cloud-cancel/);
assert.match(ipc, /wizard:cloud-recovery-get/);
assert.match(ipc, /wizard:cloud-link-create/);
assert.match(ipc, /wizard:cloud-recover/);
assert.match(main, /startWizardCloudPairing/);
assert.match(main, /recoverWizardCloudIdentity/);

assert.match(js, /connectionMode:\s*['"]cloud['"]/);
assert.match(js, /connectionMode:\s*['"]direct['"]/);
assert.match(js, /restart:\s*true/, 'switching to Direct from an active Cloud setup must restart only the public connection mode');
assert.match(js, /ngrokAuthtoken/);
assert.match(js, /ngrokDomain/);
assert.match(js, /isValidPort/);
assert.match(js, /isValidNgrokKey/);
assert.match(js, /isValidDomain/);
assert.match(main, /showDashboardWindow\(''\)/, 'finished first-run setup must open the dashboard Home route so the Getting started guide can continue the handoff');

assert.match(js, /pairing.*expires/i);
assert.match(js, /setInterval|setTimeout/, 'wizard must refresh pairing expiry/status while visible');
assert.match(js, /state\.cloudConnected/);
assert.match(js, /showRecovery/);
assert.doesNotMatch(js, /privateJwk|encryptedPrivateKey|privateKey/);

assert.match(css, /\.wizard-cloud-/);
assert.match(css, /\.wizard-advanced-/);
assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.wizard-/);

console.log('Cloud-first wizard, Advanced Direct, recovery, and dashboard-handoff contracts passed.');
