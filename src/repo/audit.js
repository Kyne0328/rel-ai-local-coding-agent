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
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pubspec\.lock|.*generated.*|.*g\.dart|.*freezed\.dart|.*\.g\.cs)$/.test(normalized);
}

function fileCategory(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
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

function relaiRefactorAudit(workspace, _config, args = {}) {
  const oldTerms = normalizeAuditTerms(args.oldTerms || args.oldTerm || args.find);
  const newTerms = normalizeAuditTerms(args.newTerms || args.newTerm || args.expect);
  if (oldTerms.length === 0 && newTerms.length === 0) {
    throw new Error("relai_refactor_audit requires oldTerms, newTerms, or both.");
  }
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, 5000);
  const tree = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries }));
  const includeGenerated = args.includeGenerated === true;
  const findings = [];
  for (const relativePath of tree.files) {
    if (!includeGenerated && isLikelyGeneratedFile(relativePath)) continue;
    const abs = path.join(workspace.path, relativePath);
    let text;
    try { text = fs.readFileSync(abs, "utf8"); } catch (_error) { continue; }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const term of oldTerms) {
        if (line.toLowerCase().includes(term.toLowerCase())) {
          findings.push({ kind: "oldTerm", term, path: relativePath, line: index + 1, category: fileCategory(relativePath), text: line.trim().slice(0, 300) });
        }
      }
      for (const term of newTerms) {
        if (line.toLowerCase().includes(term.toLowerCase())) {
          findings.push({ kind: "newTerm", term, path: relativePath, line: index + 1, category: fileCategory(relativePath), text: line.trim().slice(0, 300) });
        }
      }
    }
  }
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
