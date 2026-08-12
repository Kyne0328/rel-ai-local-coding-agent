<p align="center">
  <img src="electron/build/icon.png" alt="Rel.AI MCP" width="112" />
</p>

<h1 align="center">Rel.AI MCP</h1>

<p align="center">
  <strong>Repository work you can see, bound, validate, and recover.</strong><br />
  Rel.AI gives ChatGPT a real local development runtime without turning your computer into an open-ended agent box.
</p>

<p align="center">
  Created and maintained by <a href="https://github.com/Kyne0328"><strong>Kyne</strong></a>.
</p>

<p align="center">
  <a href="https://github.com/Kyne0328/rel-ai-mcp/releases"><strong>Download Rel.AI</strong></a>
  · <a href="docs/ONE_CLICK_SETUP.md">Set up</a>
  · <a href="docs/CONNECTING_TO_CHATGPT.md">Connect ChatGPT</a>
  · <a href="docs/SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="https://github.com/Kyne0328/rel-ai-mcp/actions/workflows/ci.yml"><img src="https://github.com/Kyne0328/rel-ai-mcp/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Kyne0328/rel-ai-mcp/releases"><img src="https://img.shields.io/github/v/release/Kyne0328/rel-ai-mcp?display_name=tag&style=flat-square" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Kyne0328/rel-ai-mcp?style=flat-square" alt="Apache License 2.0" /></a>
  <img src="https://img.shields.io/badge/desktop-Windows%20%7C%20Linux-informational?style=flat-square" alt="Windows and Linux" />
  <img src="https://img.shields.io/badge/MCP-2026--07--28-7c3aed?style=flat-square" alt="MCP 2026-07-28" />
</p>

---

Rel.AI MCP connects ChatGPT to **repositories you explicitly configure as local workspaces**. ChatGPT can inspect the current checkout, change files, run the project, validate the result, review the diff, and publish Git work when asked. Rel.AI owns the boundary around that work: which repository is available, which task owns a mutation, what evidence is current, what can be published, and what happens after an interruption.

It is not a hosted coding VM and it is not a generic remote shell.

**The repository stays on your computer. The work stays attributable. The result stays reviewable.**

## The Rel.AI contract

Rel.AI is built around four product rules rather than a collection of unrelated coding tools.

| | Rel.AI rule | What it means in practice |
| --- | --- | --- |
| **01** | **Workspace is authority** | ChatGPT works only inside repository roots you configured. Paths, commands, Git state, checks, and processes resolve from that workspace instead of from arbitrary machine access. |
| **02** | **Work session owns the task** | Each independent objective receives its own `work_id`. Mutations, validation, review, cancellation, recovery, and completion stay attached to that objective rather than to a chat tab or transport connection. |
| **03** | **Evidence beats progress** | A successful command or a 100% UI indicator is not proof that the change is valid. Rel.AI tracks current validation evidence against the files the task actually changed. |
| **04** | **Publishing is separate** | Editing code does not silently become committing or pushing code. Review, commit, push, and PR-draft work remain explicit Git actions with repository policy around them. |

Those four rules are the reason Rel.AI behaves differently from a simple filesystem connector or open-ended command bridge.

## One task, end to end

```text
You describe the objective in ChatGPT
                │
                ▼
      Rel.AI begins one work session
                │
                ▼
      understand the repository
   snapshot → search → code intelligence
                │
                ▼
          change the workspace
          edit → run → diagnose
                │
                ▼
            prove the result
       targeted checks → evidence
                │
                ▼
             review the work
        task diff → activity → status
                │
                ▼
        publish only when requested
          commit → push → PR draft
```

The repository remains the source of truth throughout the task. If the workspace was already dirty, Rel.AI can distinguish pre-existing changes from task-owned mutations instead of pretending the task started from a clean checkout.

## Start using Rel.AI

Rel.AI uses one connection model: **OpenAI Secure MCP Tunnel**. Repository files and tool execution stay on the computer running Rel.AI; the tunnel provides the private transport ChatGPT uses to reach its local MCP service.

1. **Install Rel.AI MCP** from the [Releases page](https://github.com/Kyne0328/rel-ai-mcp/releases). Current desktop packaging targets Windows and Linux.
2. **Create an OpenAI Secure MCP Tunnel** for this computer and create a runtime API key for that tunnel in OpenAI Platform.
3. **Configure Rel.AI.** Enter the tunnel ID and runtime API key in the first-run wizard. Rel.AI encrypts the runtime key with Electron `safeStorage` and supervises the bundled OpenAI tunnel client.
4. **Add a workspace.** Pick a repository folder and give it a short alias such as `myapp`.
5. **Connect ChatGPT.** Plus or Pro users should open **Plugins**; Business, Enterprise, or Edu users should use the Rel.AI app under **workspace Apps**. Create the Rel.AI MCP integration with ChatGPT's **Tunnel** connection option, or reconnect the existing integration without deleting or recreating it, and associate it with this computer's tunnel.
6. **Use the workspace alias.** Rel.AI resolves repository access locally from the configured alias; ChatGPT does not need the absolute path on your computer.

A useful first request is intentionally read-only:

```text
Use Rel.AI MCP on workspace "myapp". Start one work session, inspect the repository, and explain the relevant architecture before changing anything.
```

Then move into a real implementation loop:

```text
Use Rel.AI MCP on workspace "myapp". Implement this change, run the smallest validation that proves it, review the task diff, and do not push unless I ask.
```

See [One-click setup](docs/ONE_CLICK_SETUP.md) for the installed-app walkthrough and [Connecting to ChatGPT](docs/CONNECTING_TO_CHATGPT.md) for tunnel setup, reconnects, and recovery.

## What Rel.AI gives ChatGPT

### Repository intelligence before file dumping

Rel.AI is designed to let ChatGPT discover a codebase progressively instead of reading large parts of the repository by default.

- **Repository snapshots** surface structure, manifests, detected checks, and project hints.
- **Bounded reads** target files and line ranges instead of returning unlimited content.
- **Text search** covers tracked and untracked workspace files.
- **Code intelligence** follows symbols, references, calls, related files, imports, affected tests, and available diagnostics.
- **Hybrid semantic search** combines lexical, path, symbol, and private local vector signals without sending source text to a hosted embedding service.

The result is a local discovery layer that helps ChatGPT narrow the problem before it starts spending context on file contents.

### One edit surface for real repository changes

Rel.AI deliberately consolidates repository writes instead of exposing many overlapping mutation tools.

It supports exact replacements, multiple replacements in one file, full-file writes, patch-shaped updates, large staged changes, workspace containment, symlink protection, and optional SHA-256 stale-write checks. Large migrations can stay one logical task instead of being fragmented purely because one request is too large.

Managed Git worktrees are available when isolated parallel work is appropriate, while ordinary tasks continue to use the repository you configured.

### Commands with ownership, not just stdout

Rel.AI can execute one-shot project commands and own long-running local processes.

One-shot execution returns bounded output, exit state, timing, and detected file changes. Managed processes have stable IDs, bounded persistent logs, interactive input when appropriate, workspace attribution, and controlled shutdown. This keeps development servers and watchers separate from one-off checks and builds.

### Validation tied to the mutation that happened

Rel.AI treats tests as evidence, not ceremony.

Validation can be selected from the task-owned change scope, and fresh evidence can be reused when it still proves the current mutation generation. If a command changes files and then fails, the mutation is still recorded. If a command succeeds but does not satisfy final validation, Rel.AI does not call that task proven merely because the exit code was zero.

### Git actions that remain deliberate

Rel.AI can review task changes, commit scoped work, push to configured remotes, and prepare pull-request draft text. Publishing remains a separate decision from editing. Protected branches, sensitive staged paths, existing workspace state, and allowed remotes remain part of the repository policy rather than being left to a generic shell command.

## Local execution is the point

OpenAI Secure MCP Tunnel gives ChatGPT a private route to the Rel.AI process without moving the development environment away from the computer that owns the repository.

```text
ChatGPT
   │
   ▼
OpenAI Secure MCP Tunnel
   │
   ▼
bundled tunnel-client
   │  Authorization: Bearer <local secret>
   ▼
127.0.0.1:<port>/mcp
   │
   ▼
Rel.AI MCP → configured workspace → files / Git / commands / checks
```

The tunnel runtime API key is used by the bundled tunnel client to operate the configured OpenAI tunnel. The separate Rel.AI bearer token authenticates only the loopback tunnel-client-to-MCP hop and is not displayed as the ChatGPT credential. Repository paths, commands, Git operations, tests, builds, managed processes, and workspace configuration remain local.

A reconnect restores transport. It does not rewrite repository history or pretend an interrupted mutation finished successfully.

## When something goes wrong

Rel.AI separates **connection recovery** from **work recovery**.

A Secure MCP Tunnel reconnect is allowed to restore connectivity. It is not allowed to restart unrelated managed developer processes just to make the connection look healthy, and it is not allowed to convert uncertain repository work into a successful task result.

If the outcome of a mutation is uncertain, Rel.AI can preserve read access while blocking new mutations or completion until the work state is reconciled. Recovery avoids automatically replaying destructive Git operations such as resets, cleans, restores, or pushes.

This distinction is central to the product: **being connected is not the same thing as being correct.**

See [Workflow reliability](docs/WORKFLOW_RELIABILITY.md) and [Task observability](docs/TASK_OBSERVABILITY.md) for the full state model.

## The desktop is the control surface

Rel.AI's desktop app is where the local side of the system becomes visible to the user.

It exposes the things that matter during real repository work:

- **Workspaces** — which repositories ChatGPT is allowed to use, plus repository and validation details.
- **Sessions** — active and historical objectives with task status and completion state.
- **Activity** — individual Rel.AI tool events and recorded results.
- **Processes** — long-running development processes and bounded output.
- **Skills** — built-in, installed, and workspace-enabled workflow instructions.
- **Connection** — Secure MCP Tunnel state, local MCP health, recovery, and ChatGPT connection guidance.
- **Usage** — locally observed request, tool, outcome, duration, and workspace aggregates.
- **Diagnostics and settings** — application health, updates, notification preferences, recovery guidance, and additional controls.

Rel.AI records observable tool activity and results. It does not claim access to ChatGPT's private reasoning.

## Security is repository-shaped

Rel.AI MCP is a **trusted local coding bridge, not a sandbox**. It assumes you deliberately gave ChatGPT authority over configured repositories and then constrains that authority at repository, task, process, Git, and desktop boundaries.

Important controls include:

- **Workspace containment** — traversal, absolute-path injection, and symlink escape are blocked.
- **Sensitive-path handling** — credential-bearing and secret-like content receives stricter operation-aware policy rather than direct raw reads and writes.
- **Bounded data movement** — reads, snapshots, diffs, process output, and request bodies have limits.
- **Stale-write checks** — exact replacements can fail closed when the target changed underneath the task.
- **Task ownership** — a repository objective is bound to a `work_id`, not inferred from a WebSocket, OAuth grant, ChatGPT thread, or managed process ID.
- **Git boundaries** — pushes are limited to configured remotes and sensitive staged paths require narrower authorization.
- **Tunnel credential storage** — Electron protects the OpenAI tunnel runtime API key with `safeStorage`; the local MCP bearer token remains private to this computer.
- **Renderer isolation** — privileged desktop actions cross constrained, sender-owned Electron IPC channels.
- **Updater integrity** — release verification, checksums, package policy, and Electron fuses are part of the desktop security boundary.

Only configure repositories you trust ChatGPT and Rel.AI to inspect, execute, and modify. Repository-defined tests, builds, linters, analyzers, and scripts are code execution and inherit the trust level of the repository itself.

Read [Security](docs/SECURITY.md) for the detailed authentication, workspace, Electron, updater, and remaining trust boundaries.

## One secure connection model

Rel.AI intentionally has one supported ChatGPT transport: **OpenAI Secure MCP Tunnel**. There is no provider switch or fallback transport to keep synchronized.

The desktop owns the local MCP process, tunnel-client child process, tunnel health state, encrypted runtime key, and local bearer credential. ChatGPT owns the remote tunnel association. This keeps transport recovery separate from repository task ownership and makes connection behavior deterministic across restarts.

## Small public tool surface, broad workflow

The current release exposes **12 public MCP tools** through one canonical action catalog and targets MCP protocol `2026-07-28`.

The surface is intentionally consolidated. Rel.AI does not need a public tool for every internal operation when one coherent capability can own the contract. That keeps schemas, authorization, task behavior, output validation, and dashboard metadata aligned around a smaller interface while still supporting repository inspection, search, edits, execution, processes, validation, review, Git operations, recovery, and work-session lifecycle.

See [MCP protocol policy](docs/MCP_PROTOCOL_POLICY.md) and [Architecture](docs/ARCHITECTURE.md) for the current protocol and ownership model.

## Skills extend behavior without bloating the connector

Rel.AI supports built-in and installed skills for reusable debugging, planning, verification, investigation, and development workflows. Skills can be enabled per workspace so project-specific instructions remain scoped to the repositories that need them.

This keeps specialized workflow knowledge out of the public MCP tool count while still giving ChatGPT reusable operating guidance. Packaged desktop builds include the runtime skill assets required by the app.

## Usage and privacy

The Usage view measures **locally observed Rel.AI activity**, not ChatGPT model tokens or ChatGPT billing. It can report request counts, tool calls, outcomes, execution duration, active days, tools, and workspace aggregates from local Rel.AI records.

Repository contents and command execution remain on the selected desktop. Keep tunnel runtime API keys, local bearer credentials, repository credentials, and other secrets out of public issues and unreviewed diagnostic exports.

## Build Rel.AI from source

Rel.AI MCP currently uses **Node.js 24** and **npm 11**. The root runtime and Electron desktop maintain separate lockfiles.

```bash
npm ci --ignore-scripts
npm ci --prefix electron
npm run electron:dev
```

Development should use the smallest checks that prove the current change, then broaden validation when the risk warrants it:

```bash
npm run check
npm run lint
npm run typecheck
npm test
```

The Electron desktop is the normal application composition root. Direct HTTP entry points exist for development, protocol testing, and packaged-runtime verification rather than as the installed-user setup path.

See [Development](docs/DEVELOPMENT.md) for source architecture, generated assets, validation, packaging, and release workflows.

## Read deeper

| If you want to... | Read |
| --- | --- |
| install and configure the desktop app | [One-click setup](docs/ONE_CLICK_SETUP.md) |
| understand the Secure MCP Tunnel, reconnects, or ChatGPT setup | [Connecting to ChatGPT](docs/CONNECTING_TO_CHATGPT.md) |
| understand who owns what at runtime | [Architecture](docs/ARCHITECTURE.md) |
| inspect the desktop interaction model | [Desktop UX architecture](docs/DESKTOP_UX_ARCHITECTURE.md) |
| audit authentication and local trust boundaries | [Security](docs/SECURITY.md) |
| understand MCP lifecycle and compatibility | [MCP protocol policy](docs/MCP_PROTOCOL_POLICY.md) |
| understand recovery and completion authority | [Workflow reliability](docs/WORKFLOW_RELIABILITY.md) |
| understand sessions, activity, and observable evidence | [Task observability](docs/TASK_OBSERVABILITY.md) |
| build, test, package, or release Rel.AI | [Development](docs/DEVELOPMENT.md) |
| see what changed between releases | [Changelog](CHANGELOG.md) |

## Contributing

Focused fixes, product improvements, documentation updates, and regression coverage are welcome.

Keep changes scoped. Preserve the repository's security and compatibility boundaries. Prefer direct code and the smallest useful abstraction. Treat tests as risk controls rather than a reason to duplicate coverage. If a change affects runtime ownership, protocol behavior, security boundaries, or packaging, review the relevant architecture documentation before adding another layer.

## Support

For connection or repository-work problems:

1. Check **Diagnostics** in the Rel.AI desktop app.
2. Review [One-click setup](docs/ONE_CLICK_SETUP.md) and [Connecting to ChatGPT](docs/CONNECTING_TO_CHATGPT.md).
3. If the problem is reproducible, [open a GitHub issue](https://github.com/Kyne0328/rel-ai-mcp/issues) with the smallest safe reproduction and sanitized diagnostics.

Never include tunnel runtime API keys, local bearer credentials, repository secrets, or private keys in a public issue.

## License and attribution

Rel.AI MCP is created and maintained by [Kyne](https://github.com/Kyne0328).

Copyright © 2026 Kyne. The current source tree is released under the [Apache License 2.0](LICENSE). Rel.AI also ships a [NOTICE](NOTICE) identifying Kyne (Kyne0328) as the original creator and linking to the original Rel.AI MCP project. Under Apache-2.0, applicable attribution notices from that NOTICE must be preserved in qualifying derivative distributions.

Previously published Rel.AI releases remain governed by the license terms included with those releases.
