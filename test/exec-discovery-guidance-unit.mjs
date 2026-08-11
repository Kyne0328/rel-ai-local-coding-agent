import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('contracts/cloud/mcp-manifest.json', 'utf8'));
assert.equal(manifest.toolSurfaceVersion, 35);
const tool = manifest.tools.find(item => item.name === 'relai_exec');
assert.ok(tool, 'relai_exec must remain present in the public cloud contract');
assert.match(tool.description || '', /Prefer executable \+ argv/i);
assert.match(tool.inputSchema?.description || '', /Prefer direct executable \+ argv mode by default/i);
assert.match(tool.inputSchema?.properties?.command?.description || '', /Do not embed JavaScript, Python, JSON, patches/i);
assert.match(tool.inputSchema?.properties?.executable?.description || '', /shell:false/i);
assert.match(tool.inputSchema?.properties?.argv?.description || '', /without shell parsing/i);
assert.match(tool.inputSchema?.properties?.input?.description || '', /multiline scripts or structured text/i);
console.log('ChatGPT-facing relai_exec first-call direct-mode guidance passed.');