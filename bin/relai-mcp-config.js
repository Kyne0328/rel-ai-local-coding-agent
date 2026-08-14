#!/usr/bin/env node
import * as path from "node:path";
import { readConfig, writeConfig, getConfigPath, makeDefaultConfig } from "../src/config.js";
import * as productUx from "../src/productUx.js";

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
  relai-mcp-config set dashboardEnabled <true|false>
  relai-mcp-config set maxOutputBytes <number>

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

  const handlers = {
    init: handleInit,
    show: handleShow,
    doctor: handleDoctor,
    setup: handleSetup,
    "import-relai": handleImportRelai,
    state: handleState,
    set: handleSet,
    workspace: handleWorkspace,
    "test-command": handleTestCommand,
    command: handleCommand
  };
  const handler = handlers[command];
  if (handler) {
    handler(subcommand, action, rest);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

function handleInit() {
  const config = makeDefaultConfig();
  writeConfig(config, { overwrite: false });
  console.log(`Created config at ${getConfigPath()}`);
}

function handleShow() {
  console.log(JSON.stringify(readConfig(), null, 2));
}

function handleDoctor(subcommand, action) {
  const config = readConfig({ allowMissing: true });
  const fix = subcommand === "--fix";
  const workspacePath = fix ? action : subcommand;
  Promise.resolve(fix ? productUx.doctorFix(config, { workspacePath, overwrite: false }) : productUx.healthMonitor(config, {}))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}

function handleSetup(subcommand, action) {
  const result = productUx.setupWizard({ alias: subcommand || "myapp", workspacePath: action || "" });
  console.log(JSON.stringify(result, null, 2));
}

function handleImportRelai(subcommand) {
  const result = productUx.importOriginalRelAiConfig({ sourcePath: subcommand || undefined, dryRun: false });
  console.log(JSON.stringify(result, null, 2));
}

function handleState(subcommand, action, rest) {
  if (subcommand === "export") {
    const config = readConfig();
    const result = productUx.stateExport(config, { outputPath: requireArg(action, "output path") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (subcommand === "import") {
    const config = readConfig();
    const result = productUx.stateImport(config, { inputPath: requireArg(action, "input path"), confirm: rest.includes("--confirm") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printUsage();
  process.exitCode = 1;
}

function handleSet(subcommand, action) {
  const key = requireArg(subcommand, "setting key");
  const value = requireArg(action, "setting value");
  const config = readConfig({ allowMissing: true });
  if (["dashboardEnabled"].includes(key)) {
    config[key] = parseBool(value, key);
  } else if (["maxOutputBytes"].includes(key)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${key} must be a positive number.`);
    config[key] = number;
  } else {
    throw new Error(`Unsupported setting '${key}'. Supported settings: dashboardEnabled, maxOutputBytes.`);
  }
  writeConfig(config);
  console.log(`Set ${key}=${config[key]}`);
}

function handleWorkspace(subcommand, action, rest) {
  if (subcommand !== "add") {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const alias = requireArg(action, "workspace alias");
  const workspacePath = requireArg(rest[0], "absolute workspace path");
  if (!path.isAbsolute(workspacePath)) throw new Error("Workspace path must be absolute.");
  const config = readConfig({ allowMissing: true });
  config.workspaces = config.workspaces || {};
  config.workspaces[alias] = config.workspaces[alias] || {};
  config.workspaces[alias].path = workspacePath;
  config.workspaces[alias].testCommands = config.workspaces[alias].testCommands || {};
  config.workspaces[alias].commands = config.workspaces[alias].commands || {};
  writeConfig(config);
  console.log(`Added workspace '${alias}' -> ${workspacePath}`);
}

function handleTestCommand(subcommand, action, rest) {
  addWorkspaceCommand("testCommands", "test command", action, rest);
}

function handleCommand(subcommand, action, rest) {
  addWorkspaceCommand("commands", "dev command", action, rest);
}

function addWorkspaceCommand(field, label, aliasValue, rest) {
  const alias = requireArg(aliasValue, "workspace alias");
  const key = requireArg(rest[0], `${label} key`);
  const shellCommand = rest.slice(1).join(" ").trim();
  if (!shellCommand) throw new Error(`Missing ${label}.`);
  const config = readConfig();
  if (!config.workspaces?.[alias]) throw new Error(`Workspace '${alias}' is not configured.`);
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
