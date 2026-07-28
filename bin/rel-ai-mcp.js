#!/usr/bin/env node
import { main } from "../src/server.js";

try {
  const maybePromise = main();
  if (maybePromise && typeof maybePromise.catch === "function") {
    maybePromise.catch((error) => {
      console.error(`[rel-ai-mcp] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      process.exit(1);
    });
  }
} catch (error) {
  console.error(`[rel-ai-mcp] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
}
