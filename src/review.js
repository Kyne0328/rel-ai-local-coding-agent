const { gitDiff } = require("./git");

function analyzeDiffText(diffText, args = {}) {
  const text = String(diffText || "");
  const files = changedFiles(text);
  const findings = [];
  const riskyPatterns = [
    { id: "secret", re: /api[_-]?key|password|token|secret/i, message: "Diff contains secret-like identifiers. Review carefully." },
    { id: "auth", re: /auth|jwt|session|cookie|csrf/i, message: "Auth/session/security-sensitive code changed." },
    { id: "database", re: /migration|schema|sql|prisma|typeorm/i, message: "Database/schema-related code changed." },
    { id: "destructive", re: /rm\s+-rf|deleteMany|drop table|truncate/i, message: "Potentially destructive operation appears in diff." },
    { id: "network", re: /fetch\(|axios|http\.request|https\.request|webhook/i, message: "Network/API behavior changed." }
  ];
  for (const pattern of riskyPatterns) if (pattern.re.test(text)) findings.push(pattern);
  const added = text.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = text.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  const testFiles = files.filter((file) => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[A-Za-z0-9]+$/.test(file));
  const sourceFiles = files.filter((file) => !testFiles.includes(file));
  const riskScore = Math.min(100, findings.length * 20 + Math.ceil((added + removed) / 80) * 10 + (sourceFiles.length > 8 ? 15 : 0) + (testFiles.length === 0 && sourceFiles.length > 0 ? 15 : 0));
  const riskLevel = riskScore >= 65 ? "high" : riskScore >= 35 ? "medium" : "low";
  const testGaps = [];
  if (sourceFiles.length && !testFiles.length) testGaps.push("Source files changed without matching test/spec file changes in the current diff.");
  if (/fix|bug|regression/i.test(args.goal || "") && !testFiles.length) testGaps.push("Bug-fix task appears to lack regression test updates.");
  return { ok: true, riskScore, riskLevel, files, fileCount: files.length, added, removed, findings, testFiles, sourceFiles, testGaps, checklist: ["Review changed files and public API impact.", "Run configured unit/lint/typecheck commands.", "Check secrets and generated files are not included.", "Confirm PR body lists validation performed."] };
}

async function reviewCurrentDiff(config, workspace, args = {}) {
  const diff = await gitDiff(workspace, config, { staged: Boolean(args.staged) });
  return { ...analyzeDiffText(diff.diff?.stdout || "", args), diff: args.includeDiff ? diff.diff?.stdout || "" : undefined };
}

function changedFiles(diffText) {
  const files = new Set();
  for (const line of String(diffText || "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
      if (match) files.add(match[2]);
    } else if (line.startsWith("+++ b/")) files.add(line.slice(6).trim().split(/\s+/)[0]);
  }
  return [...files].filter(Boolean).sort();
}

module.exports = {
  analyzeDiffText,
  reviewCurrentDiff,
  reviewScore: reviewCurrentDiff,
  reviewSecurity: reviewCurrentDiff,
  reviewTestGaps: reviewCurrentDiff,
  reviewRegressionRisks: reviewCurrentDiff
};
