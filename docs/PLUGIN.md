# Rel.AI Plugin

The distributable package contains the Rel.AI MCP connector and the `rel-ai-workflow` skill as one versioned plugin unit. The connector implementation, skill instructions, and skill references remain separate files.

## Structure

```text
.codex-plugin/plugin.json
.mcp.json
skills/rel-ai-workflow/SKILL.md
skills/rel-ai-workflow/agents/openai.yaml
skills/rel-ai-workflow/references/workflows.md
skills/rel-ai-workflow/references/safety.md
bin/rel-ai-mcp.js
src/
package.json
```

## Build and verify

```bash
npm ci --ignore-scripts
npm run validate:plugin
npm run measure:tool-surface
npm run test:plugin
```

`npm run test:plugin` creates the actual `npm pack` artifact, extracts it, validates the packaged manifests and skill, copies the package into a temporary installation directory, checks the MCP entrypoint, and removes the complete installation.

## Install, update, and remove

Install the unpacked plugin directory or the extracted package artifact through a host that supports Codex-compatible plugins. The plugin manifest points to the bundled `.mcp.json` and `skills/` directory, so the connector and workflow skill are installed, updated, and removed together. Use the host's normal plugin update or removal operation on the `rel-ai-mcp` plugin unit rather than copying the MCP or skill separately.

The npm package remains private and is used as the deterministic build artifact; it is not presented as a public npm installation command.

## Context behavior

Bundling a skill with the connector does not reduce MCP discovery cost. The compact 12-tool registry and short global MCP instructions provide the direct discovery reduction. Hosts that load the skill receive additional workflow guidance. A direct HTTP or stdio MCP client receives only MCP schemas, descriptions, server instructions, and server-enforced safeguards unless that host independently supports the packaged skill.
