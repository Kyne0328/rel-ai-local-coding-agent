const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");
const { collectTextFiles, readTextFileSafe } = require("./safety");

function semanticDir(config) { return path.join(getStateDir(config), "semantic-indexes"); }
function indexPath(config, workspace) { return path.join(semanticDir(config), `${String(workspace.alias).replace(/[^A-Za-z0-9_.-]/g, "-")}.json`); }

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9_.$/-]{2,}/g) || [];
}

function topTerms(tokens, max = 80) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([term, count]) => ({ term, count }));
}

function buildSemanticIndex(config, workspace, args = {}) {
  const maxFiles = Math.min(Math.max(Number(args.maxFiles || config.semanticIndex?.maxFiles || 8000), 1), 100000);
  const maxFileBytes = Math.min(Math.max(Number(args.maxFileBytes || config.semanticIndex?.maxFileBytes || 200000), 1000), 5 * 1024 * 1024);
  const tree = collectTextFiles(workspace.path, { maxEntries: maxFiles, maxFileBytes });
  const documents = [];
  for (const relativePath of tree.files) {
    let content;
    try { content = readTextFileSafe(workspace.path, relativePath, maxFileBytes); } catch (_error) { continue; }
    const tokens = tokenize(`${relativePath}\n${content}`);
    documents.push({ path: relativePath, sha256: crypto.createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content, "utf8"), terms: topTerms(tokens, 100) });
  }
  const index = { version: 1, workspace: workspace.alias, root: workspace.path, createdAt: new Date().toISOString(), documentCount: documents.length, documents, skipped: tree.skipped.slice(0, 500), truncated: tree.truncated };
  fs.mkdirSync(semanticDir(config), { recursive: true, mode: 0o700 });
  fs.writeFileSync(indexPath(config, workspace), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, index: { workspace: index.workspace, createdAt: index.createdAt, documentCount: index.documentCount, skippedCount: index.skipped.length, truncated: index.truncated } };
}

function readIndex(config, workspace) {
  const file = indexPath(config, workspace);
  if (!fs.existsSync(file)) throw new Error(`Semantic index not found for ${workspace.alias}. Run relai_semantic_index_build first.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function semanticSearch(config, workspace, args = {}) {
  const index = readIndex(config, workspace);
  const queryTerms = new Set(tokenize(args.query || args.terms || ""));
  const limit = Math.min(Math.max(Number(args.limit || 20), 1), 200);
  const scored = index.documents.map((doc) => {
    let score = 0;
    const matches = [];
    for (const { term, count } of doc.terms || []) {
      if (queryTerms.has(term) || [...queryTerms].some((q) => term.includes(q) || q.includes(term))) {
        score += count;
        matches.push(term);
      }
    }
    const pathBoost = [...queryTerms].some((q) => doc.path.toLowerCase().includes(q)) ? 20 : 0;
    return { path: doc.path, score: score + pathBoost, matches: [...new Set(matches)].slice(0, 20), bytes: doc.bytes };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return { ok: true, workspace: workspace.alias, query: args.query || args.terms || "", matches: scored, indexCreatedAt: index.createdAt };
}

function contextRecommend(config, workspace, args = {}) {
  const query = [args.goal, args.task, ...(Array.isArray(args.terms) ? args.terms : [])].filter(Boolean).join(" ");
  const search = semanticSearch(config, workspace, { query, limit: args.limit || 30 });
  return { ok: true, workspace: workspace.alias, recommendedFiles: search.matches, guidance: "Read the top matches before patching. Rebuild the index if the repo changed significantly.", indexCreatedAt: search.indexCreatedAt };
}

module.exports = { buildSemanticIndex, semanticSearch, contextRecommend };
