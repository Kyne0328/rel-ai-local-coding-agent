import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonFile, writeJsonAtomic } from './durableState.js';
import { resolveGitExecutable } from './gitExecutable.js';
import { runProcess } from './process.js';
import { statePath } from './stateLayout.js';

const LIBRARY_VERSION = 1;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILT_IN_ROOT = path.join(PACKAGE_ROOT, 'skills');
const SKILL_FILES = Object.freeze(['SKILL.md', 'skill.md']);
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);

function parseGitHubRepositoryUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Enter a valid GitHub repository URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(host)) {
    throw new Error('Enter a public GitHub repository URL beginning with https://github.com/.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('GitHub repository URL must include owner and repository.');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) throw new Error('GitHub repository URL must include owner and repository.');
  return {
    owner,
    repo,
    repository: `${owner}/${repo}`,
    repositoryUrl: `https://github.com/${owner}/${repo}`
  };
}

function discoverSkillPackages(root, source = {}) {
  const base = path.resolve(String(root || ''));
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return [];
  const skills = [];
  walk(base, '');
  return skills.sort((left, right) => left.key.localeCompare(right.key));

  function walk(directory, relativeDirectory) {
    const skillFile = SKILL_FILES.find(name => fs.existsSync(path.join(directory, name)));
    if (skillFile) {
      const text = fs.readFileSync(path.join(directory, skillFile), 'utf8').replaceAll('\r\n', '\n');
      const metadata = parseSkillFrontmatter(text);
      const fallbackName = path.basename(directory) || 'skill';
      skills.push({
        key: slash(relativeDirectory || '.'),
        name: metadata.name || fallbackName,
        description: metadata.description || '',
        skillFile,
        files: listSkillFiles(directory),
        sourceType: String(source.sourceType || ''),
        repository: String(source.repository || '')
      });
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) continue;
      const nextRelative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      walk(path.join(directory, entry.name), nextRelative);
    }
  }
}

function parseSkillFrontmatter(text) {
  const normalized = String(text || '').replaceAll('\r\n', '\n');
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) return { name: '', description: '' };
  return {
    name: yamlScalar(match[1], 'name'),
    description: yamlScalar(match[1], 'description')
  };
}

function yamlScalar(frontmatter, key) {
  const match = String(frontmatter || '').match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  const raw = String(match?.[1] || '').trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function listSkillFiles(root) {
  const files = [];
  collect(path.resolve(root), '');
  return files.sort((left, right) => left.localeCompare(right));

  function collect(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        const next = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
        collect(path.join(directory, entry.name), next);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(slash(relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name));
    }
  }
}

function installSkillPackages(config, source, sourceRoot, selectedKeys) {
  const selected = new Set((Array.isArray(selectedKeys) ? selectedKeys : []).map(value => slash(String(value || '').trim())).filter(Boolean));
  const discovered = discoverSkillPackages(sourceRoot, source);
  const chosen = discovered.filter(skill => selected.has(skill.key));
  const missing = [...selected].filter(key => !discovered.some(skill => skill.key === key));
  const registry = readLibraryRegistry(config);
  const installed = [];

  for (const skill of chosen) {
    const id = installedSkillId(source, skill.key);
    const directory = installedDirectoryName(id);
    const target = path.join(installedRoot(config), directory);
    const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.cpSync(path.join(path.resolve(sourceRoot), ...skill.key.split('/')), temporary, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(temporary, target);
    const record = {
      id,
      scope: 'installed',
      name: skill.name,
      description: skill.description,
      sourceType: String(source.sourceType || 'github'),
      repository: String(source.repository || ''),
      repositoryUrl: String(source.repositoryUrl || ''),
      revision: String(source.revision || ''),
      skillPath: skill.key,
      skillFile: skill.skillFile,
      directory,
      files: skill.files,
      installedAt: new Date().toISOString()
    };
    registry.installed[id] = record;
    installed.push(publicSkill(record));
  }

  writeLibraryRegistry(config, registry);
  return { ok: true, installed, missing };
}

async function previewGitHubSkills(config, repositoryUrl) {
  const source = parseGitHubRepositoryUrl(repositoryUrl);
  return withGitHubClone(config, source, async (root, revision) => ({
    ok: true,
    repository: source.repository,
    repositoryUrl: source.repositoryUrl,
    revision,
    skills: discoverSkillPackages(root, source).map(skill => ({
      ...skill,
      id: installedSkillId(source, skill.key)
    }))
  }));
}

async function installGitHubSkills(config, repositoryUrl, selectedKeys) {
  const source = parseGitHubRepositoryUrl(repositoryUrl);
  return withGitHubClone(config, source, async (root, revision) => installSkillPackages(config, {
    ...source,
    sourceType: 'github',
    revision
  }, root, selectedKeys));
}

function cleanupTemporarySkillDirectory(directory, remove = fs.rmSync) {
  try {
    remove(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return true;
  } catch {
    return false;
  }
}

async function withGitHubClone(config, source, callback) {
  if (!resolveGitExecutable()) throw new Error('Git is required to install skills from GitHub.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-skill-github-'));
  const cloneRoot = path.join(temporary, 'repository');
  try {
    const cloned = await runProcess('git', ['clone', '--depth', '1', '--single-branch', `${source.repositoryUrl}.git`, cloneRoot], {
      timeout: 60_000,
      maxOutputBytes: 64 * 1024
    }, config);
    if (cloned.exitCode !== 0) throw new Error(cloned.stderr || cloned.error || `Could not clone ${source.repository}.`);
    const revisionResult = await runProcess('git', ['rev-parse', 'HEAD'], {
      cwd: cloneRoot,
      timeout: 10_000,
      maxOutputBytes: 8 * 1024
    }, config);
    const revision = revisionResult.exitCode === 0 ? String(revisionResult.stdout || '').trim() : '';
    return await callback(cloneRoot, revision);
  } finally {
    cleanupTemporarySkillDirectory(temporary);
  }
}

function listSkillLibrary(config) {
  return {
    builtIn: builtInSkills(),
    installed: installedSkills(config)
  };
}

function builtInSkills() {
  return discoverSkillPackages(BUILT_IN_ROOT, { sourceType: 'built-in', repository: 'rel-ai-mcp' }).map(skill => publicSkill({
    ...skill,
    id: `builtin:${skill.name}`,
    scope: 'built-in',
    sourceType: 'built-in',
    repository: 'rel-ai-mcp',
    skillPath: skill.key
  }));
}

function installedSkills(config) {
  const registry = readLibraryRegistry(config);
  return Object.values(registry.installed)
    .filter(record => fs.existsSync(path.join(installedRoot(config), record.directory || '')))
    .map(publicSkill)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function resolveWorkspaceSkills(config, workspace) {
  const ids = Array.isArray(workspace?.skills) ? workspace.skills : [];
  return ids.map(id => resolvedSkill(config, id)).filter(Boolean);
}

function resolvedSkill(config, id) {
  const record = skillRecord(config, id);
  if (!record) return null;
  const root = skillRoot(config, record);
  if (!root) return null;
  const skillFile = record.skillFile || SKILL_FILES.find(name => fs.existsSync(path.join(root, name))) || 'SKILL.md';
  const file = path.join(root, skillFile);
  if (!fs.existsSync(file)) return null;
  return {
    ...publicSkill(record),
    content: fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'),
    resourceBase: `relai://skill/${encodeURIComponent(record.id)}/file/`
  };
}

function readSkillResource(config, skillId, relativePath) {
  const record = skillRecord(config, skillId);
  if (!record) throw new Error(`Unknown skill: ${skillId}`);
  const root = skillRoot(config, record);
  if (!root) throw new Error(`Skill package is unavailable: ${skillId}`);
  const relative = slash(String(relativePath || '').trim()).replace(/^\.\//, '');
  if (!relative || path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error('Skill resource path must stay inside the skill package.');
  }
  const candidate = path.resolve(root, ...relative.split('/'));
  if (!isPathInside(candidate, root)) throw new Error('Skill resource path must stay inside the skill package.');
  let real;
  try { real = fs.realpathSync(candidate); }
  catch { throw new Error(`Skill resource does not exist: ${relative}`); }
  if (!isPathInside(real, fs.realpathSync(root))) throw new Error('Skill resource path must stay inside the skill package.');
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new Error(`Skill resource is not a file: ${relative}`);
  return { skillId: record.id, path: relative, bytes: stat.size, text: fs.readFileSync(real, 'utf8') };
}

function removeInstalledSkill(config, skillId) {
  const registry = readLibraryRegistry(config);
  const record = registry.installed[String(skillId || '')];
  if (!record) return { ok: true, removed: false, skillId: String(skillId || '') };
  fs.rmSync(path.join(installedRoot(config), record.directory || ''), { recursive: true, force: true });
  delete registry.installed[record.id];
  writeLibraryRegistry(config, registry);
  return { ok: true, removed: true, skillId: record.id };
}

function skillRecord(config, id) {
  const text = String(id || '');
  if (text.startsWith('builtin:')) {
    return builtInSkills().find(skill => skill.id === text) || null;
  }
  return readLibraryRegistry(config).installed[text] || null;
}

function skillRoot(config, record) {
  if (record.scope === 'built-in') {
    const target = path.resolve(BUILT_IN_ROOT, ...String(record.skillPath || '.').split('/'));
    return isPathInside(target, BUILT_IN_ROOT) && fs.existsSync(target) ? target : '';
  }
  const target = path.resolve(installedRoot(config), String(record.directory || ''));
  return isPathInside(target, installedRoot(config)) && fs.existsSync(target) ? target : '';
}

function installedSkillId(source, skillPath) {
  const repository = String(source.repository || '').trim();
  if (!repository) throw new Error('Skill source repository is required.');
  return `github:${repository}:${slash(skillPath)}`;
}

function installedDirectoryName(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 24);
}

function publicSkill(record) {
  return {
    id: record.id,
    scope: record.scope,
    name: record.name,
    description: record.description || '',
    sourceType: record.sourceType || '',
    repository: record.repository || '',
    repositoryUrl: record.repositoryUrl || '',
    revision: record.revision || '',
    skillPath: record.skillPath || '',
    skillFile: record.skillFile || 'SKILL.md',
    files: Array.isArray(record.files) ? [...record.files] : [],
    installedAt: record.installedAt || ''
  };
}

function readLibraryRegistry(config) {
  return readJsonFile(libraryFile(config), {
    fallback: { version: LIBRARY_VERSION, installed: {} },
    validate: value => value?.version === LIBRARY_VERSION && value.installed && typeof value.installed === 'object' && !Array.isArray(value.installed)
  });
}

function writeLibraryRegistry(config, registry) {
  writeJsonAtomic(libraryFile(config), { version: LIBRARY_VERSION, installed: { ...(registry.installed || {}) } }, { mode: 0o600, backup: true });
}

function installedRoot(config) {
  return statePath(config, 'skills', 'installed');
}

function libraryFile(config) {
  return statePath(config, 'skills', 'library.json');
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function slash(value) {
  return String(value || '').split(path.sep).join('/').replaceAll('\\', '/');
}

export {
  cleanupTemporarySkillDirectory,
  discoverSkillPackages,
  installGitHubSkills,
  installSkillPackages,
  listSkillLibrary,
  parseGitHubRepositoryUrl,
  previewGitHubSkills,
  readSkillResource,
  removeInstalledSkill,
  resolveWorkspaceSkills
};

