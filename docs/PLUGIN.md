# Rel.AI Plugin

The distributable package contains the Rel.AI MCP connector and five first-party workflow skills as one versioned plugin unit. Connector implementation, skill instructions, metadata, references, and provenance remain separate internal files.

## Structure

```text
.codex-plugin/plugin.json
.mcp.json
skills/
├── PROVENANCE.md
├── rel-ai-workflow/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   └── references/
├── rel-ai-investigation/
│   ├── SKILL.md
│   └── agents/openai.yaml
├── rel-ai-debugging/
│   ├── SKILL.md
│   └── agents/openai.yaml
├── rel-ai-verification/
│   ├── SKILL.md
│   └── agents/openai.yaml
└── rel-ai-dev-process/
    ├── SKILL.md
    └── agents/openai.yaml
bin/rel-ai-mcp.js
src/
package.json
```

`rel-ai-workflow` owns the work session. Specialized skills reuse its `work_id` and refine investigation, debugging, verification, or persistent-process procedure. They do not duplicate MCP schemas or weaken server policy.

## Build and verify

```bash
npm ci --ignore-scripts
npm run validate:plugin
npm run test:skills
npm run test:tool-budgets
npm run test:plugin
```

`npm run test:plugin` creates the real `npm pack` artifact, extracts it, validates every packaged skill and dependency, installs it temporarily, starts the extracted MCP server, verifies source/package `tools/list` parity, performs a repository read, executes consolidated validation and process-list calls with one `work_id`, and removes the complete installation.

## Install, update, and remove

Install the unpacked plugin directory or extracted package through a compatible host. The manifest points to the bundled `.mcp.json` and `skills/` directory, so connector and skills are installed, updated, and removed together. Do not copy the MCP or skills separately.

The npm package remains private and is used as a deterministic build artifact; it is not presented as a public npm installation command.

## Context behavior

Bundling skills with the connector does not itself reduce MCP discovery cost. The default `compact` profile exposes the complete 12-tool surface, while `core` exposes seven high-frequency tools for token-sensitive workflows. These are the only supported profiles. Skill trigger metadata remains small, and detailed procedures load only after a matching skill is selected.

Direct HTTP and stdio clients remain usable without loading skills. Server-side workspace ownership, approvals, command limits, Task negotiation, and destructive safeguards remain authoritative.

## Supply-chain policy

The initial skill set contains no executable skill scripts, remote downloads, silent updates, hooks, or telemetry. `skills/PROVENANCE.md` records first-party ownership and design influences. Plugin validation rejects missing provenance, undeclared skill metadata, executable skill script directories, and common remote-download commands.
