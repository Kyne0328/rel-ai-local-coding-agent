const MAX_DIAGNOSTICS_PER_WORKSPACE = 32;
const diagnosticsByWorkspace = new Map();

function repositoryFreshness(status = {}, generation = null) {
  const metadata = status?.metadata || {};
  if (metadata.freshness === 'partial' || metadata.truncated === true) return 'partial';
  if (status?.dirty === true || metadata.needsReconcile === true || metadata.freshness === 'stale') return 'stale';
  const verifiedGeneration = Number(metadata.generation || 0);
  const requestedGeneration = Number(generation?.id || generation || 0);
  if (verifiedGeneration > 0 && (!requestedGeneration || verifiedGeneration === requestedGeneration)) return 'current';
  return 'cached-unverified';
}

function recordIntelligenceDiagnostic(workspace, code, error) {
  const alias = workspaceAlias(workspace);
  if (!alias) return;
  const entries = diagnosticsByWorkspace.get(alias) || [];
  entries.push({
    code: String(code || 'intelligence_error').slice(0, 80),
    message: String(error instanceof Error ? error.message : error || 'Unknown intelligence error').slice(0, 500),
    at: new Date().toISOString()
  });
  diagnosticsByWorkspace.set(alias, entries.slice(-MAX_DIAGNOSTICS_PER_WORKSPACE));
}

function recentIntelligenceDiagnostics(workspace, limit = 5) {
  const alias = workspaceAlias(workspace);
  if (!alias) return [];
  const bounded = Math.max(1, Math.min(MAX_DIAGNOSTICS_PER_WORKSPACE, Number(limit) || 5));
  return (diagnosticsByWorkspace.get(alias) || []).slice(-bounded).map(item => ({ ...item }));
}

function workspaceAlias(workspace) {
  return String(typeof workspace === 'string' ? workspace : workspace?.alias || '').trim();
}

export { recentIntelligenceDiagnostics, recordIntelligenceDiagnostic, repositoryFreshness };
