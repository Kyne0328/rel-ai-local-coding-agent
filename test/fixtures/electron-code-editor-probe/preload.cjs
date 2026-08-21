const { contextBridge } = require('electron');

const content = [
  'const answer = 42;',
  'function greet(name) {',
  '  return `hello ${name}`; // greeting',
  '}',
  'greet("Rel.AI");'
].join('\n');

contextBridge.exposeInMainWorld('relaiDesktop', {
  codeWorkspace: {
    editors: async () => ({ editors: [] }),
    get: async () => ({
      ok: true,
      work_id: 'probe-task',
      workspace: 'app',
      workspaceMode: 'isolated',
      integrationStatus: 'pending',
      status: 'running',
      writable: true,
      files: ['src/example.js', 'src/new.js', 'src/untouched.js'],
      changedFiles: ['src/example.js', 'src/new.js'],
      changedFileStatuses: {
        'src/example.js': { code: 'M', label: 'Modified', tone: 'warning' },
        'src/new.js': { code: 'U', label: 'Untracked', tone: 'info' }
      },
      fileCount: 3,
      truncated: false
    }),
    read: async () => ({
      ok: true,
      work_id: 'probe-task',
      workspace: 'app',
      path: 'src/example.js',
      content,
      sha256: 'a'.repeat(64),
      bytes: Buffer.byteLength(content),
      writable: true,
      language: 'javascript'
    }),
    diff: async () => ({
      ok: true,
      work_id: 'probe-task',
      workspace: 'app',
      path: 'src/example.js',
      content,
      baseContent: 'const answer = 0;\n',
      sha256: 'a'.repeat(64),
      language: 'javascript',
      writable: true
    }),
    write: async () => ({ ok: true, changed: true, sha256: 'b'.repeat(64) }),
    openIde: async () => ({ ok: true, editor: { label: 'Probe IDE' } })
  }
});
