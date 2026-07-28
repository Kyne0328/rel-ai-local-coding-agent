import * as fs from "node:fs";
import * as path from "node:path";
import { runProcess, summarizeCommand } from "../process.js";
import { clampNumber } from "./limits.js";
import { relaiHttpProbe, resolveLocalRouteTarget } from "./httpProbe.js";

const SAFE_UI_CHECK_NAME = /^[A-Za-z0-9:._-]+$/;

function readPackageScripts(root) {
  const packageJson = path.join(root, "package.json");
  if (!fs.existsSync(packageJson)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
    return typeof pkg?.scripts === "object" ? pkg.scripts : {};
  } catch {
    return {};
  }
}

async function runNamedUiCheck(workspace, config, args, toolName) {
  const check = String(args.check || args.command || "").trim();
  if (!check) throw new Error(`${toolName} requires check.`);
  const scripts = readPackageScripts(workspace.path);
  const available = Object.keys(scripts).sort((a, b) => a.localeCompare(b));
  if (!SAFE_UI_CHECK_NAME.test(check) || !Object.hasOwn(scripts, check)) {
    return {
      ok: false,
      workspace: workspace.alias,
      mode: "ui-check",
      check,
      error: `Unknown check '${check}'. ${toolName} runs named package.json scripts only. Available: ${available.join(", ") || "(none)"}.`,
      availableChecks: available
    };
  }
  const npmCommand = `npm run ${check}`;
  const result = await runProcess(npmCommand, [], {
    cwd: workspace.path,
    shell: true,
    commandString: npmCommand,
    timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
  }, config);
  return {
    ok: result.exitCode === 0,
    workspace: workspace.alias,
    mode: "ui-check",
    check,
    ...summarizeCommand(result)
  };
}

async function relaiUiCheck(workspace, config, args = {}) {
  return runNamedUiCheck(workspace, config, args, "relai_ui_check");
}

export { relaiHttpProbe, relaiUiCheck, resolveLocalRouteTarget };
