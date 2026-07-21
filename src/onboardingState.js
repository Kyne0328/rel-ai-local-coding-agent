const fs = require("node:fs");
const path = require("node:path");
const connection = require("./connectionProfile");
const { readConfig } = require("./config");

function onboardingPath() {
  return path.join(connection.stateDir(), "onboarding.json");
}

function readOnboardingState() {
  try { return JSON.parse(fs.readFileSync(onboardingPath(), "utf8")); }
  catch { return null; }
}

function writeOnboardingState(state) {
  fs.mkdirSync(connection.stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(onboardingPath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return state;
}

function inferExistingSetup() {
  try {
    const config = readConfig({ allowMissing: true });
    const workspaceCount = Object.keys(config.workspaces || {}).length;
    if (workspaceCount === 0) return null;
    return writeOnboardingState({
      completed: true,
      skipped: false,
      migrated: true,
      workspaceCount,
      updatedAt: new Date().toISOString()
    });
  } catch {
    return null;
  }
}

function getOnboardingStatus() {
  const state = readOnboardingState() || inferExistingSetup();
  const completed = state?.completed === true;
  const skipped = state?.skipped === true;
  return {
    completed,
    skipped,
    migrated: state?.migrated === true,
    needsOnboarding: !completed && !skipped
  };
}

module.exports = { getOnboardingStatus, writeOnboardingState };
