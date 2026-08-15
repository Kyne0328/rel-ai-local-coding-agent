<p align="center">
  <img src="electron/build/icon.png" alt="Rel.AI MCP" width="112" />
</p>

<h1 align="center">Rel.AI MCP</h1>

<p align="center">
  <strong>Let ChatGPT work with your local code.</strong><br />
  Rel.AI connects ChatGPT web to projects on your computer so it can find files, edit code, run commands and tests, review changes, and use Git.
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
  <img src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS%20%7C%20Linux-informational?style=flat-square" alt="Windows, macOS, and Linux" />
  <img src="https://img.shields.io/badge/MCP-2026--07--28-7c3aed?style=flat-square" alt="MCP 2026-07-28" />
</p>

---

Rel.AI MCP connects **ChatGPT web to local projects you choose**. ChatGPT provides the conversation and reasoning. Rel.AI gives that conversation the tools to find files, edit code, run commands and tests, inspect the result, review changes, and use Git on your computer.

It is not a hosted coding computer, a new AI model, or an unrestricted remote shell. It is a local bridge between ChatGPT and the projects you explicitly add to Rel.AI.

**Your project stays local. Each task stays separate. You review the result.**

## Why Rel.AI exists

Rel.AI is for developers who want to keep coding in the normal ChatGPT web conversation instead of moving every repository task into Codex.

OpenAI currently documents that [ChatGPT Apps use the normal ChatGPT rate limits for your plan](https://help.openai.com/en/articles/11487775-connectors-in), while [Codex usage counts toward agentic usage](https://help.openai.com/en/articles/11369540-codex-and-chatgpt-plan-usage-limits). Rel.AI uses the ChatGPT app/tool path, so working through Rel.AI does not draw from the Codex agentic allowance. Your normal ChatGPT plan limits still apply; Rel.AI does not claim unlimited usage.

ChatGPT supplies the model and reasoning. Rel.AI supplies the local coding tools. Model availability is controlled by ChatGPT and can change independently of Rel.AI.

### Can Rel.AI replace Codex?

For many everyday repository tasks, yes. If you use Codex to read a project, edit files, run commands and tests, inspect the result, and use Git, Rel.AI provides that kind of workflow through normal ChatGPT. Rel.AI does not emulate Codex internals or claim to be the same product.

### Why is Rel.AI built specifically for ChatGPT?

That focus is intentional. Rel.AI is designed around normal ChatGPT web usage plus the OpenAI Secure MCP Tunnel, so the desktop app, work sessions, workspace permissions, checks, recovery, and publishing rules can be built and tested as one complete workflow.

Rel.AI does not currently support Claude, Cursor, Gemini, or other AI clients. Supporting another client would require a separate connection and compatibility contract rather than simply changing a provider setting.

## How Rel.AI keeps work clear and controlled

| | Rel.AI rule | What it means in practice |
| --- | --- | --- |
| **01** | **Only added projects** | ChatGPT can work only inside folders you add as Rel.AI workspaces. It does not get open-ended access to your computer. |
| **02** | **One task stays together** | Each new goal gets its own work session, so its edits, checks, review, recovery, and completion stay linked to the same task. |
| **03** | **Checks confirm the result** | A command saying "done" is not enough. Rel.AI checks the current code before the task is considered complete. |
| **04** | **Publishing is separate** | Editing code does not automatically commit, push, or prepare pull-request text. Those actions happen only when requested. |

These rules are why Rel.AI is more than a file connector or unrestricted command bridge.

## One task, end to end

```text
You describe what you want in ChatGPT
                │
                ▼
            Understand
     find and read the relevant code
                │
                ▼
              Change
       make focused edits in the project
                │
                ▼
                Run
       commands, tests, or local apps
                │
                ▼
               Check
     confirm the latest changes work
                │
                ▼
              Publish
      commit or push only when asked
```

Rel.AI also keeps track of what was already changed before the task and what the current task changed, so it does not need to pretend every project starts from a clean Git state.

## Start using Rel.AI

Rel.AI uses one connection model: **OpenAI Secure MCP Tunnel**. Your project files and commands stay on the computer running Rel.AI. The tunnel is the private connection ChatGPT uses to reach the local Rel.AI service.

1. **Install Rel.AI MCP** from the [Releases page](https://github.com/Kyne0328/rel-ai-mcp/releases). Current desktop packaging targets Windows, macOS (Intel and Apple Silicon), and Linux.
2. **Create an OpenAI Secure MCP Tunnel** for this computer and create a runtime API key for that tunnel in OpenAI Platform.
3. **Configure Rel.AI.** Enter the tunnel ID and runtime API key in the first-run wizard. Rel.AI encrypts the runtime key with Electron `safeStorage` and supervises the bundled OpenAI tunnel client.
4. **Add a workspace.** Pick a repository folder and give it a short alias such as `myapp`.
5. **Connect ChatGPT.** Create/add Rel.AI MCP with ChatGPT's **Tunnel** connection option, select this computer's Secure MCP Tunnel, and set **Authentication** to **No authentication**. If Rel.AI MCP already exists in ChatGPT, reconnect that existing integration instead of creating a duplicate.
6. **Use the workspace alias.** Rel.AI resolves repository access locally from the configured alias; ChatGPT does not need the absolute path on your computer.

A useful first request is intentionally read-only:

```text
Use Rel.AI MCP with workspace "myapp". Start one work session, read the project, and explain how the relevant parts work before changing anything.
```

Then move into a real implementation loop:

```text
Use Rel.AI MCP with workspace "myapp". Make this change, run the relevant checks, show me what changed, and do not commit or push unless I ask.
```

See [One-click setup](docs/ONE_CLICK_SETUP.md) for the installed-app walkthrough and [Connecting to ChatGPT](docs/CONNECTING_TO_CHATGPT.md) for tunnel setup, reconnects, and recovery.

## What Rel.AI lets ChatGPT do

### Find the relevant code before changing it

Rel.AI helps ChatGPT narrow down a project before reading large amounts of code.

- **Repository snapshots** surface structure, manifests, detected checks, and project hints.
- **Bounded reads** target files and line ranges instead of returning unlimited content.
- **Text search** covers tracked and untracked workspace files.
- **Code intelligence** follows symbols, references, calls, related files, imports, affected tests, and available diagnostics.
- **Hybrid semantic search** combines lexical, path, symbol, and private local vector signals without sending source text to a hosted embedding service.

This helps ChatGPT spend its context on the files that matter instead of dumping large parts of the project into the conversation.

### Make focused edits

Rel.AI uses one main editing surface instead of exposing many overlapping ways to change files.

It supports exact replacements, multiple replacements in one file, full-file writes, patch-shaped updates, large staged changes, workspace containment, symlink protection, and optional SHA-256 stale-write checks. Large migrations can stay one logical task instead of being fragmented purely because one request is too large.

Managed Git worktrees are available when isolated parallel work is appropriate, while ordinary tasks continue to use the repository you configured.

### Run commands and local apps

Rel.AI can run one-shot project commands and manage long-running local processes such as development servers and watchers.

One-shot execution returns bounded output, exit state, timing, and detected file changes. Managed processes have stable IDs, bounded persistent logs, interactive input when appropriate, workspace attribution, and controlled shutdown. This keeps development servers and watchers separate from one-off checks and builds.

### Check the result

Rel.AI chooses checks based on what the task changed and can reuse a recent check when it still proves the current code. If a command changes files and then fails, Rel.AI still records that change. If a command succeeds but does not actually confirm the result, the task is not treated as complete just because the exit code was zero.

### Use Git only when asked

Rel.AI can review task changes, commit scoped work, push to an existing Git remote, and prepare pull-request draft text. Publishing stays separate from editing. Push targets must already exist in the repository, and sensitive staged paths require narrower authorization.

## How ChatGPT connects to your computer

OpenAI Secure MCP Tunnel gives ChatGPT a private connection to Rel.AI while the project and its development environment stay on your computer.

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

## The desktop shows what is happening

Rel.AI's desktop app shows the local side of the workflow and gives you one place to see what ChatGPT can access and what Rel.AI is doing:

- **Workspaces** — which repositories ChatGPT is allowed to use, plus repository and validation details.
- **Sessions** — active and historical objectives with task status and completion state.
- **Activity** — individual Rel.AI tool events and recorded results.
- **Processes** — long-running development processes and bounded output.
- **Connection** — Secure MCP Tunnel state, local MCP health, recovery, and ChatGPT connection guidance.
- **Usage** — locally observed request, tool, outcome, duration, and workspace aggregates.
- **Diagnostics and settings** — application health, updates, notification preferences, recovery guidance, and additional controls.

Rel.AI records observable tool activity and results. It does not claim access to ChatGPT's private reasoning.

## Security starts with the projects you add

Rel.AI MCP is a **trusted local coding bridge, not a sandbox**. ChatGPT can work only with projects you explicitly add, and Rel.AI limits that access with workspace, task, process, Git, and desktop boundaries.

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

## One supported ChatGPT connection

Rel.AI intentionally supports one ChatGPT connection: **OpenAI Secure MCP Tunnel**. There is no provider switch or second transport path to keep synchronized.

The desktop owns the local MCP service, tunnel client, connection state, encrypted runtime key, and local bearer credential. ChatGPT owns the remote tunnel association. Keeping those responsibilities separate makes reconnects predictable without letting a connection change decide what happens to repository work.

## Small public tool surface, broad workflow

The current release exposes **12 public MCP tools** through one canonical action catalog and targets MCP protocol `2026-07-28`.

The surface is intentionally consolidated. Rel.AI does not need a public tool for every internal operation when one coherent capability can own the contract. That keeps schemas, authorization, task behavior, output validation, and dashboard metadata aligned around a smaller interface while still supporting repository inspection, search, edits, execution, processes, validation, review, Git operations, recovery, and work-session lifecycle.

See [MCP protocol policy](docs/MCP_PROTOCOL_POLICY.md) and [Architecture](docs/ARCHITECTURE.md) for the current protocol and ownership model.

## Bundled workflow skills

Rel.AI ships six first-party workflow skills for work-session orchestration, planning, investigation, debugging, verification, and persistent development processes. They are versioned with the plugin and provide reusable operating guidance without adding skill-management controls to the desktop app or public MCP tool surface.

The desktop application does not currently provide user-installed or per-workspace skill management.

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
