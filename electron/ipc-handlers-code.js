function registerCodeWorkspaceIpc({
  ipcMain,
  dashboardOnly,
  getTaskCodeWorkspace,
  readTaskCodeDiff,
  listCodeEditors,
  openTaskCodeIde
}) {
  ipcMain.handle('desktop:code:get', (event, payload) => dashboardOnly(event, () => getTaskCodeWorkspace(normalizeTaskPayload(payload))));
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

export { registerCodeWorkspaceIpc };
