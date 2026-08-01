# Packaging Security Policy

Rel AI MCP separates runtime dependency security from release-tool dependency security and treats the externally acquired tunnel agent as an explicit, pinned runtime component.

## Required gates

- `npm run audit:production` must pass with no high-severity production vulnerabilities in either package.
- `npm run audit:packaging` is a blocking, fail-closed Electron build-tool audit. It accepts only the documented advisory URL and package set, only when every affected lockfile node is dev, peer, or optional build tooling, and only until the policy expiration date.
- Every packaged build must pass layout verification, connector acceptance, and Electron fuse verification.
- Release artifacts must be generated from a clean output directory.
- Published Windows builds must use `forceCodeSigning`; release publication fails instead of producing an unsigned candidate.
- The packaged application executable, installer, and portable executable must have valid Authenticode signatures.

## Verified ngrok acquisition policy

Rel.AI keeps a one-installer user experience without embedding ngrok in that installer. The package contains only a reviewed acquisition manifest. First-run setup requires explicit user consent before any network request, and no downloaded executable is run before verification.

`vendor/ngrok/manifest.json` pins the exact ngrok version, immutable official archive URL, archive size and SHA-256, executable size and SHA-256, and Windows Authenticode publisher and certificate issuer. Runtime acquisition downloads to an isolated temporary directory, enforces a strict byte limit and bounded retries, rejects unexpected archive contents, verifies every pinned property, and atomically installs the executable into Rel.AI managed storage. Packaging and release verification fail if `ngrok.exe` appears inside the application package.

The managed copy is reused only while it continues to pass the complete executable verification. Missing or invalid bytes are not executed and can be reacquired only after recorded consent. ngrok update checks and remote management remain disabled. The exact externally acquired component is represented in the CycloneDX SBOM.

## Antivirus classification

Tunneling agents may receive generic PUA, PUP, or capability-based classifications even when their signature and provenance are valid. A detection is not bypassed or suppressed in product code. The exact signed release candidate is inspected component-by-component, and incorrect detections are submitted to the relevant antivirus vendor before broad distribution.

See [ANTIVIRUS_FALSE_POSITIVES.md](ANTIVIRUS_FALSE_POSITIVES.md) for the release decision and submission procedure.

## Known electron-builder v26 advisory cluster

The release toolchain pins electron-builder 26.15.3. Its lockfile currently reports one inherited brace-expansion denial-of-service advisory across 16 development-only archive, glob, and installer packages. npm's forced remediation proposes an incompatible builder downgrade, so it is not used.

`scripts/packaging-audit-policy.json` limits the temporary acceptance to advisory `GHSA-mh99-v99m-4gvg`, the exact reviewed package set, and build-only lockfile nodes. The exception expires on 2026-08-31. Any new package, advisory URL, critical finding, runtime-reachable node, malformed policy, or expired policy fails publication. Production dependency audits remain separate and must report zero high-severity findings.

## Release controls

The release pipeline mitigates packaging-tool risk through:

- trusted repository inputs only;
- clean dependency installation from lockfiles;
- clean artifact directories;
- an expiry-bound and package-scoped build-tool audit exception;
- pinned and authenticated ngrok provenance;
- disabled ngrok self-update and remote management;
- hardened Electron fuses;
- packaged-layout and connector-flow validation;
- component-level signature and hash verification;
- exact canonical release filenames, updater SHA-512 verification, SHA-256 coverage, SBOM generation, and GitHub artifact attestations;
- mandatory Authenticode signing and signature verification for published Windows executables.
