#!/usr/bin/env bash
# E2E Test Runner for Lattice Current
# Builds TypeScript to JS, fixes ESM imports, and runs E2E pipeline tests.
#
# Usage: bash scripts/run-e2e-tests.sh

set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR="/tmp/test-build"
echo "=== Step 1: TypeScript build ==="
npx tsc --project tsconfig.test.json
echo "Build complete → $BUILD_DIR"

echo "=== Step 2: Fix ESM imports (@/ aliases, .js extensions, JSON assertions) ==="
node -e "
const { readdir, readFile, writeFile, stat } = require('node:fs/promises');
const { join, dirname, relative } = require('node:path');

const root = '$BUILD_DIR';
const srcRoot = join(root, 'src');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith('.js')) await fixFile(full);
  }
}

async function fileExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function resolveSpec(spec, filePath) {
  let resolved = spec;
  if (resolved.startsWith('@/')) {
    const target = join(srcRoot, resolved.slice(2));
    resolved = relative(dirname(filePath), target);
    if (!resolved.startsWith('.')) resolved = './' + resolved;
  }
  if (!resolved.startsWith('.')) return resolved;
  const absBase = join(dirname(filePath), resolved);
  if (resolved.endsWith('.js') || resolved.endsWith('.json')) return resolved;
  if (await fileExists(absBase + '.js')) return resolved + '.js';
  if (await fileExists(absBase + '/index.js')) return resolved + '/index.js';
  return resolved + '.js';
}

async function fixFile(filePath) {
  let content = await readFile(filePath, 'utf8');
  const replacements = [];
  for (const pattern of [/from\\s+['\"]([^'\"]+)['\"]/g, /import\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)/g]) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const s = m[1];
      if (s.startsWith('.') || s.startsWith('@/')) {
        const r = await resolveSpec(s, filePath);
        if (r !== s) replacements.push({ from: s, to: r });
      }
    }
  }
  for (const { from, to } of replacements) {
    content = content.split(\"'\" + from + \"'\").join(\"'\" + to + \"'\");
    content = content.split('\"' + from + '\"').join('\"' + to + '\"');
  }
  // Add JSON import assertions
  content = content.replace(/from\\s+(['\"][^'\"]+\\.json['\"])\\s*;/g, (match, spec) => {
    if (match.includes('with')) return match;
    return 'from ' + spec + ' with { type: \"json\" };';
  });
  await writeFile(filePath, content);
}

walk(root).then(() => console.log('Import fixes complete'));
"

# Ensure package.json and node_modules symlink exist
echo '{"type":"module"}' > "$BUILD_DIR/package.json"
ln -sf "$(pwd)/node_modules" "$BUILD_DIR/node_modules" 2>/dev/null || true

echo "=== Step 3: Run E2E tests ==="
cd "$BUILD_DIR"
node --test "$(cd - > /dev/null && pwd)/tests/fix6-e2e-pipeline.test.mjs"
