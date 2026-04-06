#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const patterns = [/console\.log\s*\(/, /console\.debug\s*\(/, /console\.info\s*\(/, /\bdebugger\b/];

async function collectReferencedBuildFiles() {
  const entryFiles = ['index.html', 'backtest-hub.html', 'settings.html', 'live-channels.html', 'sw.js'];
  const files = new Set();

  for (const entry of entryFiles) {
    const full = path.join(distDir, entry);
    try {
      await stat(full);
    } catch {
      continue;
    }
    files.add(full);
    const source = await readFile(full, 'utf8');
    for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const target = match[1];
      if (!target.startsWith('/assets/') && !target.startsWith('/workbox-') && !target.startsWith('/mapbox-gl-rtl-text.min.js')) {
        continue;
      }
      files.add(path.join(distDir, target.replace(/^\//, '')));
    }
  }

  return Array.from(files).filter((file) => /\.(html|js|mjs|css)$/.test(file));
}

const files = await collectReferencedBuildFiles();
const offenders = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (patterns.some((pattern) => pattern.test(source))) {
    offenders.push(path.relative(repoRoot, file));
  }
}

if (offenders.length > 0) {
  console.error('[build-console] console.log/debug still present in build output:');
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log('[build-console] OK');
