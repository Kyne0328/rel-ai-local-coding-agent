function createApprovalTokenManager({
  readGuiConfig,
  saveLauncherConfig,
  generateToken,
  oauthProvider,
  restartDesktop
} = {}) {
  for (const [name, value] of Object.entries({ readGuiConfig, saveLauncherConfig, generateToken, oauthProvider, restartDesktop })) {
    if (typeof value !== 'function' && name !== 'oauthProvider') throw new TypeError(`${name} is required.`);
  }
  if (!oauthProvider?.revokeAuthorizations || !oauthProvider?.authorizationStatus) {
    throw new TypeError('oauthProvider authorization controls are required.');
  }

  function status() {
    return oauthProvider.authorizationStatus();
  }

  async function replace(request = {}) {
    if (String(request.confirmation || '').trim() !== 'REPLACE') {
      throw new Error('Type REPLACE to confirm approval-token replacement.');
    }

    const current = readGuiConfig();
    const approvalToken = generateToken(32);
    const replacement = connectionConfig(current, approvalToken);

    try {
      saveLauncherConfig(replacement);
    } catch (error) {
      throw new Error(`Approval-token replacement was not started. The current token and OAuth grants are unchanged. ${messageOf(error)}`, { cause: error });
    }

    let revoked;
    try {
      revoked = oauthProvider.revokeAuthorizations();
    } catch (error) {
      try {
        saveLauncherConfig(connectionConfig(current, current.token));
      } catch (rollbackError) {
        throw new Error(`OAuth revocation failed and the original approval token could not be restored. Open Diagnostics immediately. Revocation error: ${messageOf(error)} Rollback error: ${messageOf(rollbackError)}`, { cause: rollbackError });
      }
      throw new Error(`Approval-token replacement was rolled back because OAuth revocation failed. The original token was restored, although some OAuth grants may already be revoked. ${messageOf(error)}`, { cause: error });
    }

    let desktopStatus;
    try {
      desktopStatus = await restartDesktop();
    } catch (error) {
      desktopStatus = { serverRunning: false, error: messageOf(error) };
    }
    const restartRequired = desktopStatus?.serverRunning !== true;
    return {
      ok: !restartRequired,
      approvalToken,
      revoked,
      authorization: status(),
      status: desktopStatus,
      restartRequired,
      error: restartRequired
        ? `The approval token was replaced and ChatGPT access was revoked, but Rel.AI did not restart. ${desktopStatus?.error || 'Restart the service from the dashboard or tray.'}`
        : ''
    };
  }

  return { replace, status };
}

function connectionConfig(current, token) {
  return {
    ...(current.connectionMode ? { connectionMode: current.connectionMode } : {}),
    ...(current.gatewayOrigin ? { gatewayOrigin: current.gatewayOrigin } : {}),
    port: current.port,
    token,
    ngrokDomain: current.ngrokDomain,
    ngrokAuthtoken: current.ngrokAuthtoken
  };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { createApprovalTokenManager };
