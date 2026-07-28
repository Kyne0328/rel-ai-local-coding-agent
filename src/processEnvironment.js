'use strict';

const SAFE_INHERITED_KEYS = Object.freeze([
  'ALLUSERSPROFILE',
  'APPDATA',
  'CHROME_CRASHPAD_PIPE_NAME',
  'CI',
  'COLORTERM',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'ComSpec',
  'DriverData',
  'GIT_ASKPASS',
  'GIT_EXEC_PATH',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'LOGONSERVER',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'PSModulePath',
  'PUBLIC',
  'SHELL',
  'SSH_AGENT_PID',
  'SSH_AUTH_SOCK',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TERM_PROGRAM',
  'TMP',
  'USERDOMAIN',
  'USERDOMAIN_ROAMINGPROFILE',
  'USERNAME',
  'USERPROFILE',
  'windir'
]);

const ALWAYS_BLOCKED_KEYS = Object.freeze(new Set([
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS'
]));

function makeProcessEnvironment(extra = {}, options = {}) {
  const source = options.source && typeof options.source === 'object' ? options.source : process.env;
  const inheritedKeys = new Set(SAFE_INHERITED_KEYS);
  for (const key of normalizeAllowedKeys(options.allow)) inheritedKeys.add(key);

  const env = {};
  for (const key of inheritedKeys) {
    if (ALWAYS_BLOCKED_KEYS.has(key)) continue;
    if (source[key] != null) env[key] = String(source[key]);
  }
  env.REL_AI_MCP = '1';

  for (const [key, value] of Object.entries(extra || {})) {
    if (ALWAYS_BLOCKED_KEYS.has(key) && options.allowDangerous !== true) {
      throw new Error(`${key} cannot be passed to child processes.`);
    }
    env[key] = String(value);
  }
  return env;
}

function normalizeAllowedKeys(value) {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  return [...new Set(items.map(item => String(item || '').trim()).filter(isValidEnvironmentKey))];
}

function isValidEnvironmentKey(key) {
  return Boolean(key) && !key.includes('=') && !key.includes('\0');
}

module.exports = {
  SAFE_INHERITED_KEYS,
  makeProcessEnvironment,
  normalizeAllowedKeys
};
