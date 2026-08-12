import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const publicDocuments = [
  'README.md',
  'docs/ONE_CLICK_SETUP.md',
  'docs/CONNECTING_TO_CHATGPT.md'
];
const documentOnlyPatterns = [
  /\bterminal\b/i,
  /\bPowerShell\b/i,
  /command prompt/i,
  /\bNode\.js\b/i,
  /\bnpm\b/i,
  /`?\.env`?/i,
  /\blocalhost\b/i,
  /127\.0\.0\.1/,
  /\bloopback\b/i,
  /\/health\b/i,
  /\bconfig\.json\b/i,
  /JSON configuration/i,
  /manual(?:ly)? (?:start|server|setup|install)/i,
  /install (?:the )?ngrok/i,
  /separate ngrok download/i
];
const sharedPublicPatterns = [
  /\bpublic endpoint\b/i,
  /\bbrowser dashboard\b/i
];

for (const relative of publicDocuments) {
  const source = read(relative);
  const setupFacingSource = relative === 'README.md'
    ? (source.match(/^## Start using Rel\.AI[\s\S]*?(?=^## )/m)?.[0] || source)
    : source;
  for (const pattern of [...documentOnlyPatterns, ...sharedPublicPatterns]) {
    assert.doesNotMatch(setupFacingSource, pattern, `${relative} exposes developer-only setup language: ${pattern}`);
  }
}
for (const relative of publicDocuments) {
  const directory = path.dirname(path.join(root, relative));
  for (const match of read(relative).matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = String(match[1] || '').trim().replace(/^<|>$/g, '');
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
    const localPath = decodeURIComponent(target.split('#')[0].split('?')[0]);
    assert.equal(fs.existsSync(path.resolve(directory, localPath)), true, `${relative} contains a missing local link: ${target}`);
  }
}
assert.match(read('README.md'), /docs\/DEVELOPMENT\.md/, 'README must route source development into the developer guide');
assert.equal(fs.existsSync(path.join(root, 'docs/DEVELOPMENT.md')), true, 'technical development instructions need a dedicated document');
const publicJourney = publicDocuments.map(read).join('\n');
for (const outcome of [
  /Install Rel\.AI MCP/i,
  /create an OpenAI Secure MCP Tunnel/i,
  /Tunnel[\s\S]{0,40}connection option/i,
  /add (?:a|your first) workspace/i,
  /OpenAI Secure MCP Tunnel/i,
  /runtime API key/i,
  /(?:troubleshoot|diagnostics).*(?:in Rel\.AI|Connection|Diagnostics)/is
]) {
  assert.match(publicJourney, outcome, `public documentation must cover the Electron user outcome: ${outcome}`);
}

const publicCopyFiles = [
  'electron/renderer/wizard.html',
  'electron/renderer/wizard.js',
  'src/ui/features/settings/connector.js',
  'src/ui/features/settings/desktop-connection.js',
  'src/ui/features/settings/connection-guidance.js',
  'src/ui/features/settings/diagnostics.js',
  'src/ui/api.js',
  'src/desktopUxContracts.js'
];
for (const relative of publicCopyFiles) {
  const source = read(relative);
  for (const pattern of sharedPublicPatterns) {
    assert.doesNotMatch(source, pattern, `${relative} exposes internal connection terminology: ${pattern}`);
  }
}

console.log('Electron-first product path scanner passed.');
