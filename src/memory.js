const fs = require("node:fs");
const path = require("node:path");
const { getStateDir } = require("./audit");
const { safeReadJson } = require("./safety");

function memoryDir(config) { return path.join(getStateDir(config), "memory"); }
function workspaceMemoryPath(config, workspace) { return path.join(memoryDir(config), `${String(workspace.alias || workspace).replace(/[^A-Za-z0-9_.-]/g, "-")}.json`); }

function readMemory(config, workspace) {
  const file = workspaceMemoryPath(config, workspace);
  if (!fs.existsSync(file)) return { workspace: workspace.alias || workspace, notes: [], updatedAt: null };
  return safeReadJson(file, { workspace: workspace.alias || workspace, notes: [], updatedAt: null });
}

function writeMemoryFile(config, workspace, data) {
  fs.mkdirSync(memoryDir(config), { recursive: true, mode: 0o700 });
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(workspaceMemoryPath(config, workspace), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return data;
}

function writeMemory(config, workspace, args = {}) {
  const data = readMemory(config, workspace);
  const note = {
    id: `mem-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type: String(args.type || "note"),
    title: String(args.title || "Untitled note").slice(0, 200),
    text: String(args.text || args.content || "").slice(0, config.memory?.maxNoteChars || 20000),
    tags: Array.isArray(args.tags) ? args.tags.map(String).slice(0, 30) : []
  };
  data.notes = Array.isArray(data.notes) ? data.notes : [];
  data.notes.push(note);
  const maxNotes = Math.min(Math.max(Number(config.memory?.maxNotesPerWorkspace || 500), 1), 5000);
  if (data.notes.length > maxNotes) data.notes = data.notes.slice(-maxNotes);
  return { ok: true, memory: writeMemoryFile(config, workspace, data), note };
}

function searchMemory(config, workspace, args = {}) {
  const data = readMemory(config, workspace);
  const query = String(args.query || "").toLowerCase().trim();
  const limit = Math.min(Math.max(Number(args.limit || 20), 1), 200);
  const notes = (data.notes || []).filter((note) => {
    if (!query) return true;
    return `${note.title}\n${note.text}\n${(note.tags || []).join(" ")}`.toLowerCase().includes(query);
  }).slice(-limit).reverse();
  return { ok: true, workspace: workspace.alias, query, notes };
}

function clearMemory(config, workspace, args = {}) {
  if (args.confirm !== true) throw new Error("Set confirm=true to clear repository memory.");
  const data = { workspace: workspace.alias, notes: [], clearedAt: new Date().toISOString() };
  return { ok: true, memory: writeMemoryFile(config, workspace, data) };
}

module.exports = { readMemory, writeMemory, searchMemory, clearMemory };
