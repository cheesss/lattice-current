import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, '..');

export function repoPath(...segments) {
  return resolve(repoRoot, ...segments);
}

export function srcModuleUrl(relativePath) {
  return pathToFileURL(repoPath('src', ...relativePath.split('/'))).href;
}

export function serverModuleUrl(relativePath) {
  return pathToFileURL(repoPath('server', ...relativePath.split('/'))).href;
}
