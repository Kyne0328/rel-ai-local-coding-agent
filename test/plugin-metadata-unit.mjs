import assert from 'node:assert/strict';

import { parseOpenAiAgentMetadata } from '../scripts/validate-plugin.mjs';

const errors = [];
const metadata = parseOpenAiAgentMetadata(`interface:
  display_name: "Rel.AI Workflow"
  short_description: "Fast repository orchestration"
  default_prompt: "Use $rel-ai-workflow for repository work."
dependencies:
  tools:
    - type: "mcp"
      value: "rel-ai-mcp"
      description: "Local Rel.AI MCP runtime"
      transport: "streamable_http"
      url: "https://example.invalid/mcp"
`, errors, 'fixture/agents/openai.yaml');

assert.deepEqual(errors, []);
assert.equal(metadata.interface.display_name, 'Rel.AI Workflow');
assert.deepEqual(metadata.dependencies.tools, [{
  type: 'mcp',
  value: 'rel-ai-mcp',
  description: 'Local Rel.AI MCP runtime',
  transport: 'streamable_http',
  url: 'https://example.invalid/mcp'
}]);

const invalidErrors = [];
parseOpenAiAgentMetadata(`interface:
  display_name: "Bad"
  short_description: "Bad"
  default_prompt: "Bad"
dependencies:
  tools:
    - type: "other"
      value: ""
      surprise: "no"
`, invalidErrors, 'invalid/agents/openai.yaml');
assert.ok(invalidErrors.some(error => /type must be 'mcp'/i.test(error)));
assert.ok(invalidErrors.some(error => /value must be a non-empty/i.test(error)));
assert.ok(invalidErrors.some(error => /unsupported field 'surprise'/i.test(error)));

console.log('Current OpenAI skill interface and optional MCP dependency metadata parsing passed.');
