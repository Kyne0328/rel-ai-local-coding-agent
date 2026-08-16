# Rel.AI Plugin

The distributable package contains the Rel.AI MCP connector and six first-party workflow skills as one versioned plugin unit. Connector implementation, built-in skill instructions, metadata, references, and provenance remain separate internal files.

## Structure

```text
.codex-plugin/plugin.json
.mcp.json
skills/
|-- PROVENANCE.md
|-- rel-ai-workflow/
|   |-- SKILL.md
|   |-- agents/openai.yaml
|   `-- references/
|-- rel-ai-planning/
|   |-- SKILL.md
|   `-- agents/openai.yaml
|-- rel-ai-investigation/
|   |-- SKILL.md
|   `-- agents/openai.yaml
|-- rel-ai-debugging/
|   |-- SKILL.md
|   `-- agents/openai.yaml
|-- rel-ai-verification/
|   |-- SKILL.md
|   `-- agents/openai.yaml
`-- rel-ai-dev-process/
    |-- SKILL.md
    `-- agents/openai.yaml
bin/rel-ai-mcp.js
src/
package.json
```

`rel-ai-workflow` is the only work-session owner. The other built-in skills reuse its `work_id` and provide narrow specialist reasoning:

- `rel-ai-planning` - architecture-aware planning, sequencing, completion conditions, and cumulative consolidation for non-trivial implementation work.
- `rel-ai-investigation` - minimum-evidence repository audits, feasibility analysis, dependency tracing, and verified conclusions.
- `rel-ai-debugging` - reproducible failure isolation, causal tracing, root-cause repair, and targeted regression proof.
- `rel-ai-verification` - risk-based completion evidence using the smallest meaningful non-overlapping checks for the changed boundary.
- `rel-ai-dev-process` - persistent development servers, watchers, preview runtimes, and interactive programs.

The built-in set is Rel.AI's development-methodology layer. Framework, language, database, deployment, UI/UX, security-domain, and other specialist expertise stays outside this intentionally small built-in catalog; the desktop application does not currently provide a user-managed skill installation flow.

## Build and verify

```bash
npm ci --ignore-scripts
npm run validate:plugin
npm run test:skills
npm run measure:tool-surface
npm run test:plugin
```

`npm run test:plugin` creates the real `npm pack` artifact, extracts it, validates every packaged skill and dependency, installs it temporarily, starts the extracted MCP server, verifies source/package `tools/list` parity, performs a repository read, executes consolidated validation and process-list calls with one `work_id`, and removes the complete installation.

## Built-in skills

Built-in skills ship with the Rel.AI plugin and update with the application/plugin version. `skills/PROVENANCE.md` records their first-party ownership and design influences, while plugin validation checks their packaged structure and declared metadata.

The desktop application does not currently expose a user-managed skill library or per-workspace skill assignments. Repository snapshots and work-session bootstraps therefore do not inject separately installed skill packages.

Bundled workflow skills remain part of the plugin package without adding skill-management operations to the public Rel.AI MCP tool surface.
