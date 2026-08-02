const TOOL_PROFILE = Object.freeze({
  COMPACT: 'compact',
  LEGACY: 'legacy'
});
const TOOL_PROFILE_VALUES = new Set(Object.values(TOOL_PROFILE));

function resolveToolProfile(value) {
  const profile = String(value || TOOL_PROFILE.COMPACT).trim().toLowerCase();
  if (!TOOL_PROFILE_VALUES.has(profile)) {
    throw new Error(
      `Invalid Rel.AI tool profile '${profile || '(empty)'}'. Set toolProfile to exactly 'compact' or 'legacy'; profiles cannot be combined.`
    );
  }
  return profile;
}

function profileFromConfig(config = {}) {
  return resolveToolProfile(config.toolProfile);
}

export { TOOL_PROFILE, profileFromConfig, resolveToolProfile };
