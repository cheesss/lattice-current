import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath } from './_workspace-paths.mjs';

describe('windows spawn guardrails', () => {
  it('dev-full launcher avoids shell:true and hides child windows', () => {
    const source = readFileSync(repoPath('scripts/dev-full.mjs'), 'utf8');
    assert.equal(source.includes('shell: true'), false);
    assert.equal(source.includes("const viteCommand = process.execPath;"), true);
    assert.equal(source.includes("const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');"), true);
    assert.equal(source.includes('const forwardedViteArgs = process.argv.slice(2);'), true);
    assert.equal(source.includes('const viteArgs = [viteEntry, ...forwardedViteArgs];'), true);
    assert.equal(source.includes('windowsHide: true'), true);
  });

  it('sidecar background jobs hide Windows child windows', () => {
    const source = readFileSync(repoPath('src-tauri/sidecar/local-api-server.mjs'), 'utf8');
    assert.equal(source.includes('const WINDOWS_HIDE_BACKGROUND_CHILDREN = process.platform === \'win32\';'), true);
    assert.ok(
      source.includes('windowsHide: WINDOWS_HIDE_BACKGROUND_CHILDREN'),
      'expected sidecar background spawns to set windowsHide',
    );
  });
});
