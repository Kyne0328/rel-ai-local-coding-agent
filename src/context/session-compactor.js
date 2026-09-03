function compactSessionSummary(session = {}, options = {}) {
  const workflow = session.workflow && typeof session.workflow === 'object' ? session.workflow : {};
  const changedFiles = unique(session.changedFiles || workflow.boundary?.changedFiles);
  const blockers = unique(workflow.completion?.blockers);
  const recommendations = unique(workflow.completion?.recommendations);
  const remaining = unique([
    ...blockers,
    ...recommendations,
    ...(workflow.recommendedActions || []).map(item => item?.reason || item?.action)
  ]);
  const summary = String(session.resultSummary || session.summary || '').trim();
  const current = compactCurrentState(session);
  const recentActivity = compactRecoveryActivity(session.events);
  const recentEvidence = recentActivity.length ? recentActivity : compactRecoveryEvidence(session.workflowEvidence);
  return prune({
    goal: String(session.objective || session.title || '').trim() || undefined,
    summary: summary || undefined,
    changes: changedFiles.length ? changedFiles : undefined,
    validation: compactValidation(session, workflow),
    hostContextSummary: String(session.contextSummary || '').trim() || undefined,
    current,
    recentEvidence: recentEvidence.length ? recentEvidence : undefined,
    remaining: remaining.length ? remaining : undefined,
    continuity: options.continuity && Object.keys(options.continuity).length ? options.continuity : undefined,
    status: String(session.status || '').trim() || undefined
  });
}

function compactCurrentState(session) {
  const stage = String(session.currentStage || '').trim();
  const activity = String(session.currentActivity || session.operation || '').trim();
  const tool = String(session.lastTool || '').trim();
  const outcome = String(session.lastOutcome || '').trim();
  if (!stage && !activity && !tool && !outcome) return undefined;
  return prune({
    stage: stage || undefined,
    activity: activity || undefined,
    tool: tool || undefined,
    outcome: outcome || undefined
  });
}

function compactRecoveryActivity(values) {
  if (!Array.isArray(values)) return [];
  return values.map(item => {
    const operation = String(item?.metadata?.internalOperation || '').trim();
    const outcome = String(item?.status || '').trim();
    if (operation === 'work.begin' || operation === 'work.status' || outcome === 'running') return null;
    const tool = String(item?.tool?.name || item?.tool || '').trim();
    const summary = String(item?.summary || item?.message || '').trim();
    const paths = unique([
      item?.target?.workspaceRelativePath,
      ...(Array.isArray(item?.metadata?.changedFiles) ? item.metadata.changedFiles : [])
    ]).slice(0, 5);
    if (!tool && !summary && !outcome && !paths.length) return null;
    return prune({
      kind: String(item?.category || 'activity').trim() || 'activity',
      outcome: outcome || undefined,
      tool: tool || undefined,
      summary: summary || undefined,
      paths: paths.length ? paths : undefined
    });
  }).filter(Boolean).slice(-3);
}

function compactRecoveryEvidence(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(-3).map(item => {
    const paths = unique(item?.paths).slice(0, 5);
    return prune({
      kind: String(item?.kind || '').trim() || undefined,
      outcome: String(item?.outcome || '').trim() || undefined,
      tool: String(item?.sourceTool || '').trim() || undefined,
      check: String(item?.commandId || '').trim() || undefined,
      paths: paths.length ? paths : undefined
    });
  }).filter(item => Object.keys(item).length);
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
