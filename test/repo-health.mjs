import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = packageJson.scripts || {};
const ciDir = path.join(root, '.github', 'workflows');
const failures = [];

if (packageJson.engines?.node !== '>=24.0.0 <25') {
  failures.push(`package.json must require the Node.js 24 LTS line; got ${packageJson.engines?.node || 'none'}`);
}
if (packageJson.engines?.npm !== '>=11.0.0 <12') {
  failures.push(`package.json must require npm 11; got ${packageJson.engines?.npm || 'none'}`);
}
if (packageJson.packageManager !== 'npm@11.9.0') {
  failures.push(`package.json must pin npm@11.9.0; got ${packageJson.packageManager || 'none'}`);
}

const ciWorkflowPath = path.join(ciDir, 'ci.yml');
if (fs.existsSync(ciWorkflowPath)) {
  const ciWorkflow = fs.readFileSync(ciWorkflowPath, 'utf8');
  if (!/node-version:\s*24/.test(ciWorkflow)) {
    failures.push('CI must test the required Node.js 24 LTS line.');
  }
  if (/node-version:\s*(?:\[[^\]]*\b(?:18|20|22)\b|(?:18|20|22)\b)/.test(ciWorkflow)) {
    failures.push('Required CI jobs must not use Node.js versions older than the Node 24 runtime policy.');
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
  for (const match of text.matchAll(/uses:\s*actions\/(checkout|setup-node|upload-artifact|attest-build-provenance|attest-sbom)@([^\s#]+)/g)) {
    const [, action, reference] = match;
    if (!/^[a-f0-9]{40}$/.test(reference)) {
      failures.push(`${path.relative(root, file)} must pin actions/${action} to an immutable commit SHA.`);
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
  'src/tools/actionDefinitions.js': 800,
  'src/tools/actionCatalog.js': 400,
  'src/tools/schema.js': 120,
  'src/tools/handlers.js': 180,
  'src/tools/connector.js': 180,
  'src/tools/errors.js': 120,
  'src/tools/session.js': 220,
  'src/tools/status.js': 360,
  'src/mcpServer.js': 220,
  // One browser-safe owner for event identity, timestamps, and ordering mechanics.
  'src/taskEvents.js': 125,
  'src/projectInstructions.js': 180,
  'src/httpServer.js': 300,
  'src/http/dashboard.js': 400,
  'src/http/dashboardHistory.js': 80,
  'src/http/mcp.js': 255,
  'src/http/io.js': 220,
  'src/http/auth.js': 120,
  // Electron remains the composition root; resource behavior lives in owned modules.
  'electron/main.js': 520,
  'electron/app-updater.js': 240,
  'electron/app-updater-state.js': 140,
  'electron/desktop-settings.js': 70,
  'electron/desktop-lifecycle.js': 210,
  // One resource owner covers window creation, security, navigation, bounds, and chrome events.
  'electron/dashboard-window.js': 260,
  // One registration file composes eight narrow capability groups and the exact 33-channel contract.
  'electron/ipc-handlers.js': 300,
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
