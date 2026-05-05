#!/usr/bin/env sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"
node --check bin/rel-ai-mcp.js
node --check bin/rel-ai-mcp-http.js
node --check bin/relai-mcp-config.js
printf '%s\n' "Rel.AI MCP checked successfully."
printf '%s\n' "Next: npm run init-config && npm run workspace:add -- myapp /absolute/path/to/project"
