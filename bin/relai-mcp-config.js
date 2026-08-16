#!/usr/bin/env node
import * as path from "node:path";
import { readConfig, writeConfig, getConfigPath, makeDefaultConfig } from "../src/config.js";
import * as productUx from "../src/productUx.js";

function printUsage() {
  console.log(`Usage:
  relai-mcp-config init
  relai-mcp-config show
  relai-mcp-config workspace add <alias> <absolute-path>
  relai-mcp-config doctor [--fix] [workspace-path]
  relai-mcp-config setup [alias] [workspace-path]
  relai-mcp-config state export <output-path>
  relai-mcp-config state import <input-path> --confirm

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

  const handlers = {
    init: handleInit,
    show: handleShow,
    doctor: handleDoctor,
    setup: handleSetup,
    state: handleState,
    workspace: handleWorkspace
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
  config.workspaces[alias] = { ...(config.workspaces[alias] || {}), path: workspacePath };
  writeConfig(config);
  console.log(`Added workspace '${alias}' -> ${workspacePath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
