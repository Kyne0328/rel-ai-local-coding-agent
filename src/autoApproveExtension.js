const pkg = require("../package.json");
const { getVersion } = require("./version");

function autoApproveSettings(config) {
  const cfg = config.autoApproveAppRequests || {};
  return {
    ok: true,
    enabled: cfg.enabled === true,
    pollMs: Number(cfg.pollMs || 1200),
    warningAccepted: cfg.warningAccepted === true,
    product: pkg.name,
    version: getVersion(),
    mode: "chrome_extension",
    extensionOnly: true,
    warning: "Auto-approving ChatGPT app requests can authorize local repo reads/writes/verification without a manual click. Enable only on your own trusted machine and disable it after the task. Control approval from the Chrome extension popup — the dashboard does not need to be enabled."
  };
}

module.exports = { autoApproveSettings };
