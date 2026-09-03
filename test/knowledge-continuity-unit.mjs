import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildTaskContinuity } from '../src/context/taskContinuity.js';
import {
  addKnowledgeItem,
  knowledgeSummary,
  learnFromCompletedTask,
  listProcedures,
  promoteProcedureToSkill,
  searchKnowledge,
  searchVerifiedProcedures
} from '../src/knowledgeStore.js';
import { flushTaskHistoryPersistence, readTaskHistorySessionRecord } from '../src/taskHistoryStore.js';
import { resetToolActivity } from '../src/toolActivity.js';
import { callTool as rawCallTool } from '../src/tools.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { discoverSkills } from '../src/skillDiscovery.js';
import { stateExport, stateImport } from '../src/productUx.js';

const callTool = (name, args, context = {}) => rawCallTool(name, args, { principal: 'local:trusted', ...context });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-knowledge-continuity-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;

fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
  name: 'knowledge-continuity-fixture',
  scripts: { check: 'node --check src/index.js' }
}, null, 2));
fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'export const value = 1;\n');
execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'relai@example.test'], { cwd: workspace });
execFileSync('git', ['config', 'user.name', 'RelAI Test'], { cwd: workspace });
execFileSync('git', ['add', '.'], { cwd: workspace });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: workspace, stdio: 'ignore' });

const config = {
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  knowledge: { enabled: true, proceduralLearning: true, maxBootstrapBytes: 1024 },
  workspaces: {
    app: {
      path: workspace,
      commands: { check: 'node --check src/index.js' },
      testCommands: {}
    }
  }
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;
resetToolActivity();

try {
  addKnowledgeItem(config, { content: 'alpha shared global fact', scope: 'global' });
  addKnowledgeItem(config, { content: 'alpha app fact', scope: 'workspace', workspace: 'app' });
  addKnowledgeItem(config, { content: 'alpha other project fact', scope: 'workspace', workspace: 'other' });

  const scoped = searchKnowledge(config, 'alpha', { workspace: 'app', limit: 6, maxBytes: 4096 });
  assert(scoped.some(item => item.content.includes('shared global')));
  assert(scoped.some(item => item.content.includes('app fact')));
  assert(!scoped.some(item => item.content.includes('other project')));

  for (let index = 0; index < 8; index += 1) {
    addKnowledgeItem(config, { content: `alpha bounded ${index} ${'x'.repeat(160)}`, scope: 'global' });
  }
  const bounded = buildTaskContinuity(config, { workspace: 'app', query: 'alpha' });
  assert(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 1024, 'continuity bootstrap must respect the configured byte cap');

  const portableSource = {
    ...config,
    stateDir: path.join(temp, 'portable-source')
  };
  const portableRestored = {
    ...config,
    stateDir: path.join(temp, 'portable-restored')
  };
  addKnowledgeItem(portableSource, { content: 'portable sqlite marker', scope: 'global' });
  const statePayload = stateExport(portableSource).export;
  const sqliteExport = statePayload.files.find(item => item.path === 'knowledge/knowledge.sqlite');
  assert.equal(statePayload.version, 2);
  assert.equal(sqliteExport?.encoding, 'base64', 'binary knowledge databases must be exported losslessly');
  stateImport(portableRestored, { confirm: true, payload: statePayload });
  assert(searchKnowledge(portableRestored, 'portable sqlite', { workspace: 'app', maxBytes: 4096 }).some(item => item.content.includes('portable sqlite marker')));

  const context = { publicHttpOnly: true, conversationId: 'knowledge-continuity-chat' };
  const first = await callTool('relai_work', {
    action: 'begin',
    workspace: 'app',
    title: 'Remember continuity marker',
    objective: 'Remember continuity marker',
    contextSummary: 'Host capsule alpha',
    bootstrap: 'compact'
  }, context);
  assert.equal(first.bootstrap.hostContextSummary, 'Host capsule alpha');
  await callTool('relai_work', {
    action: 'finish',
    workspace: 'app',
    work_id: first.work_id,
    summary: 'Continuity marker stored.'
  }, context);
  await flushTaskHistoryPersistence();

  const stored = readTaskHistorySessionRecord(config, first.work_id, { reconcileInactive: false });
  assert.equal(stored?.contextSummary, 'Host capsule alpha');
  assert.equal(stored?.correlation?.conversationId, 'knowledge-continuity-chat');
  const status = await callTool('relai_work', { action: 'status', workspace: 'app', work_id: first.work_id }, context);
  assert.equal(status.task?.hostContextSummary, 'Host capsule alpha');

  const second = await callTool('relai_work', {
    action: 'begin',
    workspace: 'app',
    title: 'Continue continuity marker',
    objective: 'Continue continuity marker',
    contextSummary: 'Host capsule beta',
    bootstrap: 'compact'
  }, context);
  assert.equal(second.bootstrap.hostContextSummary, 'Host capsule beta');
  assert(second.bootstrap.conversationContinuity?.some(item => item.goal?.includes('Remember continuity marker')));
  assert(second.bootstrap.conversationContinuity?.every(item => !('workId' in item) && !('workspace' in item)));
  await callTool('relai_work', { action: 'cancel', workspace: 'app', work_id: second.work_id, reason: 'continuity regression complete' }, context);

  async function runProcedureTask(from, to) {
    const task = await callTool('relai_work', {
      action: 'begin',
      workspace: 'app',
      title: 'Fix alpha syntax flow',
      objective: 'Fix alpha syntax flow safely',
      bootstrap: 'none'
    }, context);
    await callTool('relai_search', { action: 'text', workspace: 'app', work_id: task.work_id, pattern: 'value', glob: 'src/**', maxResults: 10 }, context);
    await callTool('relai_read', { workspace: 'app', work_id: task.work_id, paths: ['src/index.js'] }, context);
    await callTool('relai_edit', {
      workspace: 'app',
      work_id: task.work_id,
      path: 'src/index.js',
      oldText: `export const value = ${from};`,
      newText: `export const value = ${to};`
    }, context);
    const completed = await callTool('relai_validate', {
      action: 'checks',
      workspace: 'app',
      work_id: task.work_id,
      check: 'node --check src/index.js',
      complete: true,
      summary: `Updated value from ${from} to ${to} and validated syntax.`
    }, context);
    assert.equal(completed.completionKnown, true);
    assert.equal(completed.validationStatus, 'passed');
    await flushTaskHistoryPersistence();
  }

  const collisionConfig = {
    ...config,
    stateDir: path.join(temp, 'collision-state')
  };
  const collisionBase = {
    workspace: 'app',
    intent: 'bugfix',
    events: [{ operation: 'search.text' }, { operation: 'read' }, { operation: 'edit' }],
    workflowEvidence: [{ command: 'node --check src/index.js' }],
    changedFiles: ['src/index.js']
  };
  learnFromCompletedTask(collisionConfig, 'app', { ...collisionBase, id: 'collision-a', objective: 'Fix login redirect bug' }, {
    work_id: 'collision-a', validationStatus: 'passed', changedFiles: ['src/index.js']
  });
  learnFromCompletedTask(collisionConfig, 'app', { ...collisionBase, id: 'collision-b', objective: 'Update invoice rounding behavior' }, {
    work_id: 'collision-b', validationStatus: 'passed', changedFiles: ['src/index.js']
  });
  const collisionProcedures = listProcedures(collisionConfig);
  assert.equal(collisionProcedures.length, 2, 'unrelated objectives must not merge only because their tool sequences match');
  assert(collisionProcedures.every(item => item.status === 'candidate' && item.successCount === 1));

  resetToolActivity();
  await runProcedureTask(1, 2);
  let procedures = listProcedures(config);
  assert.equal(procedures.length, 1);
  assert.equal(procedures[0].status, 'candidate');
  assert.equal(procedures[0].successCount, 1);

  resetToolActivity();
  await runProcedureTask(2, 3);
  procedures = listProcedures(config);
  assert.equal(procedures.length, 1);
  assert.equal(procedures[0].status, 'verified');
  assert.equal(procedures[0].successCount, 2);
  assert.equal(knowledgeSummary(config).verifiedProcedureCount, 1);
  assert(searchVerifiedProcedures(config, 'alpha syntax').length >= 1, 'verified procedure must remain retrievable with the default byte budget');

  const skillRoot = path.join(temp, 'skills');
  const promoted = promoteProcedureToSkill(config, procedures[0].id, { userRoot: skillRoot });
  assert.equal(promoted.ok, true);
  const promotedSkillPath = path.join(skillRoot, promoted.name, 'SKILL.md');
  assert(fs.existsSync(promotedSkillPath));
  assert(fs.existsSync(path.join(skillRoot, promoted.name, 'PROVENANCE.md')));
  const promotedSkillSource = fs.readFileSync(promotedSkillPath, 'utf8');
  const descriptionLine = promotedSkillSource.split(/\r?\n/).find(line => line.startsWith('description: '));
  assert(descriptionLine?.startsWith('description: "'), 'generated skill descriptions must be YAML-safe quoted scalars');
  assert.doesNotThrow(() => JSON.parse(descriptionLine.slice('description: '.length)));
  const discoveredPromoted = discoverSkills({ path: workspace }, { userRoot: skillRoot }).find(item => item.name === promoted.name);
  assert.equal(discoveredPromoted?.description, procedures[0].description, 'Rel.AI discovery must decode the generated YAML-safe description exactly');

  console.log('Knowledge continuity and procedural learning regression checks passed.');
} finally {
  await flushTaskHistoryPersistence();
  await repositoryIntelligence.shutdown();
  resetToolActivity();
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
