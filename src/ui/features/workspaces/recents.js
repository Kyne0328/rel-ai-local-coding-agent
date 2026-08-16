const STORAGE_KEY = 'relai_recent_workspaces_v1';
const MAX_RECENT = 5;

export function recentWorkspaceAliases(workspaces = []) {
  const available = new Set((Array.isArray(workspaces) ? workspaces : []).map(item => String(item?.alias || '')).filter(Boolean));
  const stored = readStored();
  const recent = stored.filter(alias => available.has(alias)).slice(0, MAX_RECENT);
  if (recent.length !== stored.length) writeStored(recent);
  return recent;
}

export function recordRecentWorkspace(alias) {
  const clean = String(alias || '').trim();
  if (!clean) return;
  const next = [clean, ...readStored().filter(item => item !== clean)].slice(0, MAX_RECENT);
  writeStored(next);
}

export function renameRecentWorkspace(previousAlias, nextAlias) {
  const previous = String(previousAlias || '').trim();
  const next = String(nextAlias || '').trim();
  if (!previous || !next) return;
  const renamed = readStored().map(alias => alias === previous ? next : alias);
  writeStored([...new Set(renamed)].slice(0, MAX_RECENT));
}

export function removeRecentWorkspace(alias) {
  const clean = String(alias || '').trim();
  if (!clean) return;
  writeStored(readStored().filter(item => item !== clean));
}

function readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(String).map(item => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeStored(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
}
