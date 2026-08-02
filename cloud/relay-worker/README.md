# Rel.AI Cloud Relay Worker

This is the first deployable cloud component for the Electron-first Rel.AI architecture. It provides:

- Ed25519 proof-of-possession device registration
- short-lived, single-use pairing codes
- opaque hashed device and relay access tokens
- one hibernatable Durable Object WebSocket relay per device
- bounded forwarding of `/mcp` requests to a connected Rel.AI desktop app
- no repository payload persistence in D1

This milestone intentionally uses a pairing-code claim endpoint to issue a relay access token. It does **not** yet implement the OAuth endpoints required for a public ChatGPT app. The next milestone should replace the direct claim response with OAuth 2.1 authorization code + PKCE while retaining the same device and relay tables.

## 1. Install dependencies

```bash
cd cloud/relay-worker
npm install
```

## 2. Authenticate Wrangler

```bash
npx wrangler login
```

## 3. Create D1

```bash
npx wrangler d1 create rel-ai-cloud
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing:

```text
00000000-0000-0000-0000-000000000000
```

## 4. Apply migrations

Local development database:

```bash
npm run db:migrate:local
```

Production database:

```bash
npm run db:migrate:remote
```

## 5. Validate and run locally

```bash
npm run check
npm run dev
```

Wrangler prints the local Worker URL. Verify:

```bash
curl http://127.0.0.1:8787/health
```

## 6. Deploy

```bash
npm run deploy
```

The first deployment provisions the SQLite-backed `DeviceRelay` Durable Object declared by the `exports` field in `wrangler.jsonc`.

## Device registration protocol

Electron generates an Ed25519 key pair and retains the private key locally.

1. `POST /v1/devices/register/challenge`

```json
{
  "public_key_jwk": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "<base64url-public-key>"
  }
}
```

2. Sign the returned UTF-8 `challenge` with the local private key.
3. `POST /v1/devices/register/complete`

```json
{
  "challenge_id": "<challenge-id>",
  "signature": "<base64url-signature>"
}
```

The response contains a long-lived `device_token`. Store it with the operating system credential vault, not in renderer storage or logs.

## Pairing protocol

Create a short-lived code:

```http
POST /v1/devices/pairing-code
Authorization: Bearer <device-token>
```

Claim it from the client-side setup flow:

```http
POST /v1/pairings/claim
Content-Type: application/json

{"pairing_code":"ABCD-EFGH"}
```

The claim returns a temporary cloud relay bearer token. OAuth will replace this public response in the next milestone.

## Device WebSocket

Exchange the long-lived device token for a one-time connection ticket:

```http
POST /v1/devices/connection-ticket
Authorization: Bearer <device-token>
```

The ticket expires after 60 seconds and is consumed by the first connection attempt. Use the returned WebSocket subprotocol:

```js
const ticketResponse = await fetch(
  'https://<worker-host>/v1/devices/connection-ticket',
  { method: 'POST', headers: { authorization: `Bearer ${deviceToken}` } }
).then(response => response.json());

const socket = new WebSocket(
  'wss://<worker-host>/v1/devices/connect',
  [ticketResponse.websocket_protocol]
);
```

The worker sends request envelopes:

```json
{
  "type": "request",
  "request_id": "<uuid>",
  "method": "POST",
  "path": "/mcp",
  "headers": {"content-type":"application/json"},
  "body_base64": "<base64>"
}
```

Electron forwards the request only to its local Rel.AI `/mcp` endpoint and returns:

```json
{
  "type": "response",
  "request_id": "<same-uuid>",
  "status": 200,
  "headers": {"content-type":"application/json"},
  "body_base64": "<base64>"
}
```

Never implement this client as a generic URL proxy. The destination must remain fixed to local Rel.AI, with bounded body sizes, timeouts, cancellation, and an explicit response-header allowlist.

## Data policy

D1 stores only:

- device public keys
- hashes of device, relay, and one-time connection tokens
- pairing metadata
- timestamps and revocation state

MCP request bodies and repository content are passed through memory and are not written to D1.
