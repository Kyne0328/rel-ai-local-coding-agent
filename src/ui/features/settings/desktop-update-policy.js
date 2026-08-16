function supportPolicyView(policy = {}) {
  const state = String(policy.state || 'unavailable');
  const minimumSupported = policy.minimumSupportedVersion ? `v${policy.minimumSupportedVersion}` : 'the supported release';
  const minimumRecommended = policy.minimumRecommendedVersion ? `v${policy.minimumRecommendedVersion}` : minimumSupported;
  if (state === 'current') return { label: 'Supported', tone: 'ok', description: 'This version is supported.' };
  if (state === 'recommended') return { label: 'Update recommended', tone: 'warn', description: `A newer supported version, ${minimumRecommended} or later, is recommended.` };
  if (state === 'deprecated') {
    const deadline = formatPolicyDate(policy.enforceAfter);
    return { label: 'Support ending', tone: 'warn', description: deadline
      ? `Support for this version ends on ${deadline}. Update to ${minimumSupported} or later before then.`
      : `Support for this version is ending. Update to ${minimumSupported} or later to stay supported.` };
  }
  if (state === 'required') return { label: 'Update required', tone: 'bad', description: `Update to ${minimumSupported} or later to continue using Rel.AI with ChatGPT.` };
  if (state === 'emergency_blocked') return { label: 'Critical update', tone: 'bad', description: 'This version must be updated before Rel.AI can work with ChatGPT.' };
  return { label: 'Support check unavailable', tone: 'warn', description: 'Rel.AI could not check version support right now. You can keep using the app.' };
}

function formatPolicyDate(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export { supportPolicyView };
