function compactSessionSummary(session = {}) {
  const workflow = session.workflow && typeof session.workflow === 'object' ? session.workflow : {};
  const changedFiles = unique(session.changedFiles || workflow.boundary?.changedFiles);
  const blockers = unique(workflow.completion?.blockers);
  const recommendations = unique(workflow.completion?.recommendations);
  const remaining = unique([
    ...blockers,
    ...recommendations,
    ...(workflow.recommendedActions || []).map(item => item?.reason || item?.action)
  ]);
  return prune({
    goal: String(session.objective || session.title || '').trim() || undefined,
    changes: changedFiles.length ? changedFiles : undefined,
    validation: compactValidation(session, workflow),
    remaining: remaining.length ? remaining : undefined,
    status: String(session.status || '').trim() || undefined
  });
}

function compactWorkflowContext(workflow) {
  if (!workflow || typeof workflow !== 'object') return workflow;
  const unchanged = workflow.unchanged === true;
  const boundary = unchanged ? undefined : compactBoundary(workflow.boundary);
  const risk = unchanged ? undefined : compactRisk(workflow.risk);
  const recommendedActions = compactActions(workflow.recommendedActions);
  const avoidActions = unchanged ? [] : compactAvoidActions(workflow.avoidActions);
  const completion = compactCompletion(workflow.completion);
  return prune({
    version: workflow.version,
    stage: String(workflow.stage || '').trim() || undefined,
    intent: String(workflow.intent || '').trim() || undefined,
    unchanged: unchanged ? true : undefined,
    boundary,
    risk,
    recommendedActions: recommendedActions.length ? recommendedActions : undefined,
    avoidActions: avoidActions.length ? avoidActions : undefined,
    completion,
    repeatCount: Number(workflow.repeatCount || 0) > 0 ? Number(workflow.repeatCount) : undefined
  });
}

function compactBoundary(value) {
  if (!value || typeof value !== 'object') return undefined;
  const changedFiles = unique(value.changedFiles);
  const impactedPaths = unique(value.impactedPaths);
  const affectedTests = unique(value.affectedTests);
  const packageIds = unique(value.packageIds);
  const level = String(value.level || '').trim();
  const meaningful = level && level !== 'file' || changedFiles.length || impactedPaths.length || affectedTests.length || packageIds.length;
  if (!meaningful) return undefined;
  return prune({
    level: level || undefined,
    packageIds: packageIds.length ? packageIds : undefined,
    changedFiles: changedFiles.length ? changedFiles : undefined,
    impactedPaths: impactedPaths.length ? impactedPaths : undefined,
    affectedTests: affectedTests.length ? affectedTests : undefined
  });
}

function compactRisk(value) {
  if (!value || typeof value !== 'object') return undefined;
  const level = String(value.level || '').trim();
  const reasons = unique(value.reasons).filter(reason => reason !== 'no task-owned mutation');
  if ((!level || level === 'low') && !reasons.length) return undefined;
  return prune({ level: level || undefined, reasons: reasons.length ? reasons : undefined });
}

function compactActions(values) {
  if (!Array.isArray(values)) return [];
  return values.map(item => prune({
    tool: String(item?.tool || '').trim() || undefined,
    action: String(item?.action || '').trim() || undefined,
    reason: String(item?.reason || '').trim() || undefined,
    blocking: item?.blocking === true ? true : undefined,
    args: item?.args && Object.keys(item.args).length ? item.args : undefined
  })).filter(item => item.tool || item.action || item.reason);
}

function compactAvoidActions(values) {
  if (!Array.isArray(values)) return [];
  return values.map(item => prune({
    action: String(item?.action || '').trim() || undefined,
    reason: String(item?.reason || '').trim() || undefined
  })).filter(item => item.action || item.reason);
}

function compactCompletion(value) {
  if (!value || typeof value !== 'object') return undefined;
  const blockers = unique(value.blockers);
  const recommendations = unique(value.recommendations);
  return prune({
    hardReady: value.hardReady === true,
    blockers: blockers.length ? blockers : undefined,
    recommendations: recommendations.length ? recommendations : undefined
  });
}

function compactValidation(session, workflow) {
  const status = String(session.validationStatus || session.validation || '').trim();
  if (status) return status;
  if (workflow.completion?.hardReady === true && unique(session.changedFiles || workflow.boundary?.changedFiles).length) return 'passed';
  return undefined;
}

function unique(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))];
}

function prune(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

export { compactSessionSummary, compactWorkflowContext };
