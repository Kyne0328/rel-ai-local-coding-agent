function projectServiceActivityEvent(event = {}) {
  if (event.phase === 'progress') return null;
  return {
    phase: String(event.phase || ''),
    revision: Number(event.revision || 0),
    activeConnectorCalls: Math.max(0, Number(event.activeConnectorCalls || 0)),
    activeCalls: Math.max(0, Number(event.activeCalls || 0)),
    activeTaskCount: Math.max(0, Number(event.activeTaskCount || 0)),
    taskId: String(event.taskId || ''),
    operationId: String(event.operationId || event.activityEvent?.operationId || event.activityEvent?.eventId || ''),
    workspace: String(event.workspace || event.task?.workspace || ''),
    tool: String(event.tool || event.task?.lastTool || event.task?.tool || ''),
    operation: String(event.operation || event.task?.operation || event.task?.lastOperation || ''),
    ok: event.ok,
    error: typeof event.error === 'object' ? String(event.error?.message || '') : String(event.error || ''),
    task: event.task ? projectServiceTask(event.task) : undefined
  };
}

function projectServiceActivitySnapshot(activity = {}) {
  return {
    ...activity,
    tasks: Array.isArray(activity.tasks) ? activity.tasks.map(projectServiceTask) : [],
    lastTask: activity.lastTask ? projectServiceTask(activity.lastTask) : null
  };
}

function projectServiceTask(task = {}) {
  const {
    events: _events,
    currentOperations: _currentOperations,
    principalFingerprint: _principalFingerprint,
    ...summary
  } = task || {};
  return summary;
}

export { projectServiceActivityEvent, projectServiceActivitySnapshot };
