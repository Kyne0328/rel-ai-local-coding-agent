import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cleanupTemporarySkillDirectory,
  discoverSkillPackages,
  installSkillPackages,
  listSkillLibrary,
  parseGitHubRepositoryUrl,
  readSkillResource
} from '../src/skillLibrary.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-skill-library-'));
const sourceRoot = path.join(temp, 'source');
const stateDir = path.join(temp, 'state');
const config = { stateDir, workspaces: {} };

try {
  writeSkill('skills/alpha', `---\nname: alpha\ndescription: Alpha skill description used to verify frontmatter discovery and installation behavior.\n---\n\n# Alpha\n`, {
    'references/guide.md': '# Alpha guide\nUse the alpha workflow.\n'
  });
  writeSkill('nested/beta', '# Beta\nNo frontmatter here.\n');

  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/example/agent-skills'), {
    owner: 'example', repo: 'agent-skills', repository: 'example/agent-skills',
    repositoryUrl: 'https://github.com/example/agent-skills'
  });

  let cleanupOptions = null;
  const cleanupError = Object.assign(new Error('temporary directory is locked'), { code: 'EPERM' });
  assert.equal(cleanupTemporarySkillDirectory('locked-temp', (_directory, options) => {
    cleanupOptions = options;
    throw cleanupError;
  }), false, 'temporary clone cleanup must never replace the completed skill operation');
  assert.equal(cleanupOptions.maxRetries, 5);
  assert.equal(cleanupOptions.retryDelay, 100);

  const discovered = discoverSkillPackages(sourceRoot, { sourceType: 'github', repository: 'example/agent-skills' });
  assert.deepEqual(discovered.map(skill => skill.key), ['nested/beta', 'skills/alpha']);
  assert.equal(discovered.find(skill => skill.key === 'skills/alpha').name, 'alpha');
  assert.equal(discovered.find(skill => skill.key === 'nested/beta').name, 'beta');

  const installed = installSkillPackages(config, {
    sourceType: 'github',
    repository: 'example/agent-skills',
    repositoryUrl: 'https://github.com/example/agent-skills',
    revision: 'abc123'
  }, sourceRoot, ['skills/alpha']);
  assert.equal(installed.installed.length, 1);
  assert.equal(installed.installed[0].id, 'github:example/agent-skills:skills/alpha');

  const library = listSkillLibrary(config);
  assert.ok(library.builtIn.some(skill => skill.id === 'builtin:rel-ai-workflow'));
  assert.deepEqual(library.installed.map(skill => skill.id), ['github:example/agent-skills:skills/alpha']);

  const reference = readSkillResource(config, 'github:example/agent-skills:skills/alpha', 'references/guide.md');
  assert.match(reference.text, /alpha workflow/);
  assert.throws(
    () => readSkillResource(config, 'github:example/agent-skills:skills/alpha', '../outside.txt'),
    /inside the skill package/i
  );

  console.log('Central skill library discovery, selective install, and resource containment passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

function writeSkill(relative, skillMd, files = {}) {
  const root = path.join(sourceRoot, ...relative.split('/'));
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, relative.endsWith('beta') ? 'skill.md' : 'SKILL.md'), skillMd);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
