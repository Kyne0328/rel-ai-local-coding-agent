#!/usr/bin/env node
const path = require("node:path");
const { readConfig, writeConfig, getConfigPath, makeDefaultConfig } = require("../src/config");
const productUx = require("../src/productUx");

function printUsage() {
  console.log(`Usage:
  relai-mcp-config init
  relai-mcp-config show
  relai-mcp-config workspace add <alias> <absolute-path>
  relai-mcp-config test-command add <alias> <key> <command...>
  relai-mcp-config command add <alias> <key> <command...>
  relai-mcp-config doctor [--fix] [workspace-path]
  relai-mcp-config setup [alias] [workspace-path]
  relai-mcp-config import-relai [source-path]
  relai-mcp-config state export <output-path>
  relai-mcp-config state import <input-path> --confirm
  relai-mcp-config set allowGitHubCli <true|false>
  relai-mcp-config set allowDocker <true|false>
  relai-mcp-config set allowArbitraryCommands <true|false>
  relai-mcp-config set allowDestructiveTools <true|false>
  relai-mcp-config set permissionProfile <read-only|patch|test|pr|admin>
  relai-mcp-config set worktreeRoot <absolute-path>
  relai-mcp-config set dashboardEnabled <true|false>
  relai-mcp-config set sessionLocksEnabled <true|false>
  relai-mcp-config set maxIndexFiles <number>
  relai-mcp-config set maxIndexFileBytes <number>
  relai-mcp-config set multiAgent.enabled <true|false>
  relai-mcp-config set multiAgent.maxSubtasks <number>
  relai-mcp-config set multiAgent.maxParallelSubtasks <number>
  relai-mcp-config set multiAgent.requireReviewBeforeMerge <true|false>
  relai-mcp-config set scheduler.enabled <true|false>
  relai-mcp-config set scheduler.maxRetries <number>
  relai-mcp-config set memory.enabled <true|false>
  relai-mcp-config set memory.maxNotesPerWorkspace <number>
  relai-mcp-config set semanticIndex.enabled <true|false>
  relai-mcp-config set semanticIndex.maxFiles <number>
  relai-mcp-config set semanticIndex.maxFileBytes <number>
  relai-mcp-config approval-gate set <action> <true|false>

Config path: ${getConfigPath()}`);
}

function requireArg(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function parseBool(value, label) {
  const text = String(value || "").toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  throw new Error(`${label} must be true or false.`);
}

function main() {
  const [, , command, subcommand, action, ...rest] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "init") {
    const config = makeDefaultConfig();
    writeConfig(config, { overwrite: false });
    console.log(`Created config at ${getConfigPath()}`);
    return;
  }

  if (command === "show") {
    console.log(JSON.stringify(readConfig(), null, 2));
    return;
  }

  if (command === "doctor") {
    const config = readConfig({ allowMissing: true });
    const fix = subcommand === "--fix";
    const workspacePath = fix ? action : subcommand;
    Promise.resolve(fix ? productUx.doctorFix(config, { workspacePath, overwrite: false }) : productUx.healthMonitor(config, {}))
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
    return;
  }

  if (command === "setup") {
    const result = productUx.setupWizard({ alias: subcommand || "myapp", workspacePath: action || "" });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "import-relai") {
    const result = productUx.importOriginalRelAiConfig({ sourcePath: subcommand || undefined, dryRun: false });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "state" && subcommand === "export") {
    const config = readConfig();
    const result = productUx.stateExport(config, { outputPath: requireArg(action, "output path") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "state" && subcommand === "import") {
    const config = readConfig();
    const result = productUx.stateImport(config, { inputPath: requireArg(action, "input path"), confirm: rest.includes("--confirm") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "set") {
    const key = requireArg(subcommand, "setting key");
    const value = requireArg(action, "setting value");
    const config = readConfig({ allowMissing: true });
    if (["allowGitHubCli", "allowDocker", "allowArbitraryCommands", "allowDestructiveTools", "dashboardEnabled", "sessionLocksEnabled"].includes(key)) {
      config[key] = parseBool(value, key);
    } else if (["multiAgent.enabled", "multiAgent.requireReviewBeforeMerge", "scheduler.enabled", "memory.enabled", "semanticIndex.enabled"].includes(key)) {
      const [section, field] = key.split(".");
      config[section] = config[section] || {};
      config[section][field] = parseBool(value, key);
    } else if (key === "permissionProfile") {
      if (!["read-only", "patch", "test", "pr", "admin"].includes(value)) throw new Error("permissionProfile must be one of: read-only, patch, test, pr, admin.");
      config[key] = value;
    } else if (key === "worktreeRoot") {
      if (!path.isAbsolute(value)) throw new Error("worktreeRoot must be an absolute path.");
      config[key] = value;
    } else if (["maxIndexFiles", "maxIndexFileBytes", "maxPlanSteps", "maxConcurrentSessionsPerWorkspace"].includes(key)) {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) throw new Error(`${key} must be a positive number.`);
      config[key] = number;
    } else if (["multiAgent.maxSubtasks", "multiAgent.maxParallelSubtasks", "scheduler.maxRetries", "memory.maxNotesPerWorkspace", "memory.maxNoteChars", "semanticIndex.maxFiles", "semanticIndex.maxFileBytes"].includes(key)) {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) throw new Error(`${key} must be a positive number.`);
      const [section, field] = key.split(".");
      config[section] = config[section] || {};
      config[section][field] = number;
    } else {
      throw new Error(`Unsupported setting '${key}'.`);
    }
    writeConfig(config);
    const printed = key.includes(".") ? config[key.split(".")[0]][key.split(".")[1]] : config[key];
    console.log(`Set ${key}=${printed}`);
    return;
  }

  if (command === "approval-gate" && subcommand === "set") {
    const gate = requireArg(action, "approval gate action");
    const value = requireArg(rest[0], "approval gate value");
    const config = readConfig({ allowMissing: true });
    config.approvalGates = config.approvalGates || {};
    config.approvalGates[gate] = parseBool(value, gate);
    writeConfig(config);
    console.log(`Set approval gate ${gate}=${config.approvalGates[gate]}`);
    return;
  }

  if (command === "workspace" && subcommand === "add") {
    const alias = requireArg(action, "workspace alias");
    const workspacePath = requireArg(rest[0], "absolute workspace path");
    if (!path.isAbsolute(workspacePath)) throw new Error("Workspace path must be absolute.");
    const config = readConfig({ allowMissing: true });
    config.workspaces = config.workspaces || {};
    config.workspaces[alias] = config.workspaces[alias] || {};
    config.workspaces[alias].path = workspacePath;
    config.workspaces[alias].testCommands = config.workspaces[alias].testCommands || {};
    config.workspaces[alias].commands = config.workspaces[alias].commands || {};
    config.workspaces[alias].protectedBranches = config.workspaces[alias].protectedBranches || ["main", "master"];
    config.workspaces[alias].defaultBaseBranch = config.workspaces[alias].defaultBaseBranch || "main";
    config.workspaces[alias].allowedRemotes = config.workspaces[alias].allowedRemotes || ["origin"];
    writeConfig(config);
    console.log(`Added workspace '${alias}' -> ${workspacePath}`);
    return;
  }

  if (command === "test-command" && subcommand === "add") {
    addWorkspaceCommand("testCommands", "test command", action, rest);
    return;
  }

  if (command === "command" && subcommand === "add") {
    addWorkspaceCommand("commands", "dev command", action, rest);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

function addWorkspaceCommand(field, label, aliasValue, rest) {
  const alias = requireArg(aliasValue, "workspace alias");
  const key = requireArg(rest[0], `${label} key`);
  const shellCommand = rest.slice(1).join(" ").trim();
  if (!shellCommand) throw new Error(`Missing ${label}.`);
  const config = readConfig();
  if (!config.workspaces || !config.workspaces[alias]) throw new Error(`Workspace '${alias}' is not configured.`);
  config.workspaces[alias][field] = config.workspaces[alias][field] || {};
  config.workspaces[alias][field][key] = shellCommand;
  writeConfig(config);
  console.log(`Added ${label} '${key}' for workspace '${alias}'.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
