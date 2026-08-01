# Packaging Security Policy

Rel AI MCP separates runtime dependency security from release-tool dependency security and treats the bundled tunnel agent as an explicit release component.

## Required gates

- `npm run audit:production` must pass with no high-severity production vulnerabilities in either package.
- `npm run audit:packaging` is a blocking, fail-closed Electron build-tool audit. It accepts only the documented advisory URL and package set, only when every affected lockfile node is dev, peer, or optional build tooling, and only until the policy expiration date.
- Every packaged build must pass layout verification, connector acceptance, and Electron fuse verification.
- Release artifacts must be generated from a clean output directory.
- Published Windows builds must use `forceCodeSigning`; release publication fails instead of producing an unsigned candidate.
- The packaged application executable, installer, and portable executable must have valid Authenticode signatures.

## Bundled ngrok policy

Rel.AI keeps a one-installer user experience: ngrok remains embedded in the application package. It is not hidden, renamed to evade detection, packed again, or downloaded silently after installation.

`vendor/ngrok/manifest.json` pins the reviewed ngrok version, distribution URL, exact size, and SHA-256. Windows release preparation also verifies the upstream Authenticode publisher and certificate issuer. The same manifest is packaged with the application, checked against the packaged binary, and represented in the CycloneDX SBOM.

The writable managed copy is replaced whenever it differs from the packaged hash. ngrok update checks and remote management are disabled, so executable bytes change only through a signed Rel.AI release. This deterministic component lifecycle improves incident analysis and antivirus false-positive submissions without requiring users to install ngrok separately.

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
