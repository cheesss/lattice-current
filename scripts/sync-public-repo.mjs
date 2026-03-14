#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_TARGET = path.resolve(process.cwd(), '..', 'worldmonitor-public');

const EXCLUDED_ROOT_DIRS = new Set([
  '.git',
  '.agent',
  '.agents',
  '.claude',
  '.cursor',
  '.factory',
  '.planning',
  '.playwright-mcp',
  '.vercel',
  '.windsurf',
  '.wrangler',
  'certs',
  'dist',
  'ideas',
  'internal',
  'node_modules',
  'skills',
  'test-results',
  'tmp'
]);

const EXCLUDED_ROOT_PREFIXES = ['tmp_'];

const EXCLUDED_PATH_PREFIXES = [
  'data/historical/',
  'docs/internal/',
  'playwright-report/',
  'scripts/data/',
  'site/.vitepress/cache/',
  'site/.vitepress/dist/',
  'site/.vitepress/.temp/',
  'src-tauri/sidecar/node/',
  'third_party/'
];

const EXCLUDED_FILES = new Set([
  '.env',
  '.env.local',
  '.env.vercel-backup',
  '.env.vercel-export',
  'CLAUDE.md',
  'api-cache.json',
  'skills-lock.json',
  'verbose-mode.json'
]);

const EXCLUDED_RELATIVE_PATHS = new Set([
  'scripts/data/iran-events-latest.json',
  'scripts/rebuild-military-bases.mjs'
]);

const EXCLUDED_PATTERNS = [
  /^\.env\..+/i,
  /^upath-.*\.tgz$/i,
  /\.docx$/i,
  /\.log$/i
];

function parseArgs(argv) {
  const options = {
    source: process.cwd(),
    target: DEFAULT_TARGET,
    dryRun: false,
    verbose: false,
    delete: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') {
      options.dryRun = true;
    } else if (value === '--verbose') {
      options.verbose = true;
    } else if (value === '--no-delete') {
      options.delete = false;
    } else if (value === '--source') {
      options.source = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--target') {
      options.target = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function normalizeRelativePath(relativePath) {
  return relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function isExcluded(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return false;
  }

  if (EXCLUDED_RELATIVE_PATHS.has(normalized)) {
    return true;
  }

  if (EXCLUDED_PATH_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) {
    return true;
  }

  const parts = normalized.split('/');
  if (parts.includes('.git')) {
    return true;
  }

  const root = parts[0];

  if (EXCLUDED_ROOT_DIRS.has(root) || EXCLUDED_FILES.has(root)) {
    return true;
  }

  if (EXCLUDED_ROOT_PREFIXES.some((prefix) => root.startsWith(prefix))) {
    return true;
  }

  const leaf = parts[parts.length - 1];
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(leaf));
}

async function walkFiles(rootDir, currentDir = rootDir, accumulator = []) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));
    if (isExcluded(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkFiles(rootDir, absolutePath, accumulator);
      continue;
    }

    if (entry.isFile()) {
      accumulator.push(relativePath);
    }
  }
  return accumulator;
}

async function ensureDirectory(targetPath, dryRun) {
  if (dryRun) {
    return;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

async function copyFile(sourceRoot, targetRoot, relativePath, dryRun) {
  const from = path.join(sourceRoot, relativePath);
  const to = path.join(targetRoot, relativePath);
  await ensureDirectory(to, dryRun);
  if (!dryRun) {
    await fs.copyFile(from, to);
  }
}

async function collectTargetFiles(targetRoot) {
  try {
    return await walkFiles(targetRoot);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function removePath(targetRoot, relativePath, dryRun) {
  const absolutePath = path.join(targetRoot, relativePath);
  if (!dryRun) {
    await fs.rm(absolutePath, { force: true });
  }
}

async function pruneEmptyDirectories(targetRoot, currentDir = targetRoot) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const absolutePath = path.join(currentDir, entry.name);
    await pruneEmptyDirectories(targetRoot, absolutePath);
  }

  if (currentDir === targetRoot) {
    return;
  }

  const remaining = await fs.readdir(currentDir);
  if (remaining.length === 0) {
    await fs.rmdir(currentDir);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(options.source);
  const targetRoot = path.resolve(options.target);

  if (sourceRoot === targetRoot) {
    throw new Error('Source and target must be different directories.');
  }

  const sourceFiles = await walkFiles(sourceRoot);
  const sourceSet = new Set(sourceFiles);
  const targetFiles = await collectTargetFiles(targetRoot);

  let copiedCount = 0;
  let removedCount = 0;

  for (const relativePath of sourceFiles) {
    await copyFile(sourceRoot, targetRoot, relativePath, options.dryRun);
    copiedCount += 1;
    if (options.verbose) {
      console.log(`${options.dryRun ? '[dry-run] ' : ''}copy ${relativePath}`);
    }
  }

  if (options.delete) {
    for (const relativePath of targetFiles) {
      if (isExcluded(relativePath) || sourceSet.has(relativePath)) {
        continue;
      }
      await removePath(targetRoot, relativePath, options.dryRun);
      removedCount += 1;
      if (options.verbose) {
        console.log(`${options.dryRun ? '[dry-run] ' : ''}remove ${relativePath}`);
      }
    }
  }

  if (!options.dryRun) {
    await pruneEmptyDirectories(targetRoot);
  }

  console.log(
    JSON.stringify(
      {
        sourceRoot,
        targetRoot,
        fileCount: sourceFiles.length,
        copiedCount,
        removedCount,
        dryRun: options.dryRun,
        deleteMissing: options.delete
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
