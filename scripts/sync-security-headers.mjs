#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const vercelPath = path.join(repoRoot, 'vercel.json');

let SECURITY_HEADERS_SOURCE, HTML_ENTRY_ROUTES, buildPermissionsPolicy, buildContentSecurityPolicy;
try {
  ({
    SECURITY_HEADERS_SOURCE,
    HTML_ENTRY_ROUTES,
    buildPermissionsPolicy,
    buildContentSecurityPolicy,
  } = await import('../src/config/security-headers.ts'));
} catch (err) {
  console.error(`[security-headers] Failed to import security-headers.ts: ${err.message}`);
  console.error('  Ensure tsx or --experimental-strip-types is available');
  process.exit(1);
}

const CHECK_ONLY = process.argv.includes('--check');

let vercel;
try {
  vercel = JSON.parse(await readFile(vercelPath, 'utf8'));
} catch (err) {
  console.error(`[security-headers] Cannot read/parse ${vercelPath}: ${err.message}`);
  process.exit(1);
}

function setHeaderRule(source, headers) {
  const index = vercel.headers.findIndex((entry) => entry.source === source);
  const payload = { source, headers };
  if (index >= 0) vercel.headers[index] = payload;
  else vercel.headers.push(payload);
}

setHeaderRule(SECURITY_HEADERS_SOURCE, [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: buildPermissionsPolicy() },
  { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() },
]);

for (const route of HTML_ENTRY_ROUTES) {
  setHeaderRule(route, [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }]);
}

const next = `${JSON.stringify(vercel, null, 2)}\n`;
if (CHECK_ONLY) {
  const current = await readFile(vercelPath, 'utf8');
  if (current !== next) {
    console.error('[security-headers] vercel.json is out of sync. Run npm run security:headers:sync');
    process.exit(1);
  }
  console.log('[security-headers] OK');
} else {
  await writeFile(vercelPath, next, 'utf8');
  console.log('[security-headers] synced vercel.json');
}

