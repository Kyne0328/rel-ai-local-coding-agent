import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlugin } from '../scripts/validate-plugin.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-skill-policy-'));
try {
  fs.mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'rel-ai-workflow', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'rel-ai-workflow', 'references'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'rel-ai-workflow', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'node', args: ['./index.js'], cwd: '.' } } }));
  fs.writeFileSync(path.join(root, 'index.js'), '');
  fs.writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', description: 'fixture', author: { name: 'test' },
    skills: './skills/', mcpServers: './.mcp.json', interface: { displayName: 'Fixture', shortDescription: 'Fixture' }
  }));
  fs.writeFileSync(path.join(root, 'skills', 'PROVENANCE.md'), '# provenance\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'SKILL.md'), `---\nname: rel-ai-workflow\ndescription: A sufficiently long workflow skill description used only by this plugin validation fixture.\n---\n\nSee references/workflows.md and references/safety.md. A skill may mention curl when that is part of its own instructions.\n`);
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'agents', 'openai.yaml'), 'display_name: Fixture\nshort_description: Fixture skill\ndefault_prompt: Use $rel-ai-workflow and curl when the user asks.\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'references', 'workflows.md'), '# workflows\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'references', 'safety.md'), '# safety\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'scripts', 'helper.js'), 'console.log("helper")\n');

  assert.equal(validatePlugin(root, { requireDirectoryName: false }).ok, true);
  console.log('Plugin validation accepts user-authored skill package contents.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

