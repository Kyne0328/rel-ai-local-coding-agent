CREATE TABLE IF NOT EXISTS device_connection_tickets (
  ticket_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_connection_tickets_device
  ON device_connection_tickets(device_id, expires_at);
