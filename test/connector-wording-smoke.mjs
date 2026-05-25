import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const scannedFiles = [
  'src/tools.js',
  'src/httpServer.js',
  'src/resources.js',
  'README.md',
  'docs/AUTO_APPROVE_EXTENSION.md',
  'docs/SECURITY.md',
  'docs/WORKFLOW_RELIABILITY.md',
  'public/dashboard.js',
  'public/docs/AUTO_APPROVE_EXTENSION.md',
  'public/extensions/chrome-auto-approve/popup.html'
];

const riskyPatterns = [
  { label: 'advanced', pattern: /\badvanced\b/i },
  { label: 'high trust', pattern: /\bhigh[- ]trust\b/i },
  { label: 'aggressive', pattern: /\baggressive\b/i },
  { label: 'dangerous', pattern: /\bdangerous\b/i },
  { label: 'fast path', pattern: /\bfast path\b/i },
  { label: 'live workspace', pattern: /\blive workspace\b/i },
  { label: 'live repo mutation', pattern: /\blive repo mutation\b/i },
  { label: 'arbitrary command', pattern: /\barbitrary command\b/i },
  { label: 'execute shell', pattern: /\bexecute shell\b/i },
  { label: 'unrestricted', pattern: /\bunrestricted\b/i },
  { label: 'bypass', pattern: /\bbypass\b/i },
  { label: 'local agent', pattern: /\blocal agent\b/i },
  { label: 'trusted mode', pattern: /\btrusted mode\b/i },
  { label: 'fast mode', pattern: /\bfast mode\b/i },
  { label: 'fast task', pattern: /\bfast task\b/i },
  { label: 'auto approve writes', pattern: /\bauto[- ]approve writes\b/i }
];

const allowlist = [
  // Historical explanation in README is allowed only if not connector-facing copy.
  { file: 'README.md', pattern: /did not have Codex/i }
];

const findings = [];

for (const relativePath of scannedFiles) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    findings.push({ file: relativePath, line: 0, label: 'missing-file', text: 'Expected connector-facing file is missing.' });
    continue;
  }

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((lineText, index) => {
    for (const item of riskyPatterns) {
      if (!item.pattern.test(lineText)) continue;
      if (isAllowed(relativePath, lineText)) continue;
      findings.push({ file: relativePath, line: index + 1, label: item.label, text: lineText.trim() });
    }
  });
}

if (findings.length) {
  console.error('Connector wording smoke test failed. Replace risk-tier wording with neutral workspace-tool wording.');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: [${finding.label}] ${finding.text}`);
  }
  process.exit(1);
}

// Check relai_run_checks description wording
const toolsSource = fs.readFileSync(path.join(root, 'src', 'tools.js'), 'utf8');
const runChecksMatch = toolsSource.match(/tool\("relai_run_checks",\s*"[^"]*",\s*"([^"]+)"/);
const runChecksDescription = runChecksMatch ? runChecksMatch[1] : '';

const forbiddenInRunChecks = ['shell', 'execute', 'arbitrary', 'command runner', 'terminal command'];
const descriptionFindings = [];
for (const forbidden of forbiddenInRunChecks) {
  if (runChecksDescription.toLowerCase().includes(forbidden.toLowerCase())) {
    descriptionFindings.push(`relai_run_checks description contains forbidden word: "${forbidden}" — found in: "${runChecksDescription}"`);
  }
}
if (!runChecksDescription.toLowerCase().includes('validation checks')) {
  descriptionFindings.push(`relai_run_checks description must contain "validation checks" — got: "${runChecksDescription}"`);
}

if (descriptionFindings.length) {
  console.error('Connector wording smoke test failed. relai_run_checks description wording issue:');
  for (const msg of descriptionFindings) {
    console.error(`  ${msg}`);
  }
  process.exit(1);
}

console.log(`Connector wording smoke test passed. Scanned ${scannedFiles.length} files.`);

function isAllowed(file, lineText) {
  return allowlist.some((item) => item.file === file && item.pattern.test(lineText));
}
