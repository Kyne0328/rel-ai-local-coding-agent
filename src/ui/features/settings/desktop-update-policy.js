function supportPolicyView(policy = {}) {
  const state = String(policy.state || 'unavailable');
  const minimumSupported = policy.minimumSupportedVersion ? `v${policy.minimumSupportedVersion}` : 'the supported release';
  const minimumRecommended = policy.minimumRecommendedVersion ? `v${policy.minimumRecommendedVersion}` : minimumSupported;
  if (state === 'current') return { label: 'Supported', tone: 'ok', description: `This installation meets the remote support baseline of ${minimumSupported}.` };
  if (state === 'recommended') return { label: 'Update recommended', tone: 'warn', description: `The remote support policy recommends ${minimumRecommended} or newer.` };
  if (state === 'deprecated') {
    const deadline = formatPolicyDate(policy.enforceAfter);
    return { label: 'Support ending', tone: 'warn', description: deadline
      ? `This version is below the remote support baseline of ${minimumSupported}. Update before ${deadline}.`
      : `This version is below the remote support baseline of ${minimumSupported}. Enforcement is not active yet.` };
  }
  if (state === 'required') return { label: 'Update required', tone: 'bad', description: `The remote support policy requires ${minimumSupported} or newer. MCP work is paused until the app is updated.` };
  if (state === 'emergency_blocked') return { label: 'Critical update', tone: 'bad', description: 'This exact application version is remotely blocked for an urgent update. MCP work is paused until the app is updated.' };
  return { label: 'Policy unavailable', tone: 'warn', description: 'The remote support policy is unavailable or expired. Rel.AI fails open and does not block MCP work.' };
}

function formatPolicyDate(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export { supportPolicyView };
