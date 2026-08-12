import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor','tunnel-client','manifest.json'),'utf8'));
const requested=(process.env.TUNNEL_CLIENT_PLATFORMS||process.platform).split(',').map(v=>v.trim()).filter(Boolean);
for(const platform of requested){const spec=manifest.platforms[platform];if(!spec)throw new Error(`Unsupported tunnel-client platform: ${platform}`);const file=path.join(root,'vendor','tunnel-client',platform,spec.file);if(!fs.existsSync(file))throw new Error(`OpenAI tunnel-client is missing for ${platform}. Run npm run fetch:tunnel-client.`);const stat=fs.statSync(file);if(!stat.isFile()||stat.size!==spec.size)throw new Error(`OpenAI tunnel-client size mismatch for ${platform}. Run npm run fetch:tunnel-client.`);const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(hash!==spec.sha256)throw new Error(`OpenAI tunnel-client SHA-256 mismatch for ${platform}.`);console.log(`Verified OpenAI tunnel-client ${manifest.version} for ${platform}: ${hash}`);}
