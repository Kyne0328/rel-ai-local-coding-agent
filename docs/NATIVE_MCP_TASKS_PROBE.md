# Native MCP Tasks diagnostics

Rel.AI supports `io.modelcontextprotocol/tasks` for selected operations on both HTTP and stdio. Native Tasks are reached through normal eligible tool calls; there is no public probe tool.

The server advertises Tasks support, but execution mode is selected from the current request's client capability. A request that advertises Tasks may receive a native asynchronous task. A request that does not advertise Tasks uses bounded synchronous execution when the operation is safe within the configured limits. Rel.AI cannot make ChatGPT or another client advertise the capability.

Persistent interactive commands use `relai_process_*` and return a `processId`; they are independent from the native task that may have started them.

Protocol and service tests retain internal diagnostic operations for task creation, polling, input updates, cancellation, authorization, persistence, restart behavior, and transport parity. They are not registered in the public tool catalog and must not appear in `tools/list`, help text, or agent workflows.

See [NATIVE_TASKS_RELEASE_GATE.md](NATIVE_TASKS_RELEASE_GATE.md) for the architecture, capability matrix, operator diagnostics, and release-blocking test gate.
