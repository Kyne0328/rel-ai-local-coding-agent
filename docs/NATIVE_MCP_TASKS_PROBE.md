# Native MCP Tasks probe

Rel.AI exposes a diagnostic canary for testing whether an HTTP MCP host implements the `io.modelcontextprotocol/tasks` extension.

## Availability

No environment variable or alternate startup mode is required. During stateless HTTP discovery Rel.AI:

- advertises `capabilities.extensions["io.modelcontextprotocol/tasks"]`;
- includes `relai_native_tasks_probe` in `tools/list`;
- recognizes `tasks/get`, `tasks/update`, and `tasks/cancel`;
- validates the `Mcp-Name` routing header and authenticated task ownership.

Client support is supplied in every request's protocol metadata. Stdio does not advertise the extension because the pinned core stdio router does not dispatch extension methods.

## Test from ChatGPT

Reconnect the custom MCP app after installing or restarting the updated Rel.AI runtime, then ask ChatGPT to run `relai_native_tasks_probe`.

- Without the client capability, the call returns the standard missing-capability error.
- With the capability, the HTTP adapter returns `resultType: "task"`. The host calls `tasks/get` using the returned task ID until it receives the final `CallToolResult`.

The probe implements task get, update, and cancellation; binds task access to the authenticated client; persists state under the Rel.AI state directory; enforces expiry; and preserves final result and cancellation behavior across restart.
