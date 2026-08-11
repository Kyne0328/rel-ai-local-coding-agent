

const INTERNAL_STATUS_MAX_BYTES = 8 * 1024 * 1024;

function gitStatusArgs(options = {}) {
  return [
    'status',
    '--porcelain=v1',
    '-z',
    ...(options.branch === false ? [] : ['--branch']),
    '--untracked-files=all'
  ];
}

function parseGitStatus(output) {
  const text = String(output || '');
  return text.includes('\0') ? parsePorcelainV1Z(text) : parseLegacyStatus(text);
}

function parsePorcelainV1Z(text) {
  const records = String(text || '').split('\0');
  const entries = [];
  let branchRaw = '';
  let branch = null;
  let aheadBehind = null;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('## ')) {
      branchRaw = record;
      const parsed = parseStatusBranchLine(record);
      branch = parsed.branch;
      aheadBehind = parsed.aheadBehind;
      continue;
    }
    if (record.length < 3) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const path = record.slice(3);
    if (!path) continue;
    const renamedOrCopied = indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C';
    const originalPath = renamedOrCopied ? String(records[index + 1] || '') : '';
    if (renamedOrCopied) index += 1;
    entries.push({
      path,
      ...(originalPath ? { originalPath } : {}),
      indexStatus,
      worktreeStatus,
      untracked: indexStatus === '?' && worktreeStatus === '?',
      raw: originalPath
        ? `${indexStatus}${worktreeStatus} ${originalPath} -> ${path}`
        : `${indexStatus}${worktreeStatus} ${path}`
    });
  }

  return { branchRaw, branch, aheadBehind, entries };
}

function parseLegacyStatus(text) {
  const entries = [];
  let branchRaw = '';
  let branch = null;
  let aheadBehind = null;
  for (const line of String(text || '').split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith('## ')) {
      branchRaw = line;
      const parsed = parseStatusBranchLine(line);
      branch = parsed.branch;
      aheadBehind = parsed.aheadBehind;
      continue;
    }
    if (line.length < 3) continue;
    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const rawPath = line.slice(3).trim();
    const arrow = rawPath.indexOf(' -> ');
    const originalPath = arrow >= 0 ? rawPath.slice(0, arrow).trim() : '';
    const path = arrow >= 0 ? rawPath.slice(arrow + 4).trim() : rawPath;
    if (!path) continue;
    entries.push({
      path,
      ...(originalPath ? { originalPath } : {}),
      indexStatus,
      worktreeStatus,
      untracked: indexStatus === '?' && worktreeStatus === '?',
      raw: line
    });
  }
  return { branchRaw, branch, aheadBehind, entries };
}

function parseStatusBranchLine(line) {
  const text = String(line || '').replace(/^##\s+/, '').trim();
  const aheadMatch = /ahead (\d+)/.exec(text);
  const behindMatch = /behind (\d+)/.exec(text);
  const branchPart = text.split('...')[0].trim();
  return {
    branch: branchPart || null,
    aheadBehind: aheadMatch || behindMatch ? {
      ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
      behind: behindMatch ? Number(behindMatch[1]) : 0
    } : null
  };
}

function formatGitStatus(parsed) {
  const lines = [];
  if (parsed?.branchRaw) lines.push(parsed.branchRaw);
  for (const entry of parsed?.entries || []) lines.push(entry.raw || `${entry.indexStatus}${entry.worktreeStatus} ${entry.path}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function statusMapFromOutput(output) {
  const map = new Map();
  for (const entry of parseGitStatus(output).entries) {
    map.set(entry.path, `${entry.indexStatus}${entry.worktreeStatus}`);
  }
  return map;
}

export { INTERNAL_STATUS_MAX_BYTES, gitStatusArgs, parseGitStatus,  formatGitStatus, statusMapFromOutput };
