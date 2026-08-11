import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installSkillPackages } from '../src/skillLibrary.js';
import { listResources, readResource } from '../src/resources.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-skill-resources-'));
const source = path.join(temp, 'source', 'skills', 'demo');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const previous = process.env.REL_AI_MCP_CONFIG;

try {
  fs.mkdirSync(path.join(source, 'references'), { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: demo\ndescription: Demo resource skill used to verify package-relative MCP resource access.\n---\n\n# Demo\n');
  fs.writeFileSync(path.join(source, 'references', 'guide.md'), '# Guide\nRead this on demand.\n');
  const config = { version: 3, stateDir, workspaces: {} };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  process.env.REL_AI_MCP_CONFIG = configPath;
  installSkillPackages(config, {
    sourceType: 'github', repository: 'example/demo', repositoryUrl: 'https://github.com/example/demo', revision: '1234'
  }, path.join(temp, 'source'), ['skills/demo']);

  const id = 'github:example/demo:skills/demo';
  assert.ok(listResources().resources.some(resource => resource.uri === 'relai://skills'));
  const library = JSON.parse(readResource('relai://skills').contents[0].text);
  assert.ok(library.installed.some(skill => skill.id === id));

  const uri = `relai://skill/${encodeURIComponent(id)}/file/${encodeURIComponent('references/guide.md')}`;
  const resource = readResource(uri);
  assert.match(resource.contents[0].text, /Read this on demand/);

  console.log('Skill library and package-relative MCP resources passed.');
} finally {
  if (previous == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previous;
  fs.rmSync(temp, { recursive: true, force: true });
}
