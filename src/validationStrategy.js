import { execSync } from 'node:child_process';
import { classifyWorkflowRisk } from './workflow/risk.js';
import { discoverRepositoryTopology, packageForPath } from './workflow/topology.js';

const VALID_LEVELS = new Set(['minimal', 'focused', 'broad', 'extended']);

function gitOutput(command, execOpts) { return execSync(command, execOpts).toString().trim(); }
function normalizeChangedFiles(...groups) {
  return [...new Set(groups.flatMap(group => String(group || '').split('\n')).map(file => file.trim()).filter(Boolean))];
}
function getChangedFiles(workspacePath) {
  const execOpts = { cwd: workspacePath, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] };
  try {
    return normalizeChangedFiles(
      gitOutput('git diff --name-only', execOpts),
      gitOutput('git diff --name-only --cached', execOpts),
      gitOutput('git ls-files --others --exclude-standard', execOpts)
    );
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] changed file detection:', error);
    return null;
  }
}

function classifyFiles(files, workspaceConfig = {}, facts = {}) {
  const changedFiles = Array.isArray(files) ? files : [];
  if (!changedFiles.length) return { level: 'focused', reason: 'no changed files detected', boundary: 'file', risk: 'low' };
  const custom = customRuleMatch(changedFiles, workspaceConfig?.validationRules || {});
  if (custom) return custom;
  const packageIds = Array.isArray(facts.packageIds) && facts.packageIds.length ? facts.packageIds : inferPackageIds(changedFiles);
  const classification = classifyWorkflowRisk({ changedFiles, packageIds, impactedPaths: facts.impactedPaths, affectedTests: facts.affectedTests, operation: facts.operation });
  const { boundary, risk } = classification;
  const level = boundary.level === 'release' || risk.level === 'critical'
    ? 'extended'
    : boundary.level === 'repository' || boundary.level === 'cross_package' || risk.level === 'high'
      ? 'broad'
      : risk.level === 'low' && changedFiles.every(file => /\.(?:md|txt|csv|rst)$/i.test(file))
        ? 'minimal'
        : 'focused';
  return { level, reason: `${boundary.level} boundary with ${risk.level} risk`, boundary: boundary.level, risk: risk.level, riskReasons: risk.reasons };
}

function selectValidationLevel(workspacePath, workspaceConfig, overrideLevel, changedFilesOverride, facts = {}) {
  if (overrideLevel && VALID_LEVELS.has(overrideLevel)) return { level: overrideLevel, reason: 'caller-specified', changedFiles: [] };
  const changedFiles = Array.isArray(changedFilesOverride)
    ? [...new Set(changedFilesOverride.map(file => String(file || '').trim()).filter(Boolean))]
    : getChangedFiles(workspacePath);
  if (changedFiles === null) return { level: 'focused', reason: 'git diff unavailable', changedFiles: [] };
  let packageIds = facts.packageIds;
  if (!Array.isArray(packageIds)) {
    try {
      const topology = discoverRepositoryTopology(workspacePath);
      packageIds = [...new Set(changedFiles.map(file => packageForPath(topology, file)?.id).filter(Boolean))];
    } catch { packageIds = inferPackageIds(changedFiles); }
  }
  const selected = classifyFiles(changedFiles, workspaceConfig, { ...facts, packageIds });
  return { ...selected, changedFiles };
}

function customRuleMatch(files, rules) {
  const customRules = Array.isArray(rules.customRules) ? rules.customRules : [];
  for (const rule of customRules) {
    if (!rule || !VALID_LEVELS.has(rule.level) || typeof rule.pattern !== 'string' || !rule.pattern) continue;
    if (files.some(file => file.includes(rule.pattern))) return { level: rule.level, reason: rule.reason || `matched custom rule ${rule.pattern}` };
  }
  return null;
}
function inferPackageIds(files) {
  const roots = new Set(files.filter(file => String(file).includes('/')).map(file => String(file).replaceAll('\\', '/').split('/')[0]));
  return roots.size === 1 ? [`path:${[...roots][0]}`] : [];
}

export { selectValidationLevel, classifyFiles };