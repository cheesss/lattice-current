#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const tauriConf = JSON.parse(await readFile(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const cargoToml = await readFile(path.join(repoRoot, 'src-tauri', 'Cargo.toml'), 'utf8');
const changelog = await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

const packageVersion = packageJson.version;
const tauriVersion = tauriConf.version;
const cargoVersion = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
const changelogVersion = changelog.match(/^## \[([^\]]+)\]/m)?.[1] ?? null;

const mismatches = [
  ['package.json', packageVersion],
  ['src-tauri/tauri.conf.json', tauriVersion],
  ['src-tauri/Cargo.toml', cargoVersion],
  ['CHANGELOG.md', changelogVersion],
].filter(([, version]) => version !== packageVersion);

if (mismatches.length > 0) {
  console.error(`[version-sync] package.json version is ${packageVersion}`);
  for (const [name, version] of mismatches) {
    console.error(`- ${name}: ${version ?? 'missing'}`);
  }
  process.exit(1);
}

console.log(`[version-sync] OK (${packageVersion})`);

