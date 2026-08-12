import assert from 'node:assert/strict';
import fs from 'node:fs';

const electronPackage = JSON.parse(fs.readFileSync(new URL('../electron/package.json', import.meta.url), 'utf8'));
const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const rootPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.ok(electronPackage.build.files.includes('secure-tunnel-runtime.js'));
assert.ok(electronPackage.build.files.includes('tunnel-credentials.js'));
assert.equal(electronPackage.build.files.some(file => /ngrok|gateway-client|public-connection-runtime/i.test(file)), false);
for (const platform of ['win', 'linux']) {
  const resource = electronPackage.build[platform].extraResources.find(item => item.to === 'bin/tunnel-client');
  assert.ok(resource, `${platform} must package OpenAI tunnel-client`);
  assert.equal(resource.from, '../vendor/tunnel-client');
}
assert.doesNotMatch(main, /createGatewayClient|managedNgrok|createPublicConnectionRuntime|createApprovalTokenManager/);
assert.equal(rootPackage.scripts['fetch:ngrok'], undefined);
assert.equal(rootPackage.scripts['verify:ngrok'], undefined);
assert.equal(rootPackage.scripts['gateway:acceptance'], undefined);
assert.equal(rootPackage.scripts['fetch:tunnel-client'], 'node scripts/fetch-tunnel-client.mjs');
console.log('secure-tunnel-packaging-contract-unit: ok');
