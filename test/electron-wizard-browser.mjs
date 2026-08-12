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

assert.match(html, /OpenAI Secure MCP Tunnel/);
assert.match(html, /id="tunnelIdInput"/);
assert.match(html, /id="tunnelApiKeyInput"/);
assert.match(html, /id="portInput"/);
assert.match(html, /id="connectBtn"/);
assert.match(html, /id="cancelWizardBtn"/);
assert.match(html, /operating system credential store/i);
assert.match(html, /platform\.openai\.com\/settings\/organization\/tunnels/);
assert.match(html, /platform\.openai\.com\/settings\/organization\/api-keys/);
assert.match(html, /Authentication:\s*<b>No authentication<\/b>/i);
assert.match(html, /Do not choose OAuth/i);
assert.doesNotMatch(html, /Cloudflare|Rel\.AI Cloud|ngrok|Direct connection|pairing code|approval token|Rel\.AI account/i);

assert.match(js, /validTunnelId/);
assert.match(js, /\^tunnel_/);
assert.match(js, /validPort/);
assert.match(js, /wizardDone\(\{ tunnelId, tunnelApiKey, port, restart: recoveryMode \}\)/);
assert.match(js, /tunnelStatus !== 'running'/);
assert.match(js, /getRecoveryConfig/);
assert.match(js, /Stored securely — leave blank to keep it/);
assert.match(js, /copyText\(value\)/);
assert.match(js, /Organization settings → API Keys/);
assert.doesNotMatch(js, /cloud|ngrok|pairing|approvalToken|connectionMode/i);

for (const api of ['wizardDone', 'closeWizard', 'getRecoveryConfig']) assert.match(preload, new RegExp(`\\b${api}\\b`));
for (const removed of ['startCloudEnrollment', 'getGatewayUsage', 'replaceApprovalToken', 'openExternal']) assert.doesNotMatch(preload, new RegExp(`\\b${removed}\\b`));
assert.match(ipc, /'wizard:done'/);
assert.match(ipc, /setTunnelApiKey/);
assert.match(ipc, /saveLauncherConfig/);
assert.doesNotMatch(ipc, /wizard:cloud|desktop:gateway|approval-token|url:open-link/);
assert.match(main, /showDashboardWindow\(''\)/, 'Successful setup must hand off to dashboard Home.');
assert.match(css, /\.wizard-/);
assert.match(css, /Segoe UI Variable/);
assert.match(css, /\.wizard-platform-guide/);
assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.wizard-/);

console.log('Secure MCP Tunnel wizard contracts passed.');
