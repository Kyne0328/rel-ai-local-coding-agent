# Antivirus Detection and False-Positive Procedure

Rel.AI MCP distributes one self-contained Windows installer. The ngrok agent remains bundled so end users do not need Node.js, npm, ngrok, or a second installer.

## Why detections can occur

ngrok is a legitimate signed tunneling utility, but the same capability can be abused to expose services or bypass ordinary network boundaries. Antivirus products may therefore classify the official agent or an installer containing it as a potentially unwanted application. Generic labels do not prove that Rel.AI code is malicious, but a Trojan classification on a release candidate is still a publication blocker until the exact bytes are investigated.

Rel.AI does not attempt to avoid detection by encrypting, renaming, nesting, custom-packing, or downloading the executable after installation. Those approaches reduce transparency and can increase heuristic detections.

## Release decision procedure

For every Windows release candidate:

1. Build only through the protected release workflow with Windows certificate auto-discovery disabled.
2. Verify the installer, portable executable, and unpacked `Rel.AI MCP.exe` independently by exact SHA-256; these Rel.AI-owned files are currently unsigned.
3. Verify the packaged ngrok binary against `vendor/ngrok/manifest.json`: version, exact size, SHA-256, Authenticode status, publisher, and issuer.
4. Confirm the packaged ngrok hash is represented in the CycloneDX SBOM.
5. Scan the installer, portable executable, unpacked application executable, and ngrok executable as separate samples. This identifies whether the classification follows ngrok or Rel.AI's own code.
6. Stop publication when Rel.AI-owned executables receive a Trojan or malware classification or when any component differs from its reviewed hash or manifest. An expected `NotSigned` result alone is not a malware finding.
7. A generic PUA/PUP classification limited to the authentic ngrok component may be treated as a documented compatibility issue after vendor submission and review; it must not be described as guaranteed malware-free solely because other scanners are clean.

## Vendor submissions

Submit the exact release candidate, not a locally rebuilt or renamed copy. Include:

- product name and version;
- SHA-256 for every submitted file;
- public GitHub release URL when available;
- the note that Rel.AI-owned artifacts are unsigned, plus the upstream Authenticode details for bundled ngrok;
- the ngrok version and its upstream signature details;
- a concise explanation that Rel.AI is a local MCP bridge and intentionally bundles ngrok for a user-authorized static tunnel;
- separate scan results showing whether detection follows the ngrok component;
- reproduction steps and the affected antivirus product/version.

For Microsoft Defender, use Microsoft's file-submission portal and identify the submission as a software developer reporting an incorrect detection. Submit the exact installer and the separately extracted ngrok binary when both are detected. Use each other vendor's false-positive or sample-submission channel for its own label.

Record the submission ID, date, candidate SHA-256, detector name, label, and final vendor response in the release record. Re-submit only when the executable bytes or the detection materially change.

## User support

Do not instruct users to disable antivirus protection globally. Before a vendor correction is available, provide the release SHA-256, disclose that Rel.AI-owned files are unsigned, provide ngrok's upstream signer identity, explain the affected component, and provide the vendor case status. Any allow action remains an explicit user or administrator decision for the exact hashed file.

A new Rel.AI application release is the only supported way to upgrade the bundled ngrok agent. The managed copy does not self-update, so its hash stays attributable to the installed Rel.AI version.
