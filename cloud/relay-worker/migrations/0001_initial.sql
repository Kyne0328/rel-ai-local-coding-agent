PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS device_registration_challenges (
  challenge_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  public_key_jwk TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_registration_challenges_expiry
  ON device_registration_challenges(expires_at);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  public_key_jwk TEXT NOT NULL,
  device_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_devices_token_hash
  ON devices(device_token_hash);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pairing_codes_device
  ON pairing_codes(device_id, expires_at);

CREATE TABLE IF NOT EXISTS relay_access_tokens (
  token_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_relay_tokens_device
  ON relay_access_tokens(device_id, expires_at);
