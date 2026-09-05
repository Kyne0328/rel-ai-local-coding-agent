const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MIN_SKILL_DESCRIPTION_LENGTH = 40;
const MAX_SKILL_DESCRIPTION_LENGTH = 500;

function validateSkillIdentity({ name, description } = {}) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedDescription = String(description || '').trim();
  const errors = [];
  if (!SKILL_NAME_PATTERN.test(normalizedName) || normalizedName.length > MAX_SKILL_NAME_LENGTH) {
    errors.push(`Skill name must be 1-${MAX_SKILL_NAME_LENGTH} characters using lowercase letters, numbers, and single hyphens.`);
  }
  if (normalizedDescription.length < MIN_SKILL_DESCRIPTION_LENGTH || normalizedDescription.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    errors.push(`Skill description must be ${MIN_SKILL_DESCRIPTION_LENGTH}-${MAX_SKILL_DESCRIPTION_LENGTH} characters.`);
  }
  return { ok: errors.length === 0, name: normalizedName, description: normalizedDescription, errors };
}

function parseSkillDocument(source) {
  const content = String(source || '').replaceAll('\r\n', '\n');
  const errors = [];
  if (!content.startsWith('---\n')) return { ok: false, errors: ['Skill content must start with YAML frontmatter.'] };
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return { ok: false, errors: ['Skill frontmatter must end with --- on its own line.'] };
  const metadata = {};
  for (const line of content.slice(4, end).split('\n')) {
    const match = line.match(/^\s*(name|description)\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (Object.hasOwn(metadata, key)) errors.push(`Skill frontmatter contains duplicate '${key}'.`);
    else metadata[key] = unquote(match[2]);
  }
  const identity = validateSkillIdentity(metadata);
  errors.push(...identity.errors);
  const body = content.slice(end + 5).trim();
  if (!body) errors.push('Skill body must not be empty.');
  return {
    ok: errors.length === 0,
    name: identity.name,
    description: identity.description,
    body,
    content: `${content.trimEnd()}\n`,
    errors
  };
}

function validateSkillDocument(source, expectedName = '') {
  const parsed = parseSkillDocument(source);
  const expected = String(expectedName || '').trim().toLowerCase();
  if (parsed.ok && expected && parsed.name !== expected) {
    return { ...parsed, ok: false, errors: [`Skill frontmatter name '${parsed.name}' must match '${expected}'.`] };
  }
  return parsed;
}

function skillMarkdown({ name, description, body } = {}) {
  const identity = validateSkillIdentity({ name, description });
  if (!identity.ok) throw new Error(identity.errors.join(' '));
  const content = String(body || '').trim();
  if (!content) throw new Error('Skill body must not be empty.');
  return `---\nname: ${identity.name}\ndescription: ${JSON.stringify(identity.description)}\n---\n\n${content}\n`;
}

function unquote(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try { return String(JSON.parse(text)); } catch { return text.slice(1, -1); }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

export {
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MIN_SKILL_DESCRIPTION_LENGTH,
  SKILL_NAME_PATTERN,
  parseSkillDocument,
  skillMarkdown,
  validateSkillDocument,
  validateSkillIdentity
};
