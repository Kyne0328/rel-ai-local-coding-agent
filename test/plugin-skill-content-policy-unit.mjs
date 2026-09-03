import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlugin } from '../scripts/validate-plugin.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-skill-policy-'));
try {
  fs.mkdirSync(path.join(root, 'skills', 'rel-ai-workflow', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'rel-ai-workflow', 'references'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'rel-ai-workflow', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'skills', 'PROVENANCE.md'), '# provenance\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'SKILL.md'), `---\nname: rel-ai-workflow\ndescription: A sufficiently long workflow skill description used only by this plugin validation fixture.\n---\n\nSee references/workflows.md and references/safety.md. A skill may mention curl when that is part of its own instructions.\n`);
  const agentPath = path.join(root, 'skills', 'rel-ai-workflow', 'agents', 'openai.yaml');
  fs.writeFileSync(agentPath, 'interface:\n  display_name: "Fixture"\n  short_description: "Fixture skill"\n  default_prompt: "Use $rel-ai-workflow and curl when the user asks."\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'references', 'workflows.md'), '# workflows\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'references', 'safety.md'), '# safety\n');
  fs.writeFileSync(path.join(root, 'skills', 'rel-ai-workflow', 'scripts', 'helper.js'), 'console.log("helper")\n');

  assert.equal(validatePlugin(root).ok, true);

  fs.writeFileSync(agentPath, '# display_name: Decoy\ninterface:\n  short_description: "Fixture skill"\n  default_prompt: "Use $rel-ai-workflow."\n');
  assert.throws(
    () => validatePlugin(root),
    /interface\.display_name must be a non-empty string/,
    'metadata fields hidden in comments must not satisfy structural validation'
  );

  fs.writeFileSync(agentPath, 'display_name: "Wrong root"\nshort_description: "Fixture skill"\ndefault_prompt: "Use $rel-ai-workflow."\n');
  assert.throws(
    () => validatePlugin(root),
    /must contain an interface root mapping/,
    'flat metadata must not pass when ChatGPT expects the interface mapping'
  );

  fs.writeFileSync(agentPath, 'interface:\n  display_name: "Fixture"\n  display_name: "Duplicate"\n  short_description: "Fixture skill"\n  default_prompt: "Use $rel-ai-workflow."\n');
  assert.throws(
    () => validatePlugin(root),
    /duplicate key 'display_name'/,
    'duplicate YAML metadata keys must be rejected instead of silently winning'
  );

  console.log('Skill package validation structurally validates agent metadata.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

