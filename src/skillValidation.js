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

function skillMarkdown({ name, description, body } = {}) {
  const identity = validateSkillIdentity({ name, description });
  if (!identity.ok) throw new Error(identity.errors.join(' '));
  const content = String(body || '').trim();
  if (!content) throw new Error('Skill body must not be empty.');
  return `---\nname: ${identity.name}\ndescription: ${JSON.stringify(identity.description)}\n---\n\n${content}\n`;
}

export {
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MIN_SKILL_DESCRIPTION_LENGTH,
  SKILL_NAME_PATTERN,
  skillMarkdown,
  validateSkillIdentity
};
