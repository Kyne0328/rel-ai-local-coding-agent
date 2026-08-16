import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flushAuditWrites, safeLogAudit } from '../src/audit.js';

async function runAuditRedactionRegression(existingRoot = '') {
  const ownsRoot = !existingRoot;
  const root = existingRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'relai-audit-redaction-'));
  const config = { stateDir: root, auditLogPath: path.join(root, 'audit.jsonl') };
  const secret = 'audit-message-secret-987654';

  try {
    await safeLogAudit(config, {
      tool: 'security-regression',
      ok: false,
      error: `Authorization: Bearer ${secret}`,
      warnings: [`password=${secret}`],
      nested: { message: `api_key=${secret}` },
      authorization: `Bearer ${secret}`
    });
    await flushAuditWrites(config.auditLogPath);

    const persisted = fs.readFileSync(config.auditLogPath, 'utf8');
    assert.equal(persisted.includes(secret), false, persisted);
    assert.match(persisted, /redacted/i);
    assert.match(persisted, /security-regression/);
  } finally {
    if (ownsRoot) fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runAuditRedactionRegression();
  console.log('Audit logging redacts secrets embedded in generic string fields and arrays.');
}

export { runAuditRedactionRegression };
