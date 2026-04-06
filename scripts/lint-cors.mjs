#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiDir = path.join(repoRoot, 'api');
const corsPath = path.join(repoRoot, 'server', 'cors.ts');

async function walk(dir, output = []) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      await walk(full, output);
    } else if (entry.endsWith('.js') && !entry.startsWith('_')) {
      output.push(full);
    }
  }
  return output;
}

let corsSource;
try {
  corsSource = await readFile(corsPath, 'utf8');
} catch (err) {
  console.error(`[cors-lint] Cannot read ${corsPath}: ${err.message}`);
  process.exit(1);
}
const requiredCorsBits = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'isDisallowedOrigin',
  'getCorsHeaders',
];

for (const bit of requiredCorsBits) {
  if (!corsSource.includes(bit)) {
    console.error(`[cors-lint] server/cors.ts missing ${bit}`);
    process.exit(1);
  }
}

let apiFiles;
try {
  apiFiles = await walk(apiDir);
} catch (err) {
  console.error(`[cors-lint] Cannot scan ${apiDir}: ${err.message}`);
  process.exit(1);
}
const SAME_ORIGIN_ONLY = new Set([
  'api/download.js',
  'api/fwdstart.js',
  'api/geo.js',
  'api/og-story.js',
  'api/story.js',
  'api/youtube/embed.js',
]);
const offenders = [];
for (const file of apiFiles) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
  if (SAME_ORIGIN_ONLY.has(relative)) {
    continue;
  }
  const hasCors =
    source.includes('getCorsHeaders')
    || source.includes('Access-Control-Allow-Origin')
    || source.includes('createRelayHandler');
  const hasOptions =
    source.includes("'OPTIONS'")
    || source.includes('"OPTIONS"')
    || source.includes('createRelayHandler')
    || source.includes('Access-Control-Allow-Origin');
  if (!hasCors || !hasOptions) offenders.push(relative);
}

if (offenders.length > 0) {
  console.error('[cors-lint] API handlers missing explicit CORS handling:');
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log(`[cors-lint] OK (${apiFiles.length} api handlers checked)`);
