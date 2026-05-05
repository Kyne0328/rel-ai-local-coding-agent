const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("./process");

async function doctor(config, args = {}) {
  const checks = [];
  checks.push(await binaryCheck("node", ["--version"], process.cwd(), config));
  checks.push(await binaryCheck("git", ["--version"], process.cwd(), config));
  if (config.allowGitHubCli || args.checkGh) checks.push(await binaryCheck("gh", ["--version"], process.cwd(), config));
  if (config.allowDocker || args.checkDocker) checks.push(await binaryCheck("docker", ["--version"], process.cwd(), config));
  const configChecks = configDiagnostics(config);
  const lineEnding = args.workspacePath ? lineEndingDiagnostics(args.workspacePath) : null;
  return { ok: checks.every((item) => item.ok) && configChecks.ok && (!lineEnding || lineEnding.ok), checks, config: configChecks, ...(lineEnding ? { lineEnding } : {}) };
}

async function binaryCheck(command, args, cwd, config) {
  const result = await runProcess(command, args, { cwd, shell: false }, config);
  return { name: command, ok: result.exitCode === 0, result: summarizeCommand(result) };
}

function configDiagnostics(config) {
  const findings = [];
  if (!config.stateDir) findings.push("stateDir is not configured.");
  if (config.allowArbitraryCommands) findings.push("allowArbitraryCommands is enabled. Keep this disabled unless you need it.");
  if (config.allowDestructiveTools) findings.push("allowDestructiveTools is enabled. This is risky outside disposable worktrees.");
  if (!config.approvalGates || config.approvalGates.push !== true) findings.push("approvalGates.push should normally stay true.");
  return { ok: findings.length === 0, findings };
}

function lineEndingDiagnostics(root) {
  const attrs = path.join(root, ".gitattributes");
  const editor = path.join(root, ".editorconfig");
  const findings = [];
  if (!fs.existsSync(attrs)) findings.push("Missing .gitattributes; Windows users may see LF/CRLF warnings.");
  else {
    const text = fs.readFileSync(attrs, "utf8");
    if (!/eol=lf/.test(text)) findings.push(".gitattributes does not pin LF for source files.");
  }
  if (!fs.existsSync(editor)) findings.push("Missing .editorconfig; editors may rewrite line endings inconsistently.");
  return { ok: findings.length === 0, root, findings, suggestedFix: "Add .gitattributes with source files set to eol=lf and keep autocrlf normalization out of generated smoke-test repos." };
}

module.exports = { doctor };
