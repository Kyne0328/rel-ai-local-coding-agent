import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor','tunnel-client','manifest.json'),'utf8'));
const requested=(process.env.TUNNEL_CLIENT_PLATFORMS||process.platform).split(',').map(value=>value.trim()).filter(Boolean);
const targetArch=normalizeArch(process.env.REL_AI_TARGET_ARCH||process.arch);
for(const platform of requested) await fetchPlatform(platform);

async function fetchPlatform(platform){
  const spec=resolvePlatformSpec(platform,targetArch);
  if(!spec)throw new Error(`Unsupported tunnel-client platform/architecture: ${platform}/${targetArch}`);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'relai-tunnel-client-'));
  try{
    const archive=path.join(temporary,spec.archive);
    const response=await fetch(`${manifest.baseUrl}/${spec.archive}`,{redirect:'follow'});
    if(!response.ok)throw new Error(`OpenAI tunnel-client download failed with HTTP ${response.status}.`);
    fs.writeFileSync(archive,Buffer.from(await response.arrayBuffer()));
    verifyBuffer(fs.readFileSync(archive),spec.archiveSha256,undefined,`${platform} archive`);
    const extracted=path.join(temporary,'extracted');fs.mkdirSync(extracted,{recursive:true});
    if(process.platform==='win32'){
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${psQuote(archive)}' -DestinationPath '${psQuote(extracted)}' -Force`],{stdio:'pipe'});
    }else{
      execFileSync('unzip',['-q',archive,'-d',extracted],{stdio:'pipe'});
    }
    const preferred=path.join(extracted,...String(spec.archiveEntry).split('/'));
    const source=fs.existsSync(preferred)?preferred:findExtractedExecutable(extracted,spec.file);
    const data=fs.readFileSync(source);verifyBuffer(data,spec.sha256,spec.size,`${platform} executable`);
    const targetDir=path.join(root,'vendor','tunnel-client',platform);fs.mkdirSync(targetDir,{recursive:true});
    const target=path.join(targetDir,spec.file);fs.writeFileSync(target,data,{mode:0o755});
    if(platform!=='win32')try{fs.chmodSync(target,0o755);}catch{}
    console.log(`Verified OpenAI tunnel-client ${manifest.version} for ${platform}: ${spec.sha256}`);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
function resolvePlatformSpec(platform,arch){const platformSpec=manifest.platforms[platform];return platformSpec?.architectures?.[arch]||platformSpec;}
function normalizeArch(value){const normalized=String(value||'').trim().toLowerCase();if(['x64','amd64','x86_64'].includes(normalized))return'x64';if(['arm64','aarch64'].includes(normalized))return'arm64';throw new Error(`Unsupported tunnel-client architecture: ${normalized||'(empty)'}`);}
function findExtractedExecutable(root,fileName){const stack=[root];while(stack.length){const current=stack.pop();for(const entry of fs.readdirSync(current,{withFileTypes:true})){const target=path.join(current,entry.name);if(entry.isDirectory())stack.push(target);else if(entry.isFile()&&entry.name===fileName)return target;}}throw new Error(`Downloaded archive did not contain ${fileName}.`);}
function verifyBuffer(data,expectedHash,expectedSize,label){if(expectedSize!==undefined&&data.length!==expectedSize)throw new Error(`${label} size mismatch: expected ${expectedSize}, got ${data.length}.`);const hash=crypto.createHash('sha256').update(data).digest('hex');if(hash!==expectedHash)throw new Error(`${label} SHA-256 mismatch: expected ${expectedHash}, got ${hash}.`);}
function psQuote(value){return String(value).replaceAll("'","''");}
