import assert from 'node:assert/strict';

import { enhanceToolError } from "../src/tools.js";
import { serializeToolError } from "../src/tools/errors.js";

assert.ok(typeof enhanceToolError === 'function');
assert.ok(typeof serializeToolError === 'function');

{
  const error = enhanceToolError('relai_edit', new Error('relai_edit operation 1 found 0 matches in lib/foo.dart.'));
  assert.match(error.message, /relai_read/);
  assert.match(error.message, /relai_edit with content/);
}

{
  const error = enhanceToolError('relai_edit', new Error('relai_edit operation 1 found 5 matches in lib/foo.dart.'));
  assert.match(error.message, /occurrence/);
}

{
  const error = enhanceToolError('relai_edit', new Error('ValueError: Invalid IPv6 URL'));
  assert.match(error.message, /content, updateText/);
}

for (const message of ['error: corrupt patch at line 24', 'Patch did not contain any valid workspace file paths.']) {
  const error = enhanceToolError('relai_edit', new Error(message));
  assert.match(error.message, /Git unified diff/);
  assert.match(error.message, /structured OpenAI patch format/);
}

{
  const error = enhanceToolError('relai_edit', new Error('OpenAI patch context mismatch.'));
  assert.match(error.message, /Re-read the file/);
}

{
  const original = new Error('Something else entirely.');
  assert.equal(enhanceToolError('relai_run_checks', original), original);
}

{
  const restricted = new Error('Path touches a blocked sensitive path: .env');
  restricted.code = 'SENSITIVE_PATH_RESTRICTED';
  restricted.source = 'rel-ai-mcp-policy';
  restricted.path = '.env';
  restricted.fileClass = 'secret_bearing_path';
  restricted.retryable = false;
  restricted.requiresUserConfirmation = false;
  restricted.allowedAlternatives = ['Use .env.example.'];
  const payload = serializeToolError('relai_read', restricted);
  assert.equal(payload.errorCode, 'SENSITIVE_PATH_RESTRICTED');
  assert.equal(payload.errorDetails.source, 'rel-ai-mcp-policy');
  assert.equal(payload.errorDetails.operation, 'read');
  assert.equal(payload.errorDetails.path, '.env');
  assert.deepEqual(payload.errorDetails.allowedAlternatives, ['Use .env.example.']);
}

{
  const launch = new Error('ChatGPT session is not authenticated.', { cause: new Error('hidden token=super-secret C:/private/profile') });
  launch.code = 'CHATGPT_LOGIN_REQUIRED';
  launch.source = 'rel-ai-mcp';
  launch.operation = 'agent_launch';
  launch.agentId = `agent_${'x'.repeat(43)}`;
  launch.allowedAlternatives = ['Open Settings > ChatGPT Subagents.'];
  const payload = serializeToolError('relai_agent', launch);
  assert.equal(payload.errorDetails.operation, 'agent_launch');
  assert.equal(payload.errorDetails.agentId, launch.agentId);
  assert.deepEqual(payload.errorDetails.allowedAlternatives, ['Open Settings > ChatGPT Subagents.']);
  assert.doesNotMatch(JSON.stringify(payload), /super-secret|private\/profile/);
}

console.log('Error enhancer unit tests passed for active tools.');
