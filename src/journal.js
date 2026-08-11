import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

const MAX_RECENT = 50;

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
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

function readRecentOperations(config, workspace, limit = MAX_RECENT) {
  const file = journalPath(config, workspace?.alias);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.min(Math.max(Number(limit) || MAX_RECENT, 1), 500)).map((line) => {
    try { return JSON.parse(line); } catch { return { malformed: true, line: line.slice(0, 1000) }; }
  });
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

export { appendOperation, makeOperationId,  summarizeOperations };
