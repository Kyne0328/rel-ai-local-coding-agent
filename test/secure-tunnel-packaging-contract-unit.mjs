import assert from 'node:assert/strict';
import fs from 'node:fs';

const electronPackage = JSON.parse(fs.readFileSync(new URL('../electron/package.json', import.meta.url), 'utf8'));
const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const rootPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const electronPackager = fs.readFileSync(new URL('../scripts/electron-package.mjs', import.meta.url), 'utf8');

assert.ok(electronPackage.build.files.includes('secure-tunnel-runtime.js'));
assert.ok(electronPackage.build.files.includes('tunnel-credentials.js'));
assert.equal(electronPackage.build.files.some(file => /ngrok|gateway-client|public-connection-runtime/i.test(file)), false);
for (const platform of ['win', 'linux', 'mac']) {
  const resource = electronPackage.build[platform].extraResources.find(item => item.to === 'bin/tunnel-client');
  assert.ok(resource, `${platform} must package OpenAI tunnel-client`);
  assert.equal(resource.from, '../vendor/tunnel-client');
}
assert.doesNotMatch(main, /createGatewayClient|managedNgrok|createPublicConnectionRuntime|createApprovalTokenManager/);
assert.equal(rootPackage.scripts['fetch:ngrok'], undefined);
assert.equal(rootPackage.scripts['verify:ngrok'], undefined);
assert.equal(rootPackage.scripts['gateway:acceptance'], undefined);
assert.match(String(rootPackage.scripts['fetch:tunnel-client'] || ''), /scripts\/fetch-tunnel-client\.mjs/, 'tunnel-client fetching must stay available without freezing the command spelling');
assert.match(electronPackager, /ensureTunnelClient\(platform, targetArch\)/);
assert.match(electronPackager, /OpenAI tunnel-client is missing.*fetching the pinned/);
assert.match(electronPackager, /OpenAI tunnel-client verification/);
console.log('secure-tunnel-packaging-contract-unit: ok');
