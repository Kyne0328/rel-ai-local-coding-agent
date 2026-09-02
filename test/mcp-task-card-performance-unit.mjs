import assert from 'node:assert/strict';

import { listResources } from '../src/resources.js';
import { getPublicToolSchemas } from '../src/tools/schema.js';

const tools = getPublicToolSchemas();
const work = tools.find(tool => tool.name === 'relai_work');
const iframeTools = tools.filter(tool => tool._meta?.ui?.resourceUri || tool._meta?.['openai/outputTemplate']);

assert.equal(tools.length, 12, 'ChatGPT status performance must keep the canonical 12-tool MCP surface');
assert.equal(tools.some(tool => tool.name.startsWith('relai_app_')), false, 'status presentation must not register an app-only helper');
assert.deepEqual(iframeTools.map(tool => tool.name), [], 'normal Rel.AI tools must not mount ChatGPT iframes');
assert.deepEqual([
  work?._meta?.['openai/toolInvocation/invoking'],
  work?._meta?.['openai/toolInvocation/invoked']
], ['Updating Rel.AI task…', 'Rel.AI task updated'], 'relai_work must retain lightweight native ChatGPT status labels');
assert.equal(
  listResources({ workspaces: {} }).resources.some(resource => String(resource.uri || '').startsWith('ui://relai/')),
  false,
  'resource discovery must not advertise an unused ChatGPT iframe component'
);

const simulatedStatusCalls = 10_000;
const iframeMountEligibleCalls = work?._meta?.ui?.resourceUri || work?._meta?.['openai/outputTemplate'] ? simulatedStatusCalls : 0;
assert.equal(iframeMountEligibleCalls, 0, 'repeated relai_work status calls must remain ineligible for iframe mounting');

console.log('ChatGPT status performance contract passed: native labels stay visible with zero Rel.AI iframe mounts.');
