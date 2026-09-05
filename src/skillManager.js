import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { statePath } from './stateLayout.js';
import { readTaskIntegrity } from './taskIntegrity.js';
import { validateSkillDocument, validateSkillIdentity } from './skillValidation.js';

const PROVENANCE_FILE = 'PROVENANCE.json';
const MAX_SKILL_BYTES = 512 * 1024;

function manageSkill(workspace, config, args = {}, context = {}) {
  if (config?.knowledge?.proceduralLearning === false) throw new Error('Agent-managed learning is disabled.');
  const action = String(args.action || '').trim();
  const scope = args.scope === 'global' ? 'global' : 'workspace';
  const name = validateRequestedName(args.name);
  if (action === 'delete') return deleteManagedSkill(config, { workspace: workspace.alias, scope, name });
  const taskId = String(context.taskId || args.work_id || '').trim();
  if (action === 'create') return createManagedSkill(config, workspace, taskId, scope, name, args.content);
  if (action === 'edit') return editManagedSkill(config, workspace, taskId, scope, name, args.content);
  if (action === 'patch') return patchManagedSkill(config, workspace, taskId, scope, name, args.oldText, args.newText);
  throw new Error(`Unsupported skill action '${action}'.`);
}

function createManagedSkill(config, workspace, taskId, scope, name, source) {
  const document = requiredDocument(source, name);
  const location = managedSkillLocation(config, workspace.alias, scope, name);
  recoverManagedSkillSwap(location);
  if (fs.existsSync(location.directory)) throw new Error(`Managed skill '${name}' already exists in ${scope} scope. Use patch or edit.`);
  writeManagedSkill(location, document.content, provenance({ workspace: workspace.alias, taskId, scope, name, existing: null, config }));
  return skillResult(location, document, { created: true, updated: false });
}

function editManagedSkill(config, workspace, taskId, scope, name, source) {
  const document = requiredDocument(source, name);
  const location = managedSkillLocation(config, workspace.alias, scope, name);
  const existing = requireManagedSkill(location, { workspace: workspace.alias, scope, name });
  writeManagedSkill(location, document.content, provenance({ workspace: workspace.alias, taskId, scope, name, existing, config }));
  return skillResult(location, document, { created: false, updated: true });
}

function patchManagedSkill(config, workspace, taskId, scope, name, oldText, newText) {
  const location = managedSkillLocation(config, workspace.alias, scope, name);
  const existing = requireManagedSkill(location, { workspace: workspace.alias, scope, name });
  const current = fs.readFileSync(location.file, 'utf8');
  const needle = String(oldText || '');
  if (!needle) throw new Error('Skill patch oldText must not be empty.');
  const first = current.indexOf(needle);
  if (first < 0) throw new Error('Skill patch oldText was not found. Read the current skill before patching it.');
  if (current.indexOf(needle, first + needle.length) >= 0) throw new Error('Skill patch oldText is ambiguous. Use a more specific exact string.');
  const document = requiredDocument(`${current.slice(0, first)}${String(newText ?? '')}${current.slice(first + needle.length)}`, name);
  writeManagedSkill(location, document.content, provenance({ workspace: workspace.alias, taskId, scope, name, existing, config }));
  return skillResult(location, document, { created: false, updated: true });
}

function deleteManagedSkill(config, options = {}) {
  const scope = options.scope === 'global' ? 'global' : 'workspace';
  const workspace = String(options.workspace || '').trim();
  const name = validateRequestedName(options.name);
  const location = managedSkillLocation(config, workspace, scope, name);
  recoverManagedSkillSwap(location);
  if (!fs.existsSync(location.directory)) return { ok: true, deleted: false, name, scope, ...(scope === 'workspace' ? { workspace } : {}) };
  requireManagedSkill(location, { workspace, scope, name });
  fs.rmSync(location.directory, { recursive: true, force: true });
  return { ok: true, deleted: true, name, scope, ...(scope === 'workspace' ? { workspace } : {}) };
}

function clearManagedSkills(config) {
  const root = managedSkillsRoot(config);
  if (!fs.existsSync(root)) return { ok: true, clearedSkills: 0 };
  const count = listManagedSkills(config).length;
  fs.rmSync(root, { recursive: true, force: true });
  return { ok: true, clearedSkills: count };
}

function listManagedSkills(config, options = {}) {
  const requestedWorkspace = String(options.workspace || '').trim();
  const results = [];
  const globalRoot = path.join(managedSkillsRoot(config), 'global');
  recoverManagedSkillRoot(globalRoot);
  collectManagedSkills(globalRoot, results, { scope: 'global', workspace: '' });
  const workspaceRoot = path.join(managedSkillsRoot(config), 'workspaces');
  if (requestedWorkspace) {
    const requestedRoot = path.join(workspaceRoot, workspaceKey(requestedWorkspace));
    recoverManagedSkillRoot(requestedRoot);
    collectManagedSkills(requestedRoot, results, { scope: 'workspace', workspace: requestedWorkspace });
  } else if (fs.existsSync(workspaceRoot)) {
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      collectManagedSkills(path.join(workspaceRoot, entry.name), results, { scope: 'workspace', workspace: '' });
    }
  }
  return results
    .filter(item => !requestedWorkspace || item.scope === 'global' || item.workspace === requestedWorkspace)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name));
}

function managedSkillRoots(config, workspaceAlias = '') {
  const roots = [];
  if (workspaceAlias) roots.push({ source: 'learned', root: path.join(managedSkillsRoot(config), 'workspaces', workspaceKey(workspaceAlias)) });
  roots.push({ source: 'learned', root: path.join(managedSkillsRoot(config), 'global') });
  return roots;
}

function managedSkillsRoot(config) {
  return statePath(config, 'skills', 'managed');
}

function managedSkillLocation(config, workspace, scope, name) {
  const root = scope === 'global'
    ? path.join(managedSkillsRoot(config), 'global')
    : path.join(managedSkillsRoot(config), 'workspaces', workspaceKey(workspace));
  const directory = path.join(root, name);
  return { root, directory, file: path.join(directory, 'SKILL.md'), provenance: path.join(directory, PROVENANCE_FILE), name, scope, workspace: scope === 'workspace' ? workspace : '' };
}

function writeManagedSkill(location, content, metadata) {
  fs.mkdirSync(location.root, { recursive: true, mode: 0o700 });
  recoverManagedSkillSwap(location);
  const pending = managedSkillSwapPath(location, 'pending');
  const backup = managedSkillSwapPath(location, 'backup');
  fs.rmSync(pending, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(pending, { recursive: false, mode: 0o700 });
  fs.writeFileSync(path.join(pending, 'SKILL.md'), content, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(path.join(pending, PROVENANCE_FILE), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  let backedUp = false;
  try {
    if (fs.existsSync(location.directory)) {
      fs.renameSync(location.directory, backup);
      backedUp = true;
    }
    fs.renameSync(pending, location.directory);
    if (backedUp) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(location.directory) && fs.existsSync(backup)) {
      try { fs.renameSync(backup, location.directory); } catch {}
    }
    throw error;
  } finally {
    fs.rmSync(pending, { recursive: true, force: true });
  }
}

function managedSkillSwapPath(location, kind) {
  return path.join(location.root, `.${location.name}.${kind}`);
}

function recoverManagedSkillSwap(location) {
  const pending = managedSkillSwapPath(location, 'pending');
  const backup = managedSkillSwapPath(location, 'backup');
  if (!fs.existsSync(location.directory) && fs.existsSync(backup)) {
    fs.renameSync(backup, location.directory);
  } else if (fs.existsSync(location.directory) && fs.existsSync(backup)) {
    fs.rmSync(backup, { recursive: true, force: true });
  }
  if (fs.existsSync(pending)) fs.rmSync(pending, { recursive: true, force: true });
}

function recoverManagedSkillRoot(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.')) continue;
    const match = entry.name.match(/^\.(.+)\.(backup|pending)$/);
    if (!match) continue;
    const [, name, kind] = match;
    const target = path.join(root, name);
    const source = path.join(root, entry.name);
    if (kind === 'backup' && !fs.existsSync(target)) fs.renameSync(source, target);
    else fs.rmSync(source, { recursive: true, force: true });
  }
}

function requireManagedSkill(location, expected = {}) {
  recoverManagedSkillSwap(location);
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(location.provenance, 'utf8')); }
  catch { throw new Error(`Managed skill '${location.name}' is missing valid Rel.AI provenance.`); }
  if (metadata?.managedBy !== 'Rel.AI' || metadata?.origin !== 'agent-managed') throw new Error(`Skill '${location.name}' is not owned by Rel.AI.`);
  if (String(metadata.name || '') !== expected.name || String(metadata.scope || '') !== expected.scope) throw new Error(`Managed skill '${location.name}' provenance does not match the requested skill.`);
  if (expected.scope === 'workspace' && String(metadata.workspace || '') !== expected.workspace) throw new Error(`Managed skill '${location.name}' belongs to another workspace.`);
  if (!fs.existsSync(location.file)) throw new Error(`Managed skill '${location.name}' has no SKILL.md.`);
  return metadata;
}

function collectManagedSkills(root, output, fallback) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const directory = path.join(root, entry.name);
    const file = path.join(directory, 'SKILL.md');
    const provenanceFile = path.join(directory, PROVENANCE_FILE);
    let metadata, document;
    try {
      metadata = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'));
      document = validateSkillDocument(fs.readFileSync(file, 'utf8'));
    } catch { continue; }
    if (metadata?.managedBy !== 'Rel.AI' || metadata?.origin !== 'agent-managed' || !document.ok) continue;
    output.push({
      name: document.name,
      description: document.description,
      scope: metadata.scope === 'global' ? 'global' : fallback.scope,
      workspace: String(metadata.workspace || fallback.workspace || ''),
      updatedAt: String(metadata.updatedAt || ''),
      createdAt: String(metadata.createdAt || ''),
      path: `learned:${metadata.scope === 'global' ? 'global' : String(metadata.workspace || 'workspace')}:${document.name}`
    });
  }
}

function requiredDocument(source, expectedName) {
  const text = String(source || '');
  if (Buffer.byteLength(text, 'utf8') > MAX_SKILL_BYTES) throw new Error(`Skill content exceeds ${MAX_SKILL_BYTES} bytes.`);
  const document = validateSkillDocument(text, expectedName);
  if (!document.ok) throw new Error(document.errors.join(' '));
  return document;
}

function validateRequestedName(value) {
  const identity = validateSkillIdentity({ name: value, description: 'Temporary validation description for skill name checking.' });
  if (!identity.name || identity.errors.some(error => error.startsWith('Skill name'))) throw new Error(identity.errors.find(error => error.startsWith('Skill name')) || 'Skill name is required.');
  return identity.name;
}

function provenance({ workspace, taskId, scope, name, existing, config }) {
  const authority = taskId ? readTaskIntegrity(config, taskId, workspace) : null;
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    managedBy: 'Rel.AI',
    origin: 'agent-managed',
    name,
    scope,
    workspace: scope === 'workspace' ? workspace : '',
    createdAt: String(existing?.createdAt || now),
    updatedAt: now,
    lastWorkId: taskId || '',
    validationStatus: String(authority?.validationResult || 'not_run'),
    validationFingerprint: String(authority?.validatedRepositoryFingerprint || authority?.validationFingerprint || '')
  };
}

function skillResult(location, document, flags) {
  return {
    ok: true,
    ...flags,
    name: document.name,
    description: document.description,
    scope: location.scope,
    ...(location.scope === 'workspace' ? { workspace: location.workspace } : {}),
    path: `learned:${location.scope === 'global' ? 'global' : location.workspace}:${document.name}`
  };
}

function workspaceKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

export {
  clearManagedSkills,
  deleteManagedSkill,
  listManagedSkills,
  manageSkill,
  managedSkillRoots
};
