import * as path from 'node:path';

function assertSafeWorkspaceRoot(rawPath, label = 'Workspace path') {
  const text = String(rawPath || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  if (!path.isAbsolute(text)) throw new Error(`${label} must be absolute.`);
  const resolved = path.resolve(text);
  const strip = value => {
    let current = String(value || '');
    while (current.endsWith('/') || current.endsWith('\\')) current = current.slice(0, -1);
    return current || String(value || '');
  };
  const parsed = path.parse(resolved);
  const root = strip(parsed.root);
  const normalized = strip(resolved).toLowerCase();
  const unsafe = new Set([root.toLowerCase()]);

  for (const item of ['Windows', 'Program Files', 'Program Files (x86)', 'Users', 'etc', 'usr', 'bin', 'sbin', 'var', 'tmp', 'home', 'System', 'Library', 'Applications']) {
    unsafe.add(strip(path.join(parsed.root, item)).toLowerCase());
  }

  if (unsafe.has(normalized)) {
    throw new Error(`Unsafe workspace path refused: ${resolved}. Choose a project directory, not a system root.`);
  }
  return resolved;
}

export { assertSafeWorkspaceRoot };
