import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readConfig, writeConfig } from '../src/config.js';
import { installSkillPackages } from '../src/skillLibrary.js';
import { applySkillsAction, skillsPayload } from '../src/http/dashboardActions.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-skills-'));
const repo = path.join(temp, 'workspace');
const sourceRoot = path.join(temp, 'source');
const skillRoot = path.join(sourceRoot, 'skills', 'demo');
const configPath = path.join(temp, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;

try {
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: demo\ndescription: Demo skill used to verify dashboard skill assignment and removal behavior.\n---\n\n# Demo\n');
  process.env.REL_AI_MCP_CONFIG = configPath;
  writeConfig({
    version: 3,
    stateDir: path.join(temp, 'state'),
    workspaces: {
      one: { path: repo, skills: [] },
      two: { path: repo, skills: [] }
    }
  });
  let config = readConfig();
  installSkillPackages(config, {
    sourceType: 'github', repository: 'example/demo', repositoryUrl: 'https://github.com/example/demo', revision: 'abc'
  }, sourceRoot, ['skills/demo']);

  let payload = skillsPayload(readConfig());
  assert.equal(payload.ok, true);
  assert.ok(payload.builtIn.some(skill => skill.id === 'builtin:rel-ai-workflow'));
  assert.deepEqual(payload.installed.map(skill => skill.id), ['github:example/demo:skills/demo']);
  assert.deepEqual(payload.workspaces.map(item => item.alias), ['one', 'two']);

  const installedId = 'github:example/demo:skills/demo';
  const assigned = await applySkillsAction(readConfig(), {
    action: 'set_workspace_skills', workspace: 'one', skills: ['builtin:rel-ai-workflow', installedId, installedId]
  });
  assert.deepEqual(assigned.workspaces.find(item => item.alias === 'one').skills, ['builtin:rel-ai-workflow', installedId]);
  assert.deepEqual(assigned.workspaces.find(item => item.alias === 'two').skills, []);

  await assert.rejects(
    () => applySkillsAction(readConfig(), { action: 'set_workspace_skills', workspace: 'one', skills: ['missing:skill'] }),
    /Unknown skill/i
  );
  await assert.rejects(
    () => applySkillsAction(readConfig(), { action: 'preview_github', repositoryUrl: 'https://example.com/not/github' }),
    /GitHub repository URL/i
  );

  const removed = await applySkillsAction(readConfig(), { action: 'remove_installed', skillId: installedId });
  assert.equal(removed.removed, true);
  assert.equal(removed.installed.length, 0);
  assert.deepEqual(removed.workspaces.find(item => item.alias === 'one').skills, ['builtin:rel-ai-workflow']);

  console.log('Dashboard skills payload, assignment, action dispatch, and removal cleanup passed.');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(temp, { recursive: true, force: true });
}
