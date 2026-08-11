import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeConfig, resolveWorkspace } from '../src/config.js';
import { updateWorkspace } from '../src/configEditor.js';
import { repoSnapshot } from '../src/localRepoBridge.js';
import { taskBootstrapFromSnapshot } from '../src/tools/task.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workspace-skills-'));
const root = path.join(temp, 'repo');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');

const previousConfig = process.env.REL_AI_MCP_CONFIG;
const configPath = path.join(temp, 'config.json');
process.env.REL_AI_MCP_CONFIG = configPath;

try {
  const normalized = normalizeConfig({
    version: 3,
    stateDir: path.join(temp, 'state'),
    workspaces: {
      repo: { path: root, skills: ['builtin:rel-ai-workflow'] }
    }
  });
  assert.deepEqual(normalized.workspaces.repo.skills, ['builtin:rel-ai-workflow']);

  fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2));
  const updated = updateWorkspace(normalized, {
    action: 'upsert',
    alias: 'repo',
    workspaceConfig: { skills: ['builtin:rel-ai-debugging'] }
  });
  assert.deepEqual(updated.config.workspaces.find(item => item.alias === 'repo').skills, ['builtin:rel-ai-debugging']);

  const runtimeConfig = normalizeConfig({
    ...normalized,
    workspaces: { repo: { ...normalized.workspaces.repo, skills: ['builtin:rel-ai-workflow'] } }
  });
  const workspace = resolveWorkspace(runtimeConfig, 'repo');
  const snapshot = await repoSnapshot(workspace, runtimeConfig, { maxEntries: 20, includeFiles: false });
  assert.equal(snapshot.workspaceSkills.length, 1);
  assert.equal(snapshot.workspaceSkills[0].id, 'builtin:rel-ai-workflow');
  assert.match(snapshot.workspaceSkills[0].content, /routing and work-session ownership skill/i);

  const bootstrap = taskBootstrapFromSnapshot(snapshot, 'compact');
  assert.deepEqual(bootstrap.workspaceSkills, snapshot.workspaceSkills);

  console.log('Workspace skill assignment and runtime bootstrap projection passed.');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(temp, { recursive: true, force: true });
}
