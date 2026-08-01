const MCP_PROTOCOL_VERSION = '2026-07-28';
const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
const MISSING_TASKS_CAPABILITY_CODE = -32003;
const TASK_METHODS = Object.freeze(['tasks/get', 'tasks/update', 'tasks/cancel']);
const LEGACY_LIFECYCLE_METHODS = Object.freeze(['initialize', 'notifications/initialized']);

export {
  LEGACY_LIFECYCLE_METHODS,
  MCP_PROTOCOL_VERSION,
  MISSING_TASKS_CAPABILITY_CODE,
  TASK_METHODS,
  TASKS_EXTENSION_ID
};
