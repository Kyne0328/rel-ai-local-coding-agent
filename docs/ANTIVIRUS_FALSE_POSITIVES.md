# Antivirus Detection and False-Positive Procedure

Rel.AI MCP distributes a self-contained desktop package that includes the reviewed OpenAI `tunnel-client` executable required by its Secure MCP Tunnel connection model.

## Why detections can occur

Tunneling software has capabilities that can also be abused by unrelated applications. Antivirus products may therefore apply generic capability, PUA, or PUP labels even when the executable came from its expected upstream release. Such a label is not proof that Rel.AI is malicious, but a Trojan or malware classification on an exact release candidate remains a publication blocker until investigated.

Rel.AI does not try to evade detection by encrypting, renaming, nesting, custom-packing, or downloading the tunnel executable after installation.

## Release decision procedure

For every Windows release candidate:

1. build only through the protected release workflow with Windows certificate auto-discovery disabled;
2. verify the installer, portable executable, and unpacked `Rel.AI MCP.exe` by exact SHA-256;
3. verify the packaged OpenAI tunnel client against `vendor/tunnel-client/manifest.json`, including version, file size, and SHA-256;
4. confirm the component is represented in the CycloneDX SBOM;
5. scan the installer, portable executable, unpacked application executable, and extracted tunnel client separately so component attribution is visible;
6. stop publication when Rel.AI-owned executables receive a malware/Trojan classification or when any packaged component differs from its reviewed manifest; and
7. treat a generic capability/PUA/PUP finding limited to the exact manifest-matching tunnel client as a compatibility issue only after vendor submission and review.

## Vendor submissions

Submit the exact release candidate rather than a renamed or locally rebuilt copy. Include:

- product name and version;
- SHA-256 for every submitted file;
- public release URL when available;
- the OpenAI tunnel-client version and source repository recorded by the manifest;
- a concise explanation that Rel.AI is a local ChatGPT Web harness with an embedded MCP service and intentionally bundles the tunnel client for a user-configured OpenAI Secure MCP Tunnel;
- separate scan results showing which component receives the detection; and
- reproduction steps and the affected antivirus product/version.

Record the vendor submission ID, date, candidate SHA-256, detector, label, and final response in the release record. Re-submit only when the executable bytes or the detection materially change.

## User support

Do not instruct users to disable antivirus protection globally. Before a vendor correction is available, provide the exact release SHA-256, identify the affected component, link to the component provenance recorded by the release, and provide the vendor case status. Any allow action remains an explicit user or administrator decision for the exact hashed file.

A tunnel-client upgrade is delivered only through a reviewed Rel.AI application release so the executable bytes stay attributable to the installed Rel.AI version.
