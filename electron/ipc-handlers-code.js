function registerCodeWorkspaceIpc({
  ipcMain,
  dashboardOnly,
  getTaskCodeWorkspace,
  readTaskCodeFile,
  writeTaskCodeFile,
  readTaskCodeDiff,
  listCodeEditors,
  openTaskCodeIde
}) {
  ipcMain.handle('desktop:code:get', (event, payload) => dashboardOnly(event, () => getTaskCodeWorkspace(normalizeTaskPayload(payload))));
  ipcMain.handle('desktop:code:read', (event, payload) => dashboardOnly(event, () => readTaskCodeFile(normalizeFilePayload(payload))));
  ipcMain.handle('desktop:code:write', (event, payload) => dashboardOnly(event, () => writeTaskCodeFile(normalizeWritePayload(payload))));
  ipcMain.handle('desktop:code:diff', (event, payload) => dashboardOnly(event, () => readTaskCodeDiff(normalizeFilePayload(payload))));
  ipcMain.handle('desktop:code:editors', event => dashboardOnly(event, listCodeEditors));
  ipcMain.handle('desktop:code:open-ide', (event, payload) => dashboardOnly(event, () => openTaskCodeIde(normalizeIdePayload(payload))));
}

function normalizeTaskPayload(payload = {}) {
  return { taskId: boundedText(payload?.taskId, 'taskId', 200) };
}

function normalizeFilePayload(payload = {}) {
  return {
    ...normalizeTaskPayload(payload),
    path: boundedText(payload?.path, 'path', 512)
  };
}

function normalizeWritePayload(payload = {}) {
  const normalized = normalizeFilePayload(payload);
  if (typeof payload?.content !== 'string') throw new Error('content must be a string.');
  if (Buffer.byteLength(payload.content, 'utf8') > 2 * 1024 * 1024) throw new Error('content exceeds the 2 MiB code editor limit.');
  return {
    ...normalized,
    content: payload.content,
    expectedSha256: optionalHash(payload?.expectedSha256)
  };
}

function normalizeIdePayload(payload = {}) {
  return {
    ...normalizeTaskPayload(payload),
    editorId: boundedText(payload?.editorId, 'editorId', 40)
  };
}

function boundedText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  if (text.includes('\u0000')) throw new Error(`${label} contains an invalid character.`);
  return text;
}

function optionalHash(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^[a-f0-9]{64}$/i.test(text)) throw new Error('expectedSha256 must be a SHA-256 hex digest.');
  return text;
}

export { registerCodeWorkspaceIpc };
