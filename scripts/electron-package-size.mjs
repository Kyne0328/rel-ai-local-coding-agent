import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = parseArguments(args);

try {
  const report = buildPackageSizeReport(options);
  printReport(report);
  if (options.jsonPath) {
    const outputPath = path.resolve(root, options.jsonPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Package-size report written to ${path.relative(root, outputPath) || outputPath}.`);
  }
  if (report.warnings.length && options.strict && !options.warnOnly) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(input) {
  const valueAfter = (name, fallback = '') => {
    const index = input.indexOf(name);
    return index >= 0 ? String(input[index + 1] || fallback) : fallback;
  };
  return {
    distDir: valueAfter('--dir', 'dist'),
    baselinePath: valueAfter('--baseline', ''),
    jsonPath: valueAfter('--json', ''),
    strict: input.includes('--strict'),
    warnOnly: input.includes('--warn-only')
  };
}

function buildPackageSizeReport(options) {
  const distDir = path.resolve(root, options.distDir);
  const packageJson = readJson(path.join(root, 'package.json'));
  const version = String(packageJson.version || '').trim();
  const unpackedDir = path.join(distDir, 'win-unpacked');
  const resourcesDir = path.join(unpackedDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  requireDirectory(unpackedDir, 'Packaged win-unpacked directory');
  requireDirectory(resourcesDir, 'Packaged resources directory');
  requireFile(asarPath, 'Packaged app.asar');

  const topLevelFiles = fs.readdirSync(distDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(distDir, entry.name));
  const installerPath = findArtifact(topLevelFiles, `Rel.AI MCP Setup ${version}.exe`, file => /setup.*\.exe$/i.test(path.basename(file)));
  const portablePath = findArtifact(topLevelFiles, `Rel.AI MCP ${version}.exe`, file => /\.exe$/i.test(file) && !/setup/i.test(path.basename(file)));
  requireFile(installerPath, 'NSIS installer');
  requireFile(portablePath, 'Portable executable');

  const localeDir = path.join(unpackedDir, 'locales');
  const localeFiles = listFiles(localeDir);
  const sourceCssFiles = listFiles(path.join(resourcesDir, 'src')).filter(file => file.toLowerCase().endsWith('.css'));
  const asar = inspectAsar(asarPath);
  const allUnpackedFiles = listFiles(unpackedDir);
  const metrics = {
    installerBytes: fileSize(installerPath),
    portableBytes: fileSize(portablePath),
    unpackedBytes: sumFileSizes(allUnpackedFiles),
    resourcesBytes: sumFileSizes(listFiles(resourcesDir)),
    appAsarBytes: fileSize(asarPath),
    packagedDependencyBytes: asar.nodeModulesBytes,
    localesBytes: sumFileSizes(localeFiles),
    ngrokBytes: fileSize(path.join(resourcesDir, 'bin', 'ngrok', 'win32', 'ngrok.exe')),
    dashboardCssBytes: fileSize(path.join(resourcesDir, 'public', 'dashboard.css'))
  };
  const content = {
    localeCount: localeFiles.length,
    locales: localeFiles.map(file => path.basename(file)).sort(),
    sourceCssCount: sourceCssFiles.length,
    sourceCssFiles: sourceCssFiles.map(file => relativeTo(resourcesDir, file)),
    asarSourceMapCount: asar.sourceMapCount,
    asarSourceMapBytes: asar.sourceMapBytes,
    largestFiles: allUnpackedFiles
      .map(file => ({ path: relativeTo(unpackedDir, file), bytes: fileSize(file) }))
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 20)
  };

  const baseline = options.baselinePath ? readBaseline(path.resolve(root, options.baselinePath)) : null;
  const comparison = compareMetrics(metrics, baseline);
  const warnings = [];
  if (content.localeCount !== 1 || content.locales[0] !== 'en-US.pak') {
    warnings.push(`Expected only en-US.pak, found: ${content.locales.join(', ') || 'none'}.`);
  }
  const allowedSourceCssFiles = new Set(['src/ui/styles/app.css']);
  const unexpectedSourceCssFiles = content.sourceCssFiles.filter(file => !allowedSourceCssFiles.has(file));
  if (unexpectedSourceCssFiles.length > 0) {
    warnings.push(`Unexpected source CSS is packaged: ${unexpectedSourceCssFiles.join(', ')}.`);
  }
  if (content.asarSourceMapCount > 0) warnings.push(`app.asar contains ${content.asarSourceMapCount} source map files.`);
  for (const item of comparison) {
    if (item.exceedsWarningThreshold) {
      warnings.push(`${item.metric} is ${item.deltaPercent.toFixed(2)}% above the recorded optimized baseline.`);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version,
    platform: process.platform,
    architecture: process.arch,
    distDir: relativeTo(root, distDir),
    metrics,
    content,
    baseline: baseline ? {
      path: relativeTo(root, path.resolve(root, options.baselinePath)),
      capturedAt: baseline.capturedAt,
      warningThresholdPercent: baseline.warningThresholdPercent
    } : null,
    comparison,
    warnings
  };
}

function inspectAsar(asarPath) {
  const require = createRequire(import.meta.url);
  const asarModulePath = require.resolve('@electron/asar', { paths: [path.join(root, 'electron')] });
  const asar = require(asarModulePath);
  const entries = asar.listPackage(asarPath);
  let nodeModulesBytes = 0;
  let sourceMapBytes = 0;
  let sourceMapCount = 0;
  for (const entry of entries) {
    const archivePath = String(entry).replace(/^[/\\]+/, '');
    const normalized = archivePath.replaceAll('\\', '/');
    let stat;
    try {
      stat = asar.statFile(asarPath, archivePath, false);
    } catch {
      continue;
    }
    if (!Number.isFinite(stat?.size)) continue;
    if (normalized.startsWith('node_modules/')) nodeModulesBytes += stat.size;
    if (normalized.toLowerCase().endsWith('.map')) {
      sourceMapCount += 1;
      sourceMapBytes += stat.size;
    }
  }
  return { nodeModulesBytes, sourceMapCount, sourceMapBytes };
}

function readBaseline(file) {
  requireFile(file, 'Package-size baseline');
  const baseline = readJson(file);
  if (!baseline.metrics || typeof baseline.metrics !== 'object') throw new Error(`Package-size baseline has no metrics object: ${file}`);
  return baseline;
}

function compareMetrics(metrics, baseline) {
  if (!baseline) return [];
  const threshold = Number(baseline.warningThresholdPercent || 0);
  return Object.entries(baseline.metrics).flatMap(([metric, baselineBytes]) => {
    const currentBytes = metrics[metric];
    if (!Number.isFinite(currentBytes) || !Number.isFinite(baselineBytes)) return [];
    const deltaBytes = currentBytes - baselineBytes;
    const deltaPercent = baselineBytes === 0 ? 0 : (deltaBytes / baselineBytes) * 100;
    return [{
      metric,
      baselineBytes,
      currentBytes,
      deltaBytes,
      deltaPercent,
      exceedsWarningThreshold: deltaPercent > threshold
    }];
  });
}

function printReport(report) {
  console.log(`Electron package-size report for Rel.AI MCP ${report.version}`);
  for (const [metric, bytes] of Object.entries(report.metrics)) {
    console.log(`  ${metric.padEnd(26)} ${formatBytes(bytes)} (${bytes} bytes)`);
  }
  console.log(`  locales                    ${report.content.localeCount}: ${report.content.locales.join(', ') || 'none'}`);
  console.log(`  ASAR source maps           ${report.content.asarSourceMapCount}`);
  console.log(`  packaged source CSS        ${report.content.sourceCssCount}`);
  if (report.comparison.length) {
    console.log('Baseline comparison:');
    for (const item of report.comparison) {
      const sign = item.deltaBytes > 0 ? '+' : '';
      console.log(`  ${item.metric.padEnd(26)} ${sign}${formatBytes(item.deltaBytes)} (${sign}${item.deltaPercent.toFixed(2)}%)`);
    }
  }
  if (report.warnings.length) {
    console.warn('Package-size warnings:');
    for (const warning of report.warnings) console.warn(`  - ${warning}`);
  } else {
    console.log('Package-size checks passed without warnings.');
  }
}

function findArtifact(files, exactName, fallback) {
  return files.find(file => path.basename(file) === exactName) || files.find(fallback) || '';
}

function listFiles(start) {
  if (!fs.existsSync(start)) return [];
  const files = [];
  const pending = [start];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function sumFileSizes(files) {
  return files.reduce((total, file) => total + fileSize(file), 0);
}

function fileSize(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.statSync(file).size : 0;
}

function requireFile(file, label) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} is missing: ${file || '(not found)'}`);
}

function requireDirectory(dir, label) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${label} is missing: ${dir}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relativeTo(base, target) {
  return path.relative(base, target).replaceAll(path.sep, '/');
}

function formatBytes(bytes) {
  const absolute = Math.abs(Number(bytes || 0));
  const sign = Number(bytes) < 0 ? '-' : '';
  if (absolute >= 1024 ** 3) return `${sign}${(absolute / 1024 ** 3).toFixed(2)} GiB`;
  if (absolute >= 1024 ** 2) return `${sign}${(absolute / 1024 ** 2).toFixed(2)} MiB`;
  if (absolute >= 1024) return `${sign}${(absolute / 1024).toFixed(2)} KiB`;
  return `${sign}${absolute} B`;
}
