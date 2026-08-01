# Antivirus Detection and False-Positive Procedure

Rel.AI MCP distributes one Windows installer without embedding `ngrok.exe`. During first-run setup, and only after explicit consent, Rel.AI downloads the exact pinned official ngrok archive and configures it automatically.

## Why detections can occur

ngrok is a legitimate upstream-signed tunneling utility, but the same capability can be abused to expose services or bypass ordinary network boundaries. Antivirus products may therefore classify the official agent as a potentially unwanted application when it is downloaded, moved, or executed. Removing ngrok from the Rel.AI installer separates installer reputation from the tunnel component, but it cannot guarantee that every antivirus product will allow ngrok itself.

Rel.AI does not attempt to avoid detection by encrypting, renaming, nesting, custom-packing, proxying, or otherwise disguising ngrok. It does not disable antivirus controls or create exclusions. The first-run UI identifies the component and requires consent.

## Acquisition security

Before ngrok is executed, Rel.AI verifies:

1. the download uses the reviewed official HTTPS distribution host and immutable version URL;
2. the archive byte length and SHA-256 match the packaged manifest;
3. the archive contains exactly one expected `ngrok.exe` and no symbolic links;
4. the executable byte length and SHA-256 match the manifest;
5. Windows reports a valid Authenticode signature from the expected ngrok publisher and certificate issuer; and
6. the executable reports the exact pinned ngrok version.

Installation into `~/.rel-ai-mcp/managed-ngrok/` is atomic. A previously valid copy is preserved if replacement fails. Missing, modified, quarantined, or otherwise invalid bytes are never executed.

## Release decision procedure

For every Windows release candidate:

1. Verify the manifest-only package contains no `ngrok.exe`.
2. Run `npm run verify:ngrok -- --download` on Windows to exercise the official download, archive verification, extraction, Authenticode verification, and version check in a temporary directory.
3. Confirm the pinned archive and executable hashes, sizes, distribution URL, and delivery mode are represented in the CycloneDX SBOM.
4. Scan the installer, portable executable, and unpacked Rel.AI executable as Rel.AI-owned samples.
5. Separately scan the exact acquired ngrok executable to determine whether a classification follows the upstream tunnel component.
6. Stop publication when a Rel.AI-owned executable receives a Trojan or malware classification, when the acquisition manifest is invalid, or when the official component differs from the reviewed provenance.
7. A generic PUA/PUP classification limited to the authentic ngrok component may be treated as a documented compatibility issue after vendor submission and review; it must not be described as guaranteed malware-free solely because other scanners are clean.

## Vendor submissions

Submit the exact affected bytes. Include the product and component version, SHA-256, public release URL when available, upstream Authenticode identity, the reviewed archive URL, a concise explanation that Rel.AI is a local MCP bridge and downloads ngrok only after user consent, separate component scan results, reproduction steps, and the affected antivirus product/version.

For Microsoft Defender, use Microsoft's file-submission portal and identify the submission as a software developer reporting an incorrect detection. Submit the Rel.AI installer only when it is detected; submit the separately acquired ngrok executable for ngrok-specific classifications. Use each other vendor's false-positive or sample-submission channel for its own label.

Record the submission ID, date, exact SHA-256, detector name, label, and final vendor response. Re-submit only when the executable bytes or detection materially change.

## User support

Do not instruct users to disable antivirus protection globally. Rel.AI must surface the acquisition or quarantine failure clearly. Any allow action remains an explicit user or administrator decision for the exact verified upstream file.

The managed ngrok copy does not self-update. A Rel.AI release may update the pinned acquisition manifest; the next consented repair or required version transition then acquires and verifies the new exact component.
