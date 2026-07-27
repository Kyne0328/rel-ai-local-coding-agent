# Installer test safety

## Root cause

The former `test:installed` command built an NSIS package with the production Electron identity (`com.relai.mcp` / `Rel.AI MCP`), installed it silently, and executed the generated uninstaller during teardown. The custom temporary destination isolated files but did not isolate the Windows installer product identity. Windows could therefore treat the test package as the installed production application, and teardown could remove or replace the real installation.

## Safe commands

The following commands do not install or uninstall Rel.AI MCP:

| Command | Purpose | Host safety |
| --- | --- | --- |
| `npm test` | Full source test suite | Safe for normal development |
| `npm run test:all` | Build CSS, static checks, lint, typecheck, release consistency, and source tests | Safe for normal development |
| `npm run electron:build` | Build an unpacked application directory | Does not register or install the app |
| `npm run verify:packaged` | Verify files in the unpacked application directory | Read-only |
| `npm run test:connector-acceptance` | Launch the isolated packaged Node backend and exercise OAuth/MCP | Does not launch or install Electron and uses temporary state |
| `npm run electron:dist` | Produce installer and portable artifacts | Builds artifacts but does not execute them |

No package script currently installs, upgrades, repairs, or uninstalls a Windows application. The removed `test:installed` command must not be restored to `test`, `test:all`, `check`, `verify`, CI, or release verification.

## Installer lifecycle validation

Real NSIS install, upgrade, rollback, and uninstall validation must run only in a disposable Windows VM or dedicated ephemeral CI runner. It must not run on a developer workstation or on a machine where the production Rel.AI MCP installation hosts the test controller.

Any future installer lifecycle harness must use `scripts/installer-test-safety.mjs` and satisfy all of these conditions before executing an installer:

1. explicit `REL_AI_INSTALLER_TEST_ISOLATED=1` opt-in;
2. a unique test run ID and test-owned root;
3. a test-specific application ID, product name, executable name, shortcut namespace, and update channel;
4. an ownership marker matching the current run;
5. cleanup constrained beneath the canonical test root;
6. refusal of empty, root, home, production, and system paths;
7. refusal when a production-identity installation is present;
8. no production-identity installer except in an explicitly disposable release-validation runner.

A temporary `/D=<path>` argument alone is not sufficient isolation because installer identity and registry state are independent from the destination directory.

## Recovery after the old defect

If a previous test removed the application, reinstall the current published Rel.AI MCP installer. Before restoring settings, inspect the existing Rel.AI state and configuration directories; reinstalling binaries should not require deleting user configuration. Do not rerun the former installed-app smoke command to diagnose the problem.

## Regression enforcement

`test/installer-test-entrypoints-unit.mjs` fails when ordinary package scripts, CI, or the release workflow invoke installer or uninstaller behavior. `test/installer-test-safety-unit.mjs` verifies path rejection, unique test identities, ownership markers, and cross-run cleanup isolation for any future disposable installer harness.
