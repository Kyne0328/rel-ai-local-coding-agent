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

The built-in set is Rel.AI's development-methodology layer. Framework, language, database, deployment, UI/UX, security-domain, and other specialist expertise belongs in user-installed skills rather than an ever-growing built-in catalog.

## Build and verify

```bash
npm ci --ignore-scripts
npm run validate:plugin
npm run test:skills
npm run test:tool-budgets
npm run test:plugin
```

`npm run test:plugin` creates the real `npm pack` artifact, extracts it, validates every packaged skill and dependency, installs it temporarily, starts the extracted MCP server, verifies source/package `tools/list` parity, performs a repository read, executes consolidated validation and process-list calls with one `work_id`, and removes the complete installation.

## Built-in and user-installed skills

Built-in skills ship with the Rel.AI plugin and update with the application/plugin version. `skills/PROVENANCE.md` records their first-party ownership and design influences, while plugin validation checks their packaged structure and declared metadata.

The desktop application also owns a separate user-managed skill library under the Rel.AI state directory. In **Settings > Skills**, users can add a public GitHub repository, preview every detected `SKILL.md` or `skill.md`, choose **Select all** or individual skills, and install only the selected packages.

The desktop skill library has three scopes:

- **Built-in** - skills shipped with Rel.AI.
- **Installed** - skills added by the user from GitHub and stored centrally by Rel.AI.
- **Workspace enabled** - the built-in or installed skill IDs selected for a configured workspace.

One installed skill may be enabled for multiple workspaces. Enabling a skill does not copy it into the project repository; workspace configuration stores the selected skill IDs and Rel.AI resolves them from the central library. Reinstalling the same GitHub skill refreshes its central copy. Automatic skill updates and private-GitHub authentication are not part of the first implementation.

## Runtime context behavior

Bundling or installing skills does not change the public MCP tool surface. Rel.AI continues to expose one complete 12-tool capability surface.

For a workspace, the repository snapshot and work-session bootstrap include the `SKILL.md` content of the skills enabled for that workspace. Supporting files stay progressively available through MCP resources using `relai://skill/<skill-id>/file/<relative-path>`, so references, scripts, and data files do not have to be copied into the repository or loaded into every bootstrap response.

Direct HTTP and stdio clients remain usable without enabling workspace skills.
