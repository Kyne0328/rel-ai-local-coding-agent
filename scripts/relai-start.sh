#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
node bin/rel-ai-mcp-launch.js "$@"
