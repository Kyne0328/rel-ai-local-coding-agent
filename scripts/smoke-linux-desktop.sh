#!/usr/bin/env bash
set -euo pipefail

package_directory="${1:?Pass the unpacked Linux application directory as argument 1.}"
state_directory="${2:?Pass the smoke-test state directory as argument 2.}"
app="$package_directory/rel-ai-mcp"
sandbox_helper="$package_directory/chrome-sandbox"

mkdir -p "$state_directory"
test -x "$app"
sudo chown root:root "$sandbox_helper"
sudo chmod 4755 "$sandbox_helper"
test "$(stat -c '%u:%g:%a' "$sandbox_helper")" = '0:0:4755'

timeout --signal=TERM --kill-after=5s 30s \
  xvfb-run --auto-servernum dbus-run-session -- bash -c '
    set -euo pipefail
    app="$1"
    state_directory="$2"
    REL_AI_MCP_STATE_DIR="$state_directory" "$app" --background &
    app_pid=$!
    cleanup() {
      if kill -0 "$app_pid" 2>/dev/null; then
        kill -TERM "$app_pid" 2>/dev/null || true
        wait "$app_pid" 2>/dev/null || true
      fi
    }
    trap cleanup EXIT
    sleep 5
    if ! kill -0 "$app_pid" 2>/dev/null; then
      wait "$app_pid"
      exit $?
    fi
    kill -TERM "$app_pid"
    wait "$app_pid"
    trap - EXIT
  ' _ "$app" "$state_directory"
