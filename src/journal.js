import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

const MAX_RECENT = 50;
const JOURNAL_MAX_BYTES = 8 * 1024 * 1024;
const JOURNAL_TAIL_MAX_BYTES = 4 * 1024 * 1024;
const JOURNAL_READ_CHUNK_BYTES = 64 * 1024;

function journalDir(config) {
  // Fall back to the home/env state dir, NOT process.cwd() — the old cwd fallback
  // wrote .rel-ai-mcp-state/ into whatever repo the process ran from (it kept
  // dirtying this project's own tree during tests).
  const stateDir = config?.stateDir
    || process.env.REL_AI_MCP_STATE_DIR
    || path.join(os.homedir(), ".rel-ai-mcp");
  return path.join(stateDir, "operation-journal");
}

function journalPath(config, workspaceAlias) {
  const safeAlias = String(workspaceAlias || "workspace").replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(journalDir(config), `${safeAlias}.jsonl`);
}

function makeOperationId() {
  return `op_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function appendOperation(config, workspace, entry) {
  const file = journalPath(config, workspace?.alias);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    id: entry.id || makeOperationId(),
    ts: new Date().toISOString(),
    workspace: workspace?.alias,
    root: workspace?.path,
    ...entry
  };
  const line = `${JSON.stringify(payload)}\n`;
  rotateJournalIfNeeded(file, Buffer.byteLength(line, "utf8"));
  fs.appendFileSync(file, line, "utf8");
  return payload;
}

function readRecentOperations(config, workspace, limit = MAX_RECENT) {
  const file = journalPath(config, workspace?.alias);
  const count = Math.min(Math.max(Number(limit) || MAX_RECENT, 1), 500);
  const current = readTailLines(file, count);
  const missing = count - current.length;
  const lines = missing > 0
    ? [...readTailLines(`${file}.1`, missing), ...current]
    : current;
  return lines.slice(-count).map((line) => {
    try { return JSON.parse(line); } catch { return { malformed: true, line: line.slice(0, 1000) }; }
  });
}

function rotateJournalIfNeeded(file, incomingBytes) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (size === 0 || size + incomingBytes <= JOURNAL_MAX_BYTES) return;
  const archive = `${file}.1`;
  fs.rmSync(archive, { force: true });
  fs.renameSync(file, archive);
}

function readTailLines(file, limit) {
  if (!fs.existsSync(file) || limit <= 0) return [];
  const stat = fs.statSync(file);
  if (!stat.size) return [];
  const fd = fs.openSync(file, "r");
  try {
    let position = stat.size;
    let bytesReadTotal = 0;
    let buffer = Buffer.alloc(0);
    let newlineCount = 0;
    while (position > 0 && newlineCount <= limit && bytesReadTotal < JOURNAL_TAIL_MAX_BYTES) {
      const remainingBudget = JOURNAL_TAIL_MAX_BYTES - bytesReadTotal;
      const length = Math.min(JOURNAL_READ_CHUNK_BYTES, position, remainingBudget);
      if (length <= 0) break;
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const bytesRead = fs.readSync(fd, chunk, 0, length, position);
      const part = chunk.subarray(0, bytesRead);
      buffer = Buffer.concat([part, buffer]);
      bytesReadTotal += bytesRead;
      for (const byte of part) if (byte === 10) newlineCount += 1;
    }
    let text = buffer.toString("utf8");
    if (position > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return text.split(/\r?\n/).filter(Boolean).slice(-limit);
  } finally {
    fs.closeSync(fd);
  }
}

function summarizeOperations(config, workspace, limit = 10) {
  const operations = readRecentOperations(config, workspace, limit);
  return {
    path: journalPath(config, workspace?.alias),
    recentCount: operations.length,
    recent: operations.map((item) => ({
      id: item.id,
      ts: item.ts,
      type: item.type,
      ok: item.ok,
      paths: item.paths,
      validation: item.validation,
      message: item.message
    }))
  };
}

export { appendOperation, makeOperationId, readRecentOperations, summarizeOperations };
