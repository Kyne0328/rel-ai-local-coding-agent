const { runProcess, summarizeCommand } = require("./process");
const { safeCommandPolicy } = require("./safety");

function requireGh(config) {
  if (!config.allowGitHubCli) throw new Error("GitHub CLI is disabled. Set allowGitHubCli: true in config.json.");
}

async function prCommentsRead(config, workspace, args = {}) {
  requireGh(config);
  const pr = String(args.pr || "").trim();
  const ghArgs = pr ? ["pr", "view", pr, "--comments", "--json", "number,title,url,comments,reviews"] : ["pr", "view", "--comments", "--json", "number,title,url,comments,reviews"];
  const result = await runProcess("gh", ghArgs, { cwd: workspace.path, shell: false }, config);
  let parsed = null;
  try { parsed = result.stdout ? JSON.parse(result.stdout) : null; } catch (_error) {}
  return { ok: result.exitCode === 0, pr: pr || "current", parsed, result: summarizeCommand(result) };
}

function requestedChangesPlan(config, workspace, args = {}) {
  const comments = args.comments || args.review || {};
  const text = typeof comments === "string" ? comments : JSON.stringify(comments, null, 2);
  const findings = [];
  for (const line of text.split(/\r?\n/)) {
    if (/request|change|fix|bug|failing|nit|suggest/i.test(line)) findings.push(line.trim().slice(0, 500));
  }
  return { ok: true, workspace: workspace.alias, pr: args.pr || "", findings: findings.slice(0, 100), suggestedSteps: ["Read requested files and comments.", "Patch the smallest affected area.", "Run configured validation.", "Push update and reply to reviewer comments."] };
}

async function replyToReview(config, workspace, args = {}) {
  requireGh(config);
  const pr = String(args.pr || "").trim();
  const body = String(args.body || args.message || "").trim();
  if (!body) throw new Error("body/message is required.");
  safeCommandPolicy(body);
  const ghArgs = pr ? ["pr", "comment", pr, "--body", body] : ["pr", "comment", "--body", body];
  const result = await runProcess("gh", ghArgs, { cwd: workspace.path, shell: false }, config);
  return { ok: result.exitCode === 0, pr: pr || "current", result: summarizeCommand(result) };
}

module.exports = { prCommentsRead, requestedChangesPlan, replyToReview };
