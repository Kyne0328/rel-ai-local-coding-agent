import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function createTaskCodeIdeLauncher({ shell, platform = process.platform, env = process.env } = {}) {
  const editors = detectEditors({ platform, env });

  function listEditors() {
    return [
      ...editors.map(editor => ({ id: editor.id, label: editor.label })),
      { id: 'system', label: platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'File manager' }
    ];
  }

  async function open(workspacePath, editorId) {
    const target = path.resolve(String(workspacePath || ''));
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error('The task workspace is not available.');
    const id = String(editorId || '').trim();
    if (id === 'system') {
      const message = await shell.openPath(target);
      if (message) throw new Error(message);
      return { ok: true, editor: { id: 'system', label: listEditors().at(-1).label } };
    }
    const editor = editors.find(item => item.id === id);
    if (!editor) throw new Error('The selected IDE is not installed or is no longer available.');
    launchEditor(editor, target);
    return { ok: true, editor: { id: editor.id, label: editor.label } };
  }

  return { listEditors, open };
}

function detectEditors({ platform, env }) {
  const candidates = editorCandidates(platform, env);
  const found = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    const executable = candidate.executable;
    if (!executable || !fs.existsSync(executable)) continue;
    found.push(candidate);
    seen.add(candidate.id);
  }
  return found;
}

function editorCandidates(platform, env) {
  if (platform === 'win32') {
    const local = String(env.LOCALAPPDATA || '');
    const programFiles = [String(env.ProgramFiles || ''), String(env['ProgramFiles(x86)'] || '')].filter(Boolean);
    return [
      candidate('vscode', 'Visual Studio Code', path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe')),
      ...programFiles.map(root => candidate('vscode', 'Visual Studio Code', path.join(root, 'Microsoft VS Code', 'Code.exe'))),
      candidate('cursor', 'Cursor', path.join(local, 'Programs', 'cursor', 'Cursor.exe')),
      candidate('cursor', 'Cursor', path.join(local, 'Programs', 'Cursor', 'Cursor.exe')),
      candidate('windsurf', 'Windsurf', path.join(local, 'Programs', 'Windsurf', 'Windsurf.exe'))
    ];
  }
  if (platform === 'darwin') {
    return [
      macCandidate('vscode', 'Visual Studio Code', '/Applications/Visual Studio Code.app'),
      macCandidate('cursor', 'Cursor', '/Applications/Cursor.app'),
      macCandidate('windsurf', 'Windsurf', '/Applications/Windsurf.app'),
      macCandidate('zed', 'Zed', '/Applications/Zed.app')
    ];
  }
  return [
    candidate('vscode', 'Visual Studio Code', '/usr/bin/code'),
    candidate('vscode', 'Visual Studio Code', '/usr/local/bin/code'),
    candidate('vscode', 'Visual Studio Code', '/snap/bin/code'),
    candidate('cursor', 'Cursor', '/usr/bin/cursor'),
    candidate('cursor', 'Cursor', '/usr/local/bin/cursor'),
    candidate('windsurf', 'Windsurf', '/usr/bin/windsurf'),
    candidate('windsurf', 'Windsurf', '/usr/local/bin/windsurf'),
    candidate('zed', 'Zed', '/usr/bin/zed'),
    candidate('zed', 'Zed', '/usr/local/bin/zed')
  ];
}

function candidate(id, label, executable) {
  return { id, label, executable, args: target => [target] };
}

function macCandidate(id, label, appPath) {
  return { id, label, executable: appPath, macApp: label };
}

function launchEditor(editor, target) {
  const executable = editor.macApp ? '/usr/bin/open' : editor.executable;
  const args = editor.macApp ? ['-a', editor.macApp, target] : editor.args(target);
  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false
  });
  child.on('error', () => {});
  child.unref();
}

export { createTaskCodeIdeLauncher, detectEditors };
