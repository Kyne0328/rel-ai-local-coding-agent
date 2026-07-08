const fs = require("node:fs");
const path = require("node:path");
const { collectTextFiles, collectOptionsFromWorkspace } = require("../safety");

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizeAuditTerms(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  return text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function isLikelyGeneratedFile(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  const leaf = normalized.split("/").pop() || "";
  const exactGenerated = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "pubspec.lock"]);
  return exactGenerated.has(leaf)
    || leaf.includes("generated")
    || leaf.endsWith("g.dart")
    || leaf.endsWith("freezed.dart")
    || leaf.endsWith(".g.cs");
}

function fileCategory(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (/(^|\/)(test|tests|__tests__)\//.test(normalized) || /\.test\./.test(normalized) || /\.spec\./.test(normalized)) return "tests";
  if (/(^|\/)(docs|doc)\//.test(normalized) || /\.md$/.test(normalized)) return "docs";
  if (/(^|\/)(public|assets|ui|views|templates)\//.test(normalized)) return "ui";
  if (/(schema|migration|migrations|sql)/i.test(normalized)) return "data";
  return "source";
}

function summarizeAuditFindings(findings) {
  const summary = { oldTermHits: 0, newTermHits: 0, byCategory: {} };
  for (const finding of findings) {
    if (finding.kind === "oldTerm") summary.oldTermHits += 1;
    if (finding.kind === "newTerm") summary.newTermHits += 1;
    summary.byCategory[finding.category] = (summary.byCategory[finding.category] || 0) + 1;
  }
  return summary;
}

function termFindings(kind, terms, line, relativePath, lineNumber) {
  const lowerLine = line.toLowerCase();
  const category = fileCategory(relativePath);
  return terms
    .filter((term) => lowerLine.includes(term.toLowerCase()))
    .map((term) => ({ kind, term, path: relativePath, line: lineNumber, category, text: line.trim().slice(0, 300) }));
}

function auditLineFindings(line, relativePath, lineNumber, oldTerms, newTerms) {
  return [
    ...termFindings("oldTerm", oldTerms, line, relativePath, lineNumber),
    ...termFindings("newTerm", newTerms, line, relativePath, lineNumber)
  ];
}

function readAuditFile(abs, relativePath) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] audit read failed:', relativePath, error);
    return "";
  }
}

function scanAuditFile(workspacePath, relativePath, oldTerms, newTerms) {
  const text = readAuditFile(path.join(workspacePath, relativePath), relativePath);
  if (!text) return [];
  return text.split(/\r?\n/).flatMap((line, index) => auditLineFindings(line, relativePath, index + 1, oldTerms, newTerms));
}

function auditFiles(tree, includeGenerated) {
  return tree.files.filter((relativePath) => includeGenerated || !isLikelyGeneratedFile(relativePath));
}

function relaiRefactorAudit(workspace, _config, args = {}) {
  const oldTerms = normalizeAuditTerms(args.oldTerms || args.oldTerm || args.find);
  const newTerms = normalizeAuditTerms(args.newTerms || args.newTerm || args.expect);
  if (oldTerms.length === 0 && newTerms.length === 0) {
    throw new Error("relai_refactor_audit requires oldTerms, newTerms, or both.");
  }
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, 5000);
  const tree = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries }));
  const findings = auditFiles(tree, args.includeGenerated === true)
    .flatMap((relativePath) => scanAuditFile(workspace.path, relativePath, oldTerms, newTerms));
  return {
    ok: true,
    workspace: workspace.alias,
    oldTerms,
    newTerms,
    findings,
    summary: summarizeAuditFindings(findings),
    scannedFiles: tree.files.length,
    skipped: tree.skipped
  };
}

module.exports = { relaiRefactorAudit };
