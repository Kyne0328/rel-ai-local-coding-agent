#!/usr/bin/env node
const path = require("node:path");
const { readConfig, writeConfig, getConfigPath, makeDefaultConfig } = require("../src/config");

function printUsage() {
  console.log(`Usage:
  relai-mcp-config init
  relai-mcp-config show
  relai-mcp-config workspace add <alias> <absolute-path>
  relai-mcp-config test-command add <alias> <key> <command...>

Config path: ${getConfigPath()}`);
}

function requireArg(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
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

  if (command === "workspace" && subcommand === "add") {
    const alias = requireArg(action, "workspace alias");
    const workspacePath = requireArg(rest[0], "absolute workspace path");
    if (!path.isAbsolute(workspacePath)) {
      throw new Error("Workspace path must be absolute.");
    }
    const config = readConfig({ allowMissing: true });
    config.workspaces = config.workspaces || {};
    config.workspaces[alias] = config.workspaces[alias] || {};
    config.workspaces[alias].path = workspacePath;
    config.workspaces[alias].testCommands = config.workspaces[alias].testCommands || {};
    config.workspaces[alias].protectedBranches = config.workspaces[alias].protectedBranches || ["main", "master"];
    writeConfig(config);
    console.log(`Added workspace '${alias}' -> ${workspacePath}`);
    return;
  }

  if (command === "test-command" && subcommand === "add") {
    const alias = requireArg(action, "workspace alias");
    const key = requireArg(rest[0], "test command key");
    const shellCommand = rest.slice(1).join(" ").trim();
    if (!shellCommand) throw new Error("Missing test command.");
    const config = readConfig();
    if (!config.workspaces || !config.workspaces[alias]) {
      throw new Error(`Workspace '${alias}' is not configured.`);
    }
    config.workspaces[alias].testCommands = config.workspaces[alias].testCommands || {};
    config.workspaces[alias].testCommands[key] = shellCommand;
    writeConfig(config);
    console.log(`Added test command '${key}' for workspace '${alias}'.`);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
