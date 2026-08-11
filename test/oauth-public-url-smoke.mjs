import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39921;
const publicUrl = 'https://relai.example.test';
const base = `http://127.0.0.1:${port}`;
const approvalToken = 'public-oauth-approval-token';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-public-oauth-'));
const configPath = path.join(stateDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: { repo: { path: root } }
}, null, 2));
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: configPath,
    REL_AI_MCP_TOKEN: approvalToken,
    REL_AI_MCP_STATE_DIR: stateDir,
    REL_AI_MCP_PUBLIC_URL: publicUrl
  }
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`not healthy: ${stderr}`);
}

function form(value) {
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    for (const entry of (Array.isArray(item) ? item : [item])) params.append(key, String(entry));
  }
  return params.toString();
}

async function postForm(pathname, value) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(value),
    redirect: 'manual'
  });
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

try {
  await waitForHealth();
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';

  const metadata = await fetch(`${base}/.well-known/oauth-authorization-server`).then(r => r.json());
  assert.equal(metadata.issuer, publicUrl, 'the OAuth issuer must be the public URL, not the loopback host');
  assert.equal(metadata.authorization_endpoint, `${publicUrl}/authorize`);

  const protectedResource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then(r => r.json());
  assert.equal(protectedResource.resource, `${publicUrl}/mcp`);
  assert.deepEqual(protectedResource.authorization_servers, [publicUrl]);

  const reg = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ application_type: 'web', client_name: 'ChatGPT', redirect_uris: [redirectUri], scope: 'mcp' })
  });
  assert.equal(reg.status, 201);
  const client = await reg.json();

  const pair = pkcePair();
  const values = {
    response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: pair.challenge, code_challenge_method: 'S256',
    resource: `${publicUrl}/mcp`, scope: 'mcp', state: 'public-oauth-state'
  };
  const page = await fetch(`${base}/authorize?${new URLSearchParams(values)}`);
  assert.equal(page.status, 200);
  const contentSecurityPolicy = page.headers.get('content-security-policy') || '';
  assert.match(contentSecurityPolicy, /form-action 'self' https:\/\/chatgpt\.com(?:;|\s)/, 'the public approval page must permit its OAuth redirect back to ChatGPT');
  assert.doesNotMatch(contentSecurityPolicy, /form-action 'self';/, 'a self-only form policy blocks Chromium from following the cross-origin OAuth redirect');
  const pageHtml = await page.text();
  assert.match(pageHtml, /<h1>Authorize ChatGPT<\/h1>/);
  assert.match(pageHtml, /Connect ChatGPT to your local Rel\.AI MCP workspaces\./);
  assert.match(pageHtml, /Settings &gt; Connection/);
  assert.match(pageHtml, /Below the connection controls, find <strong>Approval token<\/strong>, select <strong>Show<\/strong>, then <strong>Copy token<\/strong> and paste it here\./);
  assert.match(pageHtml, /Approve connection/);
  assert.match(pageHtml, /Requesting client: ChatGPT/);
  assert.match(pageHtml, /<form[^>]*action="\/authorize"/, 'the consent form must post back to the current public origin');
  assert.doesNotMatch(pageHtml, /action="https?:/i, 'the consent form must not use an absolute cross-origin action');

  const approved = await postForm('/authorize', { ...values, dashboard_token: approvalToken });
  assert.equal(approved.status, 303);
  const location = new URL(approved.headers.get('location'));
  assert.equal(location.searchParams.get('state'), 'public-oauth-state');
  assert.deepEqual([...location.searchParams.keys()].sort(), ['code', 'state']);
  assert.ok(location.searchParams.get('code'));

  const tokenResp = await postForm('/token', {
    grant_type: 'authorization_code', code: location.searchParams.get('code'), redirect_uri: redirectUri,
    client_id: client.client_id, code_verifier: pair.verifier
  });
  assert.equal(tokenResp.status, 200);
  const tokenBody = await tokenResp.json();
  assert.ok(tokenBody.access_token);
  assert.ok(tokenBody.refresh_token, 'ChatGPT scope=mcp grants must include a refresh token');
  const stored = JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8'));
  const accessKey = `sha256:${crypto.createHash('sha256').update(tokenBody.access_token).digest('hex')}`;
  assert.equal(stored.accessTokens[accessKey]?.issuer, publicUrl);
  assert.equal(stored.accessTokens[accessKey]?.resource, `${publicUrl}/mcp`);
  const metadataAfterExchange = await fetch(`${base}/.well-known/oauth-authorization-server`).then(r => r.json());
  assert.equal(metadataAfterExchange.issuer, publicUrl);

  const mcp = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokenBody.access_token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ChatGPT', version: '1.0.0' } }
    })
  });
  assert.equal(mcp.status, 200, JSON.stringify(await mcp.text().catch(() => '')));
} finally {
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Public-URL OAuth discovery, approval, exchange, and MCP access passed.');
