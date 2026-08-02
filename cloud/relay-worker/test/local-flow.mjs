import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const port = 8791;
const baseUrl = `http://127.0.0.1:${port}`;
const processHandle = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let output = '';
processHandle.stdout.on('data', chunk => { output += String(chunk); });
processHandle.stderr.on('data', chunk => { output += String(chunk); });

try {
  await waitForHealth();

  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const challenge = await postJson('/v1/devices/register/challenge', {
    public_key_jwk: publicKeyJwk
  }, 201);
  assert.match(challenge.device_id, /^device_[a-f0-9]{32}$/);

  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    keyPair.privateKey,
    new TextEncoder().encode(challenge.challenge)
  );
  const registered = await postJson('/v1/devices/register/complete', {
    challenge_id: challenge.challenge_id,
    signature: Buffer.from(signature).toString('base64url')
  }, 201);
  assert.equal(registered.device_id, challenge.device_id);
  assert.match(registered.device_token, /^relai_device_[A-Za-z0-9_-]+$/);

  const pairing = await postJson('/v1/devices/pairing-code', {}, 201, registered.device_token);
  assert.match(pairing.pairing_code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

  const claimed = await postJson('/v1/pairings/claim', {
    pairing_code: pairing.pairing_code
  }, 201);
  assert.equal(claimed.device_id, challenge.device_id);
  assert.match(claimed.access_token, /^relai_cloud_[A-Za-z0-9_-]+$/);

  const secondClaim = await fetch(`${baseUrl}/v1/pairings/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairing_code: pairing.pairing_code })
  });
  assert.equal(secondClaim.status, 400, 'pairing codes must be single-use');

  const ticket = await postJson('/v1/devices/connection-ticket', {}, 201, registered.device_token);
  assert.match(ticket.connection_ticket, /^relai_ticket_[A-Za-z0-9_-]+$/);
  assert.equal(ticket.websocket_protocol, `relai-device.${ticket.connection_ticket}`);

  const unauthorizedMcp = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
  assert.equal(unauthorizedMcp.status, 401);
  assert.match(unauthorizedMcp.headers.get('www-authenticate') || '', /^Bearer /);

  console.log('Local Cloudflare flow passed: registration, pairing, access token, and connection ticket.');
} finally {
  await stopProcess();
}

async function postJson(pathname, body, expectedStatus, bearer = '') {
  const headers = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const value = await response.json();
  assert.equal(response.status, expectedStatus, `${pathname}: ${JSON.stringify(value)}\n${output}`);
  assert.equal(value.ok, true, `${pathname}: ${JSON.stringify(value)}`);
  return value;
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode != null) {
      throw new Error(`Wrangler exited before becoming ready.\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler did not become ready.\n${output}`);
}

async function stopProcess() {
  if (processHandle.exitCode != null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'], {
      encoding: 'utf8',
      windowsHide: true
    });
  } else {
    processHandle.kill('SIGTERM');
  }
  await Promise.race([
    new Promise(resolve => processHandle.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000))
  ]);
  if (processHandle.exitCode == null && process.platform !== 'win32') processHandle.kill('SIGKILL');
}
