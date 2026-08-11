import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FORBIDDEN_PUBLIC_NAMES = [
  'relai_begin_work', 'relai_repo_snapshot', 'relai_code_inspect', 'relai_run_checks',
  'relai_http_probe', 'relai_diff', 'relai_restore_paths', 'relai_reset_workspace',
  'relai_status', 'relai_git_commit', 'relai_git_push', 'relai_git_draft_pr',
  'relai_tidy_plan', 'relai_tidy_run', 'relai_finish_work'
];

const PUBLIC_GUIDANCE_FILES = [
  /^README\.md$/,
  /^RELEASE\.md$/,
  /^docs\/.*\.md$/,
  /^examples\/.*\.(?:json|md)$/,
  /^skills\/.*\.md$/,
  /^\.agents\/.*\.md$/
];

const IMMUTABLE_HISTORY = new Set([
  'CHANGELOG.md'
]);

const TARGETED_RUNTIME_GUIDANCE = new Set([
  'src/bridge/codeIntelligence.js', 'src/bridge/search.js', 'src/bridge/validation.js',
  'src/bridge/validationPlan.js', 'src/bridge/writeGuidance.js', 'src/localRepoBridge.js',
  'src/processManager.js', 'src/release.js', 'src/toolActivity.js', 'src/tools/actionDefinitions.js',
  'src/tools/completion.js', 'src/tools/task.js', 'src/ui/features/onboarding/index.js'
]);

function trackedFiles(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}

function auditRepositoryStaleness({ root = process.cwd() } = {}) {
  const findings = [];
  let scannedFiles = 0;
  for (const relative of trackedFiles(root)) {
    if (IMMUTABLE_HISTORY.has(relative)) continue;
    const publicGuidance = PUBLIC_GUIDANCE_FILES.some((rule) => rule.test(relative));
    const runtimeGuidance = TARGETED_RUNTIME_GUIDANCE.has(relative);
    if (!publicGuidance && !runtimeGuidance) continue;
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    if (text.includes('\0')) continue;
    scannedFiles += 1;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (publicGuidance && /0\.23\.[0-9]+/.test(line)) findings.push(finding(relative, index, 'stale-version', line));
      if (publicGuidance && /(?:30|33)[- ]tool|exposes 30 callable tools|executes every test file|Windows x64 only/i.test(line)) findings.push(finding(relative, index, 'stale-claim', line));
      if (publicGuidance) {
        for (const name of FORBIDDEN_PUBLIC_NAMES) {
          if (line.includes(name)) findings.push(finding(relative, index, 'removed-public-tool', line, name));
        }
      }
    }
  }
  return { findings, scannedFiles };
}

function finding(file, index, rule, text, match = '') {
  return { file, line: index + 1, rule, match, text: text.trim() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const result = auditRepositoryStaleness();
  if (result.findings.length) {
    for (const item of result.findings) console.error(`${item.file}:${item.line} [${item.rule}] ${item.text}`);
    process.exitCode = 1;
  } else {
    console.log(`Repository staleness audit passed across ${result.scannedFiles} tracked guidance files.`);
  }
}

export { auditRepositoryStaleness, FORBIDDEN_PUBLIC_NAMES };

