function pruneEmpty(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && (!Array.isArray(item) || item.length > 0)));
}

function slimCompactPublicResult(publicName, action, value) {
  if (!value || typeof value !== 'object') return value;
  if (publicName === 'relai_work' && action === 'begin') {
    const next = { ...value };
    delete next.nextAction;
    if (next.workspaceBinding?.alias === next.workspace) delete next.workspaceBinding;
    return pruneEmpty(next);
  }
  if (publicName === 'relai_work' && action === 'status' && value.toolSurface) {
    return {
      ...value,
      toolSurface: pruneEmpty({
        schemaVersion: value.toolSurface.schemaVersion,
        toolSurfaceVersion: value.toolSurface.toolSurfaceVersion,
        profile: value.toolSurface.profile,
        toolCount: value.toolSurface.toolCount
      })
    };
  }
  return pruneEmpty(value);
}

export { slimCompactPublicResult };
