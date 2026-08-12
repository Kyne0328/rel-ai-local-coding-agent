import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const verifySource = fs.readFileSync(path.join(root, 'scripts', 'verify-packaged-app.mjs'), 'utf8');
const runTestsSource = fs.readFileSync(path.join(root, 'test', 'run-tests.mjs'), 'utf8');
const ciSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

for (const file of ['gateway-client.js', 'gateway-device-identity.js', 'gateway-state.js', 'public-connection-runtime.js']) {
  assert.ok(electronPkg.build.files.includes(file), `Electron package must include ${file}`);
}
const srcResource = electronPkg.build.extraResources.find(item => item.from === '../src');
assert.ok(srcResource, 'Electron package must include the shared src runtime');
assert.ok(srcResource.filter.includes('**/*.js'), 'shared src gateway client modules must be packaged through the canonical src JavaScript resource');

const privateGatewayMarkers = ['package.json', 'wrangler.toml', 'wrangler.jsonc', 'src', 'test'];
assert.equal(
  privateGatewayMarkers.some(marker => fs.existsSync(path.join(root, 'gateway', marker))),
  false,
  'public rel-ai-mcp must not contain the private cloud Worker project'
);
assert.equal(fs.existsSync(path.join(root, 'contracts', 'cloud', 'mcp-manifest.json')), true, 'public cloud MCP contract artifact must exist');
assert.equal(electronPkg.build.files.some(value => /(?:^|\/)gateway(?:\/|$)/.test(value)), false, 'Electron files must not copy a cloud Worker project');
assert.equal(electronPkg.build.extraResources.some(item => String(item.from || '').includes('../gateway')), false, 'Electron extraResources must not copy a private cloud Worker directory');
for (const dependency of ['wrangler', '@cloudflare/vitest-pool-workers', 'miniflare']) {
  assert.equal(Boolean(electronPkg.dependencies?.[dependency] || electronPkg.devDependencies?.[dependency]), false, `Electron dependency tree must exclude ${dependency}`);
  assert.equal(Boolean(rootPkg.dependencies?.[dependency] || rootPkg.devDependencies?.[dependency]), false, `Root desktop dependency tree must exclude ${dependency}`);
}
for (const required of ['gateway/node_modules', 'wrangler', 'Cloudflare', 'privateJwk', 'recoverySecret', 'REL_AI_GATEWAY_ORIGIN']) {
  assert.match(verifySource, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `packaged verification must explicitly cover ${required}`);
}
assert.match(verifySource, /gateway-client\.js/);
assert.match(verifySource, /src[\\/]+gateway/);

const critical = ['gateway-device-identity-unit.mjs', 'gateway-local-execution-unit.mjs', 'gateway-desktop-lifecycle-unit.mjs', 'gateway-packaging-contract-unit.mjs'];
for (const test of critical) assert.match(runTestsSource, new RegExp(test.replace('.', '\\.')), `release-critical root suite must include ${test}`);
assert.doesNotMatch(runTestsSource, /gateway\/test\//, 'private Worker tests must not be part of the public release-critical runner');

assert.doesNotMatch(ciSource, /gateway\/package-lock\.json/);
assert.doesNotMatch(ciSource, /npm ci --prefix gateway/);
assert.doesNotMatch(ciSource, /npm test --prefix gateway/);
assert.doesNotMatch(ciSource, /wrangler deploy/);
assert.match(ciSource, /npm run verify:cloud-contract/);
assert.match(ciSource, /REL_AI_SCHEMA_BASE_REF/);
assert.match(ciSource, /npm run verify:mcp-schema/);
assert.match(ciSource, /npm run gateway:acceptance -- --platform win32/);
assert.match(ciSource, /xvfb-run --auto-servernum npm run gateway:acceptance -- --platform linux/);

assert.equal(rootPkg.scripts?.['generate:cloud-contract'], 'node scripts/generate-cloud-contract.mjs');
assert.equal(rootPkg.scripts?.['verify:cloud-contract'], 'node scripts/generate-cloud-contract.mjs --check');
assert.equal(rootPkg.scripts?.['gateway:acceptance'], 'node scripts/gateway-acceptance.mjs');
assert.equal(fs.existsSync(path.join(root, 'scripts', 'gateway-acceptance.mjs')), true, 'desktop gateway acceptance harness must exist');
assert.match(rootPkg.scripts?.['test:gateway-packaging'] || '', /gateway-packaging-contract-unit\.mjs/);

console.log('Public/private cloud boundary, packaging isolation, CI, and release-critical contracts passed.');
