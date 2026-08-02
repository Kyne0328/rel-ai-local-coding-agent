import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_MANIFEST_FIELDS = new Set([
  'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords',
  'skills', 'mcpServers', 'interface'
]);
const BANNED_SKILL_COMMANDS = /\b(?:curl|wget|Invoke-WebRequest|Start-BitsTransfer|git\s+clone)\b/i;

function validatePlugin(root, options = {}) {
  const errors = [];
  const packageJson = readJson(path.join(root, 'package.json'), errors, 'package.json');
  const manifest = readJson(path.join(root, '.codex-plugin', 'plugin.json'), errors, '.codex-plugin/plugin.json');
  const mcp = readJson(path.join(root, '.mcp.json'), errors, '.mcp.json');

  for (const field of Object.keys(manifest || {})) {
    if (!ALLOWED_MANIFEST_FIELDS.has(field)) errors.push(`Unsupported plugin manifest field: ${field}`);
  }
  for (const field of ['name', 'version', 'description', 'author', 'skills', 'mcpServers', 'interface']) {
    if (manifest?.[field] == null || manifest[field] === '') errors.push(`Plugin manifest is missing ${field}.`);
  }
  if (manifest?.name !== packageJson?.name) errors.push('Plugin manifest name must equal package.json name.');
  if (options.requireDirectoryName !== false && manifest?.name !== path.basename(path.resolve(root))) {
    errors.push('Plugin directory name must equal the plugin manifest name.');
  }
  if (manifest?.version !== packageJson?.version) errors.push('Plugin manifest version must equal package.json version.');
  if (!manifest?.author?.name) errors.push('Plugin author.name is required.');
  if (!manifest?.interface?.displayName || !manifest?.interface?.shortDescription) {
    errors.push('Plugin interface displayName and shortDescription are required.');
  }

  validateRelativePath(root, manifest?.skills, 'skills', errors, true);
  validateRelativePath(root, manifest?.mcpServers, 'mcpServers', errors, false);
  const servers = validateMcpConfig(root, mcp, errors);
  const skills = validateSkills(root, manifest?.skills, errors);

  if (errors.length) throw new Error(`Plugin validation failed:\n- ${errors.join('\n- ')}`);
  return {
    ok: true,
    name: manifest.name,
    version: manifest.version,
    mcpServer: Object.keys(servers)[0],
    skills
  };
}

function validateMcpConfig(root, mcp, errors) {
  const servers = mcp?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers) || Object.keys(servers).length !== 1) {
    errors.push('.mcp.json must define exactly one mcpServers entry.');
  }
  for (const [name, server] of Object.entries(servers || {})) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) errors.push(`MCP server ${name} must be an object.`);
    if (typeof server?.command !== 'string' || !server.command) errors.push(`MCP server ${name} requires command.`);
    if (!Array.isArray(server?.args) || !server.args.length || server.args.some(value => typeof value !== 'string')) {
      errors.push(`MCP server ${name} requires a non-empty string args array.`);
    }
    if (server?.cwd !== '.') errors.push(`MCP server ${name} must use the plugin root as cwd.`);
    const entry = String(server?.args?.[0] || '');
    if (entry.startsWith('./') && !fs.existsSync(path.join(root, entry))) errors.push(`MCP entrypoint does not exist: ${entry}`);
  }
  return servers || {};
}

function validateSkills(root, skillsPath, errors) {
  const relative = typeof skillsPath === 'string' ? skillsPath : './skills/';
  const skillRoot = path.resolve(root, relative);
  if (!fs.existsSync(path.join(skillRoot, 'PROVENANCE.md'))) errors.push('Skill package is missing skills/PROVENANCE.md.');
  const directories = fs.existsSync(skillRoot)
    ? fs.readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    : [];
  const skills = [];
  for (const directory of directories) {
    const rootForSkill = path.join(skillRoot, directory);
    const skillPath = path.join(rootForSkill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const label = `skills/${directory}/SKILL.md`;
    const source = readText(skillPath, errors, label);
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatter) {
      errors.push(`${label} requires YAML frontmatter.`);
      continue;
    }
    const fields = [...frontmatter[1].matchAll(/^([A-Za-z0-9_-]+):/gm)].map(match => match[1]);
    if (!fields.includes('name') || !fields.includes('description')) errors.push(`${label} frontmatter requires name and description.`);
    if (fields.some(field => !['name', 'description'].includes(field))) errors.push(`${label} frontmatter may contain only name and description.`);
    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() || '';
    const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
    if (name !== directory) errors.push(`${label} name must equal its directory.`);
    if (description.length < 40 || description.length > 500) errors.push(`${label} description must be 40-500 characters.`);
    const agentPath = path.join(rootForSkill, 'agents', 'openai.yaml');
    const agent = readText(agentPath, errors, `skills/${directory}/agents/openai.yaml`);
    for (const field of ['display_name:', 'short_description:', 'default_prompt:']) {
      if (!agent.includes(field)) errors.push(`skills/${directory}/agents/openai.yaml is missing ${field.slice(0, -1)}.`);
    }
    if (!agent.includes(`$${directory}`)) errors.push(`skills/${directory}/agents/openai.yaml default_prompt must reference $${directory}.`);
    if (fs.existsSync(path.join(rootForSkill, 'scripts'))) errors.push(`${label} may not ship executable scripts in the initial skill set.`);
    if (BANNED_SKILL_COMMANDS.test(source) || BANNED_SKILL_COMMANDS.test(agent)) {
      errors.push(`${label} contains a prohibited remote-download command.`);
    }
    skills.push(name);
  }
  if (!skills.includes('rel-ai-workflow')) errors.push('Skill package must include rel-ai-workflow.');
  const workflowRoot = path.join(skillRoot, 'rel-ai-workflow');
  const workflow = readText(path.join(workflowRoot, 'SKILL.md'), errors, 'skills/rel-ai-workflow/SKILL.md');
  for (const relativeReference of ['references/workflows.md', 'references/safety.md']) {
    if (!fs.existsSync(path.join(workflowRoot, relativeReference))) errors.push(`Core skill is missing ${relativeReference}.`);
    if (!workflow.includes(relativeReference)) errors.push(`Core SKILL.md must link ${relativeReference}.`);
  }
  return skills.sort();
}

function validateRelativePath(root, value, field, errors, directory) {
  if (typeof value !== 'string' || !value.startsWith('./')) {
    errors.push(`Plugin ${field} must be a relative path beginning with ./`);
    return;
  }
  const target = path.resolve(root, value);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`) && target !== path.resolve(root)) {
    errors.push(`Plugin ${field} escapes the plugin root.`);
    return;
  }
  if (!fs.existsSync(target)) errors.push(`Plugin ${field} path does not exist: ${value}`);
  else if (directory && !fs.statSync(target).isDirectory()) errors.push(`Plugin ${field} must reference a directory.`);
}

function readJson(file, errors, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { errors.push(`${label} is missing or invalid JSON: ${error.message}`); return null; }
}
function readText(file, errors, label) {
  try { return fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'); }
  catch (error) { errors.push(`${label} is missing: ${error.message}`); return ''; }
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(validatePlugin(root), null, 2));
}

export { validatePlugin };
