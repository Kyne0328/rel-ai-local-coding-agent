import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { repoSnapshot, relaiReadAsync } from '../src/localRepoBridge.js';
import { discoverSkills, readDiscoveredSkill } from '../src/skillDiscovery.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-skill-discovery-'));
const repo = path.join(root, 'repo');
const userRoot = path.join(root, 'user-skills');
const stateDir = path.join(root, 'state');
const workspace = { alias: 'app', path: repo, commands: {}, testCommands: {} };
const config = { stateDir, workspaces: { app: workspace } };

function writeSkill(base, directory, name, description, body) {
  const target = path.join(base, directory);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, 'utf8');
}

try {
  fs.mkdirSync(repo, { recursive: true });
  writeSkill(path.join(repo, '.agents', 'skills'), 'release', 'release-check', 'Project release checks.', 'Use the project release workflow.');
  writeSkill(userRoot, 'release-user', 'release-check', 'User fallback release checks.', 'User version.');
  writeSkill(userRoot, 'review', 'code-review', 'Review repository changes.', 'Read only.');

  const discovered = discoverSkills(workspace, { userRoot });
  assert.deepEqual(discovered.map(item => item.name), ['code-review', 'release-check']);
  assert.equal(discovered.find(item => item.name === 'release-check').source, 'project', 'project skills must override user skills with the same name');
  assert.equal(discovered.find(item => item.name === 'code-review').path, 'user:code-review', 'user skill discovery must not disclose the home path');

  const userSkill = readDiscoveredSkill(workspace, 'code-review', { userRoot });
  assert.match(userSkill.content, /Read only/);
  assert.match(userSkill.securityBoundary, /not authorization/i);

  const snapshot = await repoSnapshot(workspace, config, { includeFiles: true, maxEntries: 50 });
  assert.ok(snapshot.skills.some(item => item.name === 'release-check' && item.source === 'project'));
  assert.equal(snapshot.files?.some?.(file => String(file).includes('.agents/skills')), false, 'skill implementations must stay out of repository snapshot indexing');

  const loaded = await relaiReadAsync(workspace, config, { skill: 'release-check', maxBytes: 4096 });
  assert.equal(loaded.items[0].type, 'skill');
  assert.match(loaded.items[0].content, /project release workflow/i);
  await assert.rejects(
    () => relaiReadAsync(workspace, config, { skill: 'release-check', paths: ['package.json'] }),
    /cannot be combined/i
  );

  console.log('Dynamic project/user skill discovery, precedence, safe loading, and snapshot tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
