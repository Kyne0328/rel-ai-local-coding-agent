# Native MCP Tasks probe

Rel.AI includes an opt-in diagnostic canary for testing whether a connected MCP host implements the `io.modelcontextprotocol/tasks` extension. The probe does not replace Rel.AI's durable `operationTaskId` workflow.

## Enable

Set the environment variable below before starting or restarting the Rel.AI HTTP server or desktop application:

```powershell
$env:REL_AI_NATIVE_TASKS_PROBE = '1'
npm run start:http
```

When enabled, `server/discover` advertises the Tasks extension and `tools/list` includes `relai_native_tasks_probe`. The tool is omitted when the flag is disabled.

## Test from ChatGPT

Reconnect the custom MCP app after enabling the flag, then ask ChatGPT to run `relai_native_tasks_probe`.

The result distinguishes two cases:

- If ChatGPT does not include the extension in the tool call's per-request client capabilities, the tool returns a synchronous report with `clientAdvertisedTasks: false`.
- If ChatGPT advertises the extension, the HTTP adapter returns `resultType: "task"`. A working host should then call `tasks/get` using the returned task ID and eventually surface the final tool result.

The canary implements `tasks/get`, `tasks/update`, and `tasks/cancel`, validates the required `Mcp-Name` task routing header, binds task access to the authenticated client, and stores probe state under the Rel.AI state directory.

## Disable

Remove the environment variable and restart Rel.AI:

```powershell
Remove-Item Env:REL_AI_NATIVE_TASKS_PROBE -ErrorAction SilentlyContinue
```

The server then stops advertising the extension and removes the probe tool from discovery. Rel.AI's existing deferred-operation tools remain unchanged in both modes.
