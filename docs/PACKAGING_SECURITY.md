# Packaging Security Policy

Rel AI MCP separates runtime dependency security from release-tool dependency security.

## Required gates

- `npm run audit:production` must pass with no high-severity production vulnerabilities in either package.
- `npm run audit:packaging` records the complete Electron packaging-tool audit.
- Every packaged build must pass layout verification, connector acceptance, and Electron fuse verification.
- Release artifacts must be generated from a clean output directory.

## Known electron-builder v26 advisory cluster

As of July 28, 2026, electron-builder 26.15.7 retains a development-only advisory cluster inherited through legacy archive and installer utilities. npm's forced automated remediation proposes a breaking downgrade of electron-builder, which is not accepted as a safe modernization path. electron-builder 27 remains prerelease.

These findings are not present in the production dependency tree. They remain tracked release-tool risk and must be re-evaluated whenever electron-builder publishes a stable release that removes the affected graph. Do not suppress or override transitive packages blindly: archive, minimatch, glob, and installer APIs have incompatible major versions.

## Release controls

The release pipeline mitigates packaging-tool risk through:

- trusted repository inputs only;
- clean dependency installation from lockfiles;
- clean artifact directories;
- hardened Electron fuses;
- packaged-layout and connector-flow validation;
- checksums, SBOM generation, and GitHub artifact attestations;
- mandatory Authenticode signing and signature verification for published Windows executables.
