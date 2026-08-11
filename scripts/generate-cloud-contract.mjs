import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildToolManifest, canonicalValue } from '../src/mcp/toolManifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'contracts', 'cloud', 'mcp-manifest.json');
const packageMetadata = Object.freeze(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')));

function renderCloudContract(manifest = buildToolManifest({}), serverInfo = defaultServerInfo()) {
  return `${JSON.stringify(canonicalValue({ ...manifest, serverInfo }), null, 2)}\n`;
}
function defaultServerInfo() {
  return { name: String(packageMetadata.name || 'rel-ai-mcp'), version: String(packageMetadata.version || '') };
}
function runCloudContractGeneration(args = process.argv.slice(2)) {
  const check = args.includes('--check');
  const content = renderCloudContract();
  if (check) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== content) {
      console.error('Public Rel.AI Cloud contract is stale. Run npm run generate:cloud-contract.');
      return 1;
    }
    console.log('Public Rel.AI Cloud contract is current.');
    return 0;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`Generated ${path.relative(root, outputPath)}.`);
  return 0;
}
function isMainModule() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}
if (isMainModule()) process.exitCode = runCloudContractGeneration();
export { defaultServerInfo, outputPath, renderCloudContract, runCloudContractGeneration };
