# Native MCP Tasks architecture and release gate

Rel.AI uses three separate lifecycle models. They may reference each other, but they are not interchangeable.

```text
Authenticated MCP request
        |
        v
Per-request protocol, client, and capability metadata
        |
        v
Principal-bound repository work session
        |
        v
Execution-mode policy
   +----------------------+-------------------------+
   |                                                |
   v                                                v
Native MCP Task                               Bounded direct execution
(one asynchronous MCP request)               (one bounded request)
   |                                                |
   +---------------- same domain operation ---------+
                            |
                            v
                 Optional managed OS process
```

A **repository work session** is the opaque `work_id` created by `relai_work` with `action:"begin"`; it groups one repository objective across multiple tool calls and is bound to the authenticated principal and configured workspace. A **native MCP Task** is a protocol object for one asynchronous MCP operation. A **managed process** is one operating-system process with its own `processId`, logs, ownership, and stop lifecycle.

## Capability and transport matrix

Execution mode is selected from the current request's `io.modelcontextprotocol/tasks` capability and the operation's explicit bounds. Client name, transport type, and branding are not substitutes for capability negotiation.

| Transport | Client capability | Operation estimate | Expected result |
| --- | --- | --- | --- |
| HTTP or stdio | Advertised | Clearly bounded and short | Direct result |
| HTTP or stdio | Advertised | Long, multi-step, or indeterminate | Native MCP task |
| HTTP or stdio | Not advertised | Within synchronous limits | Bounded synchronous result |
| HTTP or stdio | Not advertised | Exceeds duration or output limit | Bounded execution error |

Rel.AI advertises server support on both HTTP and stdio. It returns a native task handle only when the current request advertises the capability and the operation is not safely bounded for direct execution. Malformed capability objects are rejected as invalid parameters and are never treated as capability absence.

Persistent interactive commands use `relai_process_*` and return a `processId`; they do not become native task identity.

## Protocol boundary

Rel.AI's modern HTTP and stdio protocol is MCP `2026-07-28`. HTTP also accepts ChatGPT's SDK-supported stateless `2025-11-25` initialize flow; stdio remains modern-only. Native Tasks are available only on requests that negotiate the modern Tasks extension. Custom Tasks extension routing preserves the same boundary behavior as SDK-dispatched modern requests:

- no response is emitted for JSON-RPC notifications;
- every MCP 2026 result includes server identity metadata;
- request IDs preserve their original type;
- task methods require explicit Tasks capability negotiation;
- unknown and unauthorized task IDs are indistinguishable;
- tool argument and output schemas are validated once through the shared invocation pipeline.

## Lifecycle and process behavior

The native task lifecycle supports `working`, `input_required`, `completed`, `failed`, and `cancelled`, with durable final results, legal transition enforcement, expiry, restart handling, principal isolation, and bounded redacted records.

`tasks/update` is retry-safe. Unknown input keys and keys already satisfied are ignored. Newly supplied outstanding keys are validated and consumed, and an executor resumes at most once after all required input is satisfied.

A finite command completes its native task when execution exits. A persistent process has an independent lifecycle; cancelling an already completed startup request does not stop the process. Use `relai_process` with action `stop` for the running process.

Stdio uses a connection-scoped local principal. A server restart terminalizes active non-resumable stdio tasks as interrupted; a new stdio connection cannot adopt them. HTTP uses the complete stable authorization identity available from OAuth or the configured bearer mode.

## Operator diagnostics

- **Native MCP Tasks: Supported** means the observed request advertised the capability.
- **Native MCP Tasks: Not advertised by client** means bounded synchronous fallback is expected.
- **Native MCP Tasks: Unknown** means no usable capability evidence has been observed.
- **Execution mode: Native asynchronous** and **Execution mode: Bounded direct** show the selected mode.
- A native `taskId`, repository `work_id`, and process `processId` identify different entities.
- Error `-32021` means a Tasks method was called without the required client capability.
- Error `-32602` with `invalid_client_capabilities` means capability metadata is malformed.
- Error `-32024` with `synchronous_timeout` or `synchronous_output_limit` means direct execution exceeded its limits.
- Error `-32800` with `execution_aborted` means the request or connection was cancelled.

## Source release gate

Run:

```bash
npm run test:native-tasks-release-gate
```

The source gate covers:

- capability negotiation and adaptive execution selection;
- strict modern envelope validation and stateless ChatGPT HTTP initialization;
- Tasks notification no-response semantics;
- server identity metadata on extension responses;
- native task lifecycle, persistence, input idempotency, cancellation, and redaction;
- full-principal native-task isolation;
- principal-bound repository work-session isolation;
- HTTP and stdio parity;
- persistent-process independence;
- the canonical 12-tool public surface and its catalog-derived action contracts;
- dashboard terminal-state behavior.

Critical regressions include:

- task returned without capability negotiation;
- malformed capability metadata treated as capability absence;
- response emitted for a task notification;
- extension response missing server identity metadata;
- unauthorized task or work-session access;
- invalid terminal transition;
- replayed input resuming an executor twice;
- cancellation without process-tree cleanup;
- unbounded direct execution;
- HTTP and stdio domain divergence;
- rejected or sessionful ChatGPT HTTP initialization;
- removed task-management or validation tools reappearing.

## Complete release gate

A release is not ready from the source gate alone. The complete gate also requires:

1. aggregate source tests;
2. release consistency checks;
3. an unpacked Electron build;
4. packaged layout and Electron fuse verification;
5. packaged OAuth and MCP `2026-07-28` connector acceptance;
6. dashboard browser acceptance;
7. a manual logged-in ChatGPT connector check against the current host.
