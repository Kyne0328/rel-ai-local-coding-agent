# ECMAScript Module Migration Policy

Rel AI MCP is intentionally moving toward native ECMAScript Modules without maintaining a permanent dual build.

## Current boundary

- Browser UI source under `src/ui/` is explicitly ESM through its package scope.
- Build scripts and tests use ESM where their runtime supports it.
- The backend, CLI, and Electron main process remain CommonJS during the coordinated migration.
- Sandboxed Electron preload output will remain explicit `.cjs`, because that runtime boundary requires CommonJS semantics.

`npm run verify:module-system` records the current migration ceiling and fails if CommonJS grows, ESM ownership shrinks, or mixed modules appear. The baseline is a non-regression guard, not an endorsement of the remaining CommonJS surface.

## Hard-cutover sequence

1. Convert leaf backend utilities with no circular dependencies.
2. Convert repository, process, persistence, OAuth, and observability modules by dependency layer.
3. Convert MCP and HTTP entry points.
4. Convert CLI launchers.
5. Convert the Electron main process.
6. Generate or retain sandboxed preloads as explicit `.cjs` artifacts.
7. Add the root `"type": "module"` declaration only after every implicit CommonJS `.js` file has moved or been renamed.
8. Remove `createRequire`, compatibility wrappers, aliases, and any temporary dual entry points in the same migration branch.

## Exit criteria

- Native ESM source for root runtime, CLI, Electron main, scripts, and tests.
- No mixed ESM/CommonJS modules.
- No dual package build unless a named external consumer requires it.
- Only documented Electron preload `.cjs` artifacts remain CommonJS.
- Packaged OAuth/MCP connector acceptance and Electron security tests remain green.
