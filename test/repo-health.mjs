import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = packageJson.scripts || {};
const ciDir = path.join(root, '.github', 'workflows');
const failures = [];

if (packageJson.engines?.node !== '>=22.13.0') {
  failures.push(`package.json must declare the supported Node.js minimum as >=22.13.0; got ${packageJson.engines?.node || 'none'}`);
}

const ciWorkflowPath = path.join(ciDir, 'ci.yml');
if (fs.existsSync(ciWorkflowPath)) {
  const ciWorkflow = fs.readFileSync(ciWorkflowPath, 'utf8');
  if (!/node-version:\s*\[22,\s*24\]/.test(ciWorkflow)) {
    failures.push('CI must test the supported Node.js 22 and 24 LTS lines.');
  }
  if (/node-version:\s*\[[^\]]*\b(?:18|20)\b/.test(ciWorkflow)) {
    failures.push('CI must not block updates on end-of-life Node.js 18 or 20 jobs.');
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.ya?ml$/i.test(entry.name)) out.push(full);
  }
  return out;
}

for (const file of walk(ciDir)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/uses:\s*actions\/(checkout|setup-node)@v(\d+)/g)) {
    const [, action, majorText] = match;
    const major = Number(majorText);
    if (major < 5) {
      failures.push(`${path.relative(root, file)} uses actions/${action}@v${major}, which still targets deprecated Node.js 20.`);
    }
  }
  for (const match of text.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
    const script = match[1];
    if (!scripts[script]) {
      failures.push(`${path.relative(root, file)} references missing npm script: ${script}`);
    }
  }
}

const sourceLineBudgets = {
  'src/localRepoBridge.js': 900,
  'src/bridge/browser.js': 150,
  'src/bridge/patch.js': 450,
  'src/bridge/review.js': 140,
  'src/bridge/restore.js': 140,
  'src/bridge/searchContext.js': 330,
  'src/bridge/codeIntelligence.js': 430,
  'src/bridge/codeIndex.js': 200,
  'src/bridge/tidy.js': 320,
  'src/bridge/validation.js': 240,
  'src/bridge/checkDetection.js': 140,
  'src/repo/gitStatus.js': 180,
  'src/bridge/writeGuidance.js': 180,
  'src/tools.js': 180,
  'src/tools/registry.js': 520,
  'src/tools/schema.js': 120,
  'src/tools/handlers.js': 180,
  'src/tools/connector.js': 180,
  'src/tools/errors.js': 120,
  'src/tools/session.js': 220,
  'src/tools/status.js': 360,
  'src/mcpServer.js': 220,
  'src/taskEvents.js': 80,
  'src/projectInstructions.js': 180,
  'src/httpServer.js': 300,
  'src/http/dashboard.js': 400,
  'src/http/dashboardHistory.js': 80,
  'src/http/mcp.js': 255,
  'src/http/io.js': 220,
  'src/http/auth.js': 120,
  'electron/main.js': 500,
  'electron/app-updater.js': 240,
  'electron/app-updater-state.js': 140,
  'electron/desktop-settings.js': 70,
  'electron/desktop-lifecycle.js': 210,
  'electron/dashboard-window.js': 220,
  'electron/ipc-handlers.js': 100,
  'electron/launcher-config.js': 100,
  'electron/ngrok-token.js': 30,
  'electron/window-size.js': 100,
  'electron/resource-path.js': 50,
  'src/ui/workspace-input.js': 60,
  'src/ui/features/workspaces/index.js': 40,
  'src/ui/features/workspaces/cards.js': 240,
  'src/ui/features/workspaces/actions.js': 280,
  'src/ui/features/settings/desktop-updates.js': 200,
  'src/ui/features/settings/desktop-startup.js': 110
};

for (const [relativePath, maxLines] of Object.entries(sourceLineBudgets)) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    failures.push(`Missing architecture module: ${relativePath}`);
    continue;
  }
  const lineCount = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
  if (lineCount > maxLines) {
    failures.push(`${relativePath} has ${lineCount} lines; architecture budget is ${maxLines}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log('Repo health checks passed.');
