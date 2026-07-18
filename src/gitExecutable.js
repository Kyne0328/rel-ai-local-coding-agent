'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fixedCandidates() {
  if (process.platform === 'win32') {
    return [
      String.raw`C:\Program Files\Git\cmd\git.exe`,
      String.raw`C:\Program Files\Git\bin\git.exe`,
      String.raw`C:\Program Files (x86)\Git\cmd\git.exe`
    ];
  }
  return ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
}

function pathCandidates() {
  const names = process.platform === 'win32' ? ['git.exe', 'git.cmd'] : ['git'];
  const directories = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return directories.flatMap(directory => names.map(name => path.join(directory, name)));
}

function resolveGitExecutable() {
  const configured = String(process.env.REL_AI_MCP_GIT || '').trim();
  const candidates = [configured, ...pathCandidates(), ...fixedCandidates()].filter(Boolean);
  return candidates.find(candidate => path.isAbsolute(candidate) && fs.existsSync(candidate)) || '';
}

module.exports = { resolveGitExecutable };
