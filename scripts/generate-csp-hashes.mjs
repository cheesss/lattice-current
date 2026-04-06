#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexHtmlPath = path.join(repoRoot, 'index.html');

let CSP_SCRIPT_HASHES;
try {
  ({ CSP_SCRIPT_HASHES } = await import('../src/config/security-headers.ts'));
} catch (err) {
  console.error(`[csp-hashes] Failed to import security-headers.ts: ${err.message}`);
  console.error('  Ensure tsx or --experimental-strip-types is available');
  process.exit(1);
}

function normalizeInlineScript(source) {
  return source.replace(/^\s+|\s+$/g, '');
}

function sha256Base64(value) {
  return `sha256-${crypto.createHash('sha256').update(value).digest('base64')}`;
}

let html;
try {
  html = await readFile(indexHtmlPath, 'utf8');
} catch (err) {
  console.error(`[csp-hashes] Cannot read ${indexHtmlPath}: ${err.message}`);
  process.exit(1);
}

// Match inline scripts, including those with attributes (type="module", etc.)
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => normalizeInlineScript(match[1]))
  .filter((source) => source.length > 0);

const hashes = inlineScripts.map(sha256Base64);

if (process.argv.includes('--check')) {
  const missing = hashes.filter((hash) => !CSP_SCRIPT_HASHES.includes(hash));
  const extra = CSP_SCRIPT_HASHES.filter((hash) => !hashes.includes(hash));
  if (missing.length || extra.length) {
    console.error('[csp-hashes] Mismatch detected');
    if (missing.length) console.error(`Missing in config: ${missing.join(', ')}`);
    if (extra.length) console.error(`Extra in config: ${extra.join(', ')}`);
    process.exit(1);
  }
  console.log(`[csp-hashes] OK (${hashes.length} inline script hashes)`);
} else {
  console.log(JSON.stringify(hashes, null, 2));
}

