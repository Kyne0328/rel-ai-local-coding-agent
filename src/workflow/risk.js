const RELEASE_PATH = /^(?:\.github\/workflows\/|scripts\/(?:release|package|electron-package)|release-manifest\.json|electron-builder|CHANGELOG\.md)/i;
const CONTRACT_PATH = /^(?:types\/|src\/tools\/(?:outputSchemas|actionDefinitions|connector)|src\/mcp\/|skills\/)/i;
const DEPENDENCY_PATH = /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|pyproject\.toml|requirements\.txt)$/i;
const SECURITY_CONFIG_PATH = /(?:^|\/)(?:auth|oauth|security|authorization|csp|permissions?|config)(?:\/|\.|$)/i;
const DOC_PATH = /\.(?:md|txt|rst)$/i;

function classifyWorkflowRisk({ changedFiles = [], packageIds = [], impactedPaths = [], affectedTests = [], operation = {} } = {}) {
  const files = unique(changedFiles);
  const reasons = [];
  let boundary = packageIds.length > 1 ? 'cross_package' : packageIds.length === 1 ? 'package' : files.length <= 1 ? 'file' : 'repository';
  let risk = files.length && files.every(file => DOC_PATH.test(file)) ? 'low' : files.length ? 'medium' : 'low';

  if (String(operation.kind || '') === 'migration') {
    boundary = 'repository'; risk = 'critical'; reasons.push('migration operation can change durable data');
  } else if (files.some(file => RELEASE_PATH.test(file))) {
    boundary = 'release'; risk = 'high'; reasons.push('release or workflow surface changed');
  } else if (files.some(file => CONTRACT_PATH.test(file))) {
    boundary = 'cross_package'; risk = 'high'; reasons.push('shared contract or public runtime surface changed');
    if (files.some(file => /src\/tools\/outputSchemas\.js$/i.test(file))) boundary = 'repository';
  }

  if (files.some(file => DEPENDENCY_PATH.test(file))) {
    if (boundary === 'file') boundary = packageIds.length === 1 ? 'package' : 'repository';
    risk = maxRisk(risk, 'high'); reasons.push('dependency manifest or lockfile changed');
  }
  if (files.some(file => SECURITY_CONFIG_PATH.test(file))) {
    risk = maxRisk(risk, 'high'); reasons.push('security or configuration surface changed');
  }
  if (packageIds.length > 1 && boundary !== 'release') {
    boundary = 'cross_package'; risk = maxRisk(risk, 'high'); reasons.push('multiple packages are affected');
  }
  if (packageIds.length === 1 && boundary === 'repository' && files.every(file => file.startsWith(packagePath(packageIds[0])))) boundary = 'package';
  if (risk === 'medium') reasons.push('behavior-changing source edit');
  if (risk === 'low') reasons.push(files.length ? 'documentation-only or low-risk file change' : 'no task-owned mutation');
  return {
    boundary: { level: boundary, packageIds: unique(packageIds), changedFiles: files, impactedPaths: unique(impactedPaths), affectedTests: unique(affectedTests) },
    risk: { level: risk, reasons: unique(reasons) }
  };
}

function maxRisk(left, right) { const levels = ['low', 'medium', 'high', 'critical']; return levels[Math.max(levels.indexOf(left), levels.indexOf(right))]; }
function packagePath(packageId) { const value = String(packageId || ''); const separator = value.indexOf(':'); const result = separator >= 0 ? value.slice(separator + 1) : ''; return result === 'root' ? '' : `${result}/`; }
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map(item => String(item || '').trim().replaceAll('\\', '/')).filter(Boolean))]; }

export { classifyWorkflowRisk };