# Packaging Security Policy

Rel.AI MCP separates runtime dependency security from release-tool dependency security and treats the bundled OpenAI tunnel client as an explicit reviewed release component.

## Required gates

- `npm run audit:production` must pass with no high-severity production vulnerabilities in either package.
- `npm run audit:packaging` is a blocking, fail-closed Electron build-tool audit with only the repository's documented temporary exception policy.
- Every packaged build must pass layout verification, packaged MCP acceptance, and Electron fuse verification.
- Release artifacts are generated from a clean output directory.
- Published Windows builds currently disable certificate auto-discovery and remain unsigned until a trusted Windows code-signing certificate is configured.
- Every published Rel.AI executable is covered by `SHA256SUMS.txt`.
- The bundled OpenAI `tunnel-client` must match the reviewed manifest exactly.

## Bundled OpenAI tunnel-client policy

Rel.AI keeps the tunnel runtime inside the application package so the installed desktop does not depend on a separate tunnel-client installation.

`vendor/tunnel-client/manifest.json` pins the reviewed version, source repository, license, per-platform release URL, exact file size, and SHA-256. `scripts/fetch-tunnel-client.mjs` fetches only the pinned archive for supported platforms and refuses bytes that do not match the manifest. `scripts/verify-tunnel-client.mjs` verifies the extracted binary before packaging.

The same manifest and platform binary are copied outside ASAR under `resources/bin/tunnel-client/`. `scripts/verify-packaged-app.mjs` rechecks the packaged size and SHA-256. Runtime code does not accept a renderer-supplied executable path and does not silently replace the binary after installation; upgrades arrive through reviewed Rel.AI releases.

## Antivirus classification

A tunneling executable may receive capability-based or potentially-unwanted classifications because tunneling can also be abused by unrelated software. Rel.AI does not hide, rename, custom-pack, or download the executable after installation to evade scanners.

A malware or Trojan classification on any exact release candidate remains a publication blocker until the bytes and component attribution are investigated. Generic capability-based findings limited to a manifest-matching upstream tunnel client may be handled through the documented vendor false-positive process, but they are never described as guaranteed harmless solely because other scanners are clean.

See [ANTIVIRUS_FALSE_POSITIVES.md](ANTIVIRUS_FALSE_POSITIVES.md) for the release decision and submission procedure.

## Known electron-builder v26 advisory cluster

The release toolchain pins electron-builder 26.15.3. Its lockfile currently has a documented, expiry-bound build-tool advisory exception. `scripts/packaging-audit-policy.json` restricts that exception by advisory, package set, dependency role, and expiration date. A new advisory, new package, critical finding, runtime-reachable node, malformed policy, or expired policy fails publication.

Production dependency audits remain separate and must report zero high-severity findings.

## Release controls

The release pipeline relies on:

- trusted repository inputs and lockfile-based dependency installation;
- clean artifact directories;
- an expiry-bound build-tool audit exception;
- pinned OpenAI tunnel-client provenance and packaged hash verification;
- hardened Electron fuses;
- packaged-layout and bearer-authenticated MCP acceptance;
- exact canonical release filenames and updater SHA-512 verification;
- SHA-256 coverage, CycloneDX SBOM generation, and GitHub artifact attestations; and
- explicit unsigned-build configuration for Rel.AI-owned Windows executables until trusted code signing is introduced.
