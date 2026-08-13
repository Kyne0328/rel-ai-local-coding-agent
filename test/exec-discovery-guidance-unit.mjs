import assert from 'node:assert/strict';

import { getPublicToolSchemas } from '../src/tools/schema.js';

const tool = getPublicToolSchemas().find(item => item.name === 'relai_exec');
assert.ok(tool, 'relai_exec must remain present in the public MCP contract');
assert.equal(tool.inputSchema?.oneOf, undefined, 'relai_exec must expose a flat connector input schema');
assert.match(tool.description || '', /Prefer executable \+ argv/i);
assert.match(tool.inputSchema?.description || '', /Prefer direct executable \+ argv mode by default/i);
assert.match(tool.inputSchema?.properties?.command?.description || '', /Do not embed JavaScript, Python, JSON, patches/i);
assert.match(tool.inputSchema?.properties?.executable?.description || '', /shell:false/i);
assert.match(tool.inputSchema?.properties?.argv?.description || '', /without shell parsing/i);
assert.match(tool.inputSchema?.properties?.input?.description || '', /multiline scripts or structured text/i);
console.log('ChatGPT-facing relai_exec first-call direct-mode guidance passed.');
