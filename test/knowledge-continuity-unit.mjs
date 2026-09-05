import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { buildTaskContinuity } from '../src/context/taskContinuity.js';
import { addKnowledgeItem, knowledgeDatabasePath, learnedValidationChecks, listKnowledge, searchKnowledge } from '../src/knowledgeStore.js';
import { listManagedSkills, managedSkillRoots } from '../src/skillManager.js';
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
const previousReducedBackgroundWork = process.env.REL_AI_REDUCED_BACKGROUND_WORK;

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
    app: { path: workspace, commands: { check: 'node --check src/index.js' }, testCommands: {} }
  }
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_REDUCED_BACKGROUND_WORK = '1';
resetToolActivity();

try {
  addKnowledgeItem(config, { content: 'alpha shared global fact', scope: 'global' });
  addKnowledgeItem(config, { content: 'alpha app fact', scope: 'workspace', workspace: 'app' });
  addKnowledgeItem(config, { content: 'alpha other project fact', scope: 'workspace', workspace: 'other' });

  const scoped = searchKnowledge(config, 'alpha', { workspace: 'app', limit: 6, maxBytes: 4096 });
  assert(scoped.some(item => item.content.includes('shared global')));
  assert(scoped.some(item => item.content.includes('app fact')));
  assert(!scoped.some(item => item.content.includes('other project')));

  const transactionConfig = { ...config, stateDir: path.join(temp, 'transaction-state') };
  addKnowledgeItem(transactionConfig, { id: 'mem_seed', content: 'transaction seed', scope: 'global' });
  const transactionDb = new DatabaseSync(knowledgeDatabasePath(transactionConfig));
  transactionDb.exec('DROP TABLE knowledge_fts; CREATE TABLE knowledge_fts(id TEXT, content TEXT);');
  transactionDb.close();
  assert.throws(
    () => addKnowledgeItem(transactionConfig, { id: 'mem_atomic', content: 'must roll back with failed FTS sync', scope: 'global' }),
    /no column named kind/
  );
  assert.equal(listKnowledge(transactionConfig).some(item => item.id === 'mem_atomic'), false,
    'knowledge row and FTS mutation must roll back together when FTS synchronization fails');

  for (let index = 0; index < 8; index += 1) {
    addKnowledgeItem(config, { content: `alpha bounded ${index} ${'x'.repeat(160)}`, scope: 'global' });
  }
  const bounded = buildTaskContinuity(config, { workspace: 'app', query: 'alpha' });
  assert(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 1024, 'continuity bootstrap must respect the configured byte cap');

  const portableSource = { ...config, stateDir: path.join(temp, 'portable-source') };
  const portableRestored = { ...config, stateDir: path.join(temp, 'portable-restored') };
  addKnowledgeItem(portableSource, { content: 'portable sqlite marker', scope: 'global' });
  const statePayload = stateExport(portableSource).export;
  const sqliteExport = statePayload.files.find(item => item.path === 'knowledge/knowledge.sqlite');
  assert.equal(statePayload.version, 2);
  assert.equal(sqliteExport?.encoding, 'base64', 'binary knowledge databases must be exported losslessly');
  stateImport(portableRestored, { confirm: true, payload: statePayload });
  assert(searchKnowledge(portableRestored, 'portable sqlite', { workspace: 'app', maxBytes: 4096 }).some(item => item.content.includes('portable sqlite marker')));

  const context = { publicHttpOnly: true, conversationId: 'knowledge-continuity-chat' };
  const first = await callTool('relai_work', {
    action: 'begin', workspace: 'app', title: 'Remember continuity marker', objective: 'Remember continuity marker',
    contextSummary: 'Host capsule alpha', bootstrap: 'compact'
  }, context);
  assert.equal(first.bootstrap.hostContextSummary, 'Host capsule alpha');
  await callTool('relai_work', { action: 'finish', workspace: 'app', work_id: first.work_id, summary: 'Continuity marker stored.' }, context);
  await flushTaskHistoryPersistence();
  const stored = readTaskHistorySessionRecord(config, first.work_id, { reconcileInactive: false });
  assert.equal(stored?.contextSummary, 'Host capsule alpha');
  assert.equal(stored?.correlation?.conversationId, 'knowledge-continuity-chat');
  const status = await callTool('relai_work', { action: 'status', workspace: 'app', work_id: first.work_id }, context);
  assert.equal(status.task?.hostContextSummary, 'Host capsule alpha');

  const second = await callTool('relai_work', {
    action: 'begin', workspace: 'app', title: 'Continue continuity marker', objective: 'Continue continuity marker',
    contextSummary: 'Host capsule beta', bootstrap: 'compact'
  }, context);
  assert.equal(second.bootstrap.hostContextSummary, 'Host capsule beta');
  assert(second.bootstrap.conversationContinuity?.some(item => item.goal?.includes('Remember continuity marker')));
  assert(second.bootstrap.conversationContinuity?.every(item => !('workId' in item) && !('workspace' in item)));
  await callTool('relai_work', { action: 'cancel', workspace: 'app', work_id: second.work_id, reason: 'continuity regression complete' }, context);

  const peerAContext = { publicHttpOnly: true, conversationId: 'peer-worker-a' };
  const peerBContext = { publicHttpOnly: true, conversationId: 'peer-worker-b' };
  const peerA = await callTool('relai_work', {
    action: 'begin', workspace: 'app', title: 'Backend continuation worker', objective: 'Update backend continuation contract', bootstrap: 'none'
  }, peerAContext);
  const peerB = await callTool('relai_work', {
    action: 'begin', workspace: 'app', title: 'Task UI worker', objective: 'Update task UI for continuation state', bootstrap: 'none'
  }, peerBContext);
  assert(peerB.activeRelatedWork?.some(item => item.goal?.includes('backend continuation contract')), 'a newly started peer must receive compact active sibling work');
  assert(peerB.activeRelatedWork?.every(item => !('work_id' in item) && !('principalFingerprint' in item) && !('hostContextSummary' in item)));
  const peerAStatus = await callTool('relai_work', { action: 'status', workspace: 'app', work_id: peerA.work_id }, peerAContext);
  assert(peerAStatus.activeRelatedWork?.some(item => item.goal?.includes('task UI for continuation state')), 'status must refresh active sibling work');
  await callTool('relai_work', { action: 'cancel', workspace: 'app', work_id: peerA.work_id, reason: 'peer coordination regression complete' }, peerAContext);
  await callTool('relai_work', { action: 'cancel', workspace: 'app', work_id: peerB.work_id, reason: 'peer coordination regression complete' }, peerBContext);

  const task = await callTool('relai_work', {
    action: 'begin', workspace: 'app', title: 'Fix alpha syntax flow', objective: 'Fix alpha syntax flow safely', bootstrap: 'none'
  }, context);

  const savedMemory = await callTool('relai_memory', {
    action: 'save', workspace: 'app', work_id: task.work_id, kind: 'preference', content: 'Prefer alpha syntax for this project'
  }, context);
  assert.equal(savedMemory.ok, true);
  assert.equal(savedMemory.scope, 'workspace', 'agent memory should default to the active project scope');
  assert.equal(listKnowledge(config).find(item => item.id === savedMemory.id)?.source, 'agent');
  assert(searchKnowledge(config, 'alpha syntax', { workspace: 'app', maxBytes: 4096 }).some(item => item.id === savedMemory.id), 'agent-saved memory must participate in normal bootstrap retrieval');

  const updatedMemory = await callTool('relai_memory', {
    action: 'update', workspace: 'app', work_id: task.work_id, id: savedMemory.id, content: 'Prefer validated alpha syntax for this project'
  }, context);
  assert.equal(updatedMemory.updated, true);
  assert.match(listKnowledge(config).find(item => item.id === savedMemory.id)?.content || '', /validated alpha syntax/);
  await callTool('relai_edit', {
    workspace: 'app', work_id: task.work_id, path: 'src/index.js',
    oldText: 'export const value = 1;', newText: 'export const value = 2;'
  }, context);

  const skillContent = `---\nname: alpha-syntax-workflow\ndescription: "Reuse the validated alpha syntax update workflow for this repository when the same maintenance pattern applies."\n---\n\n# Alpha syntax workflow\n\n1. Inspect the current export before editing.\n2. Make the smallest intended source change.\n3. Run \`node --check src/index.js\` before completion.\n`;
  await assert.rejects(
    callTool('relai_skill', { action: 'create', workspace: 'app', work_id: task.work_id, name: 'alpha-syntax-workflow', content: skillContent }, context),
    /Validate the current repository changes before creating or updating a learned skill/
  );

  const validation = await callTool('relai_validate', {
    action: 'checks', workspace: 'app', work_id: task.work_id, check: 'node --check src/index.js'
  }, context);
  assert.equal(validation.validationStatus, 'passed');

  const created = await callTool('relai_skill', {
    action: 'create', workspace: 'app', work_id: task.work_id, name: 'alpha-syntax-workflow', scope: 'workspace', content: skillContent
  }, context);
  assert.equal(created.ok, true);
  assert.equal(created.scope, 'workspace');
  assert.equal(listManagedSkills(config, { workspace: 'app' }).length, 1);

  const learnedRoot = managedSkillRoots(config, 'app').find(item => item.source === 'learned')?.root;
  assert(learnedRoot, 'workspace learned-skill root must be discoverable');
  const learnedDirectory = path.join(learnedRoot, 'alpha-syntax-workflow');
  const backupDirectory = path.join(learnedRoot, '.alpha-syntax-workflow.backup');
  const pendingDirectory = path.join(learnedRoot, '.alpha-syntax-workflow.pending');
  fs.renameSync(learnedDirectory, backupDirectory);
  fs.mkdirSync(pendingDirectory, { recursive: true });
  fs.writeFileSync(path.join(pendingDirectory, 'partial.tmp'), 'interrupted write');
  assert.equal(listManagedSkills(config, { workspace: 'app' }).length, 1,
    'managed skill discovery must recover the last complete skill after an interrupted directory swap');
  assert.equal(fs.existsSync(learnedDirectory), true);
  assert.equal(fs.existsSync(backupDirectory), false);
  assert.equal(fs.existsSync(pendingDirectory), false);

  const discovered = discoverSkills({ alias: 'app', path: workspace }, { config });
  assert(discovered.some(item => item.name === 'alpha-syntax-workflow' && item.source === 'learned'), 'agent-managed skills must participate in normal skill discovery');
  const readSkill = await callTool('relai_read', { workspace: 'app', work_id: task.work_id, skill: 'alpha-syntax-workflow' }, context);
  assert.match(readSkill.items?.[0]?.content || '', /Run `node --check src\/index\.js` before completion/);

  await callTool('relai_work', { action: 'finish', workspace: 'app', work_id: task.work_id, summary: 'Updated alpha syntax flow and saved the proven workflow.' }, context);
  await flushTaskHistoryPersistence();
  const learnedChecks = learnedValidationChecks(config, 'app', ['src/index.js']);
  assert(learnedChecks.some(item => item.command === 'node --check src/index.js'), 'successful completion must retain repository-scoped validation affinity without inventing a procedure candidate');

  await repositoryIntelligence.ensure({ alias: 'app', path: workspace, context: {} }, config, { watch: false });
  const compactWithRepositorySummary = await callTool('relai_work', {
    action: 'begin', workspace: 'app', title: 'Inspect alpha syntax', objective: 'Inspect alpha syntax', bootstrap: 'compact'
  }, context);
  assert.equal(compactWithRepositorySummary.bootstrap?.repositoryIntelligence?.summaryOnly, true, 'compact task bootstrap must reuse the cheap cached Repository Intelligence summary when available');
  await callTool('relai_work', { action: 'cancel', workspace: 'app', work_id: compactWithRepositorySummary.work_id, reason: 'compact bootstrap regression complete' }, context);

  const reuse = await callTool('relai_work', {
    action: 'begin', workspace: 'app', title: 'Reuse alpha syntax workflow', objective: 'Reuse alpha syntax workflow', bootstrap: 'compact'
  }, context);
  assert(reuse.bootstrap.suggestedSkills?.some(item => item.name === 'alpha-syntax-workflow'), 'agent-authored learned skills must be suggested through the ordinary skill bootstrap path');
  await callTool('relai_work', { action: 'cancel', workspace: 'app', work_id: reuse.work_id, reason: 'learned skill regression complete' }, context);

  assert.equal(Object.hasOwn(buildTaskContinuity(config, { workspace: 'app', query: 'alpha syntax' }), 'suggestedProcedures'), false,
    'the removed candidate/procedure inference model must not remain in task continuity');

  const deleted = await callTool('relai_skill', {
    action: 'delete', workspace: 'app', name: 'alpha-syntax-workflow', scope: 'workspace'
  }, context);
  assert.equal(deleted.ok, true, 'forgetting a Rel.AI-managed skill must not require an unrelated active task');
  assert.equal(deleted.deleted, true);
  assert.equal(listManagedSkills(config, { workspace: 'app' }).length, 0);

  const deletedMemory = await callTool('relai_memory', { action: 'delete', workspace: 'app', id: savedMemory.id }, context);
  assert.equal(deletedMemory.deleted, true, 'forgetting saved memory must not require an unrelated active task');
  assert.equal(listKnowledge(config).some(item => item.id === savedMemory.id), false);

  console.log('Knowledge continuity and agent-managed learning regression checks passed.');
} finally {
  await flushTaskHistoryPersistence();
  await repositoryIntelligence.shutdown();
  resetToolActivity();
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  if (previousReducedBackgroundWork == null) delete process.env.REL_AI_REDUCED_BACKGROUND_WORK;
  else process.env.REL_AI_REDUCED_BACKGROUND_WORK = previousReducedBackgroundWork;
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

// Nested raw tool calls can leave Windows piped stdio referenced after app resources close.
// Teardown above is complete, so exit explicitly to keep this isolated integration test deterministic.
process.exit(0);
