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
    assert.equal(source.includes("const devStackLockPath = path.join(os.tmpdir(), 'lattice-current-dev-stack.lock');"), true);
    assert.equal(source.includes('Another dev stack is already running'), true);
  });

  it('theme-shell dev launcher avoids shell:true and hides child windows', () => {
    const source = readFileSync(repoPath('scripts/dev-theme-shell.mjs'), 'utf8');
    assert.equal(source.includes('shell: true'), false);
    assert.equal(source.includes("const viteCommand = process.execPath;"), true);
    assert.equal(source.includes("const apiScript = path.join(projectRoot, 'scripts', 'event-dashboard-api.mjs');"), true);
    assert.equal(source.includes('const forwardedViteArgs = process.argv.slice(2);'), true);
    assert.equal(source.includes('const viteArgs = [viteEntry, ...forwardedViteArgs];'), true);
    assert.equal(source.includes('windowsHide: true'), true);
    assert.equal(source.includes("const devStackLockPath = path.join(os.tmpdir(), 'lattice-current-dev-stack.lock');"), true);
    assert.equal(source.includes('Another dev stack is already running'), true);
  });

  it('desktop dev launcher avoids shell:true and hides child windows', () => {
    const source = readFileSync(repoPath('scripts/desktop-dev.mjs'), 'utf8');
    assert.equal(source.includes('shell: true'), false);
    assert.equal(source.includes("const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';"), true);
    assert.equal(source.includes("const cargoProbeExecutable = process.platform === 'win32' ? 'where.exe' : 'which';"), true);
    assert.equal(source.includes('windowsHide: true'), true);
  });

  it('run-with-env avoids shell:true and resolves Windows shims directly', () => {
    const source = readFileSync(repoPath('scripts/run-with-env.mjs'), 'utf8');
    assert.equal(source.includes('shell: true'), false);
    assert.equal(source.includes('const [command, ...commandArgs] = commandTokens;'), true);
    assert.equal(source.includes('spawn(resolveWindowsCommand(command), commandArgs,'), true);
    assert.equal(source.includes("windowsHide: process.platform === 'win32'"), true);
  });

  it('chrome dev launcher shares the single dev-stack lock and disables background automation', () => {
    const source = readFileSync(repoPath('scripts/chrome-dev.mjs'), 'utf8');
    assert.equal(source.includes('shell: true'), false);
    assert.equal(source.includes("const devStackLockPath = join(os.tmpdir(), 'lattice-current-dev-stack.lock');"), true);
    assert.equal(source.includes("const npmProbeExecutable = process.platform === 'win32' ? 'where.exe' : 'which';"), true);
    assert.equal(source.includes("LOCAL_API_BACKGROUND_AUTOMATION: 'false'"), true);
    assert.equal(source.includes('another dev stack is already running'), true);
    assert.equal(source.includes("const shouldOpen = !process.argv.includes('--no-open') && !smokeTest;"), true);
    assert.equal(source.includes('windowsHide: true'), true);
  });

  it('desktop runtime lazy-starts the sidecar instead of eagerly spawning it at boot', () => {
    const source = readFileSync(repoPath('src-tauri/src/main.rs'), 'utf8');
    assert.equal(source.includes('fn ensure_local_api_started(app: AppHandle, webview: Webview) -> Result<u16, String>'), true);
    assert.equal(
      source.includes('local API sidecar lazy-start is enabled; startup defers until the renderer requests local runtime services'),
      true,
    );
    assert.equal(source.includes('if let Err(err) = start_local_api(&app.handle()) {'), false);
  });

  it('sidecar disables background automation by default for UI-driven runtime modes', () => {
    const source = readFileSync(repoPath('src-tauri/sidecar/local-api-server.mjs'), 'utf8');
    assert.equal(
      source.includes("['tauri-sidecar', 'standalone-dev', 'browser-dev'].includes(mode)"),
      true,
    );
  });

  it('sidecar background jobs hide Windows child windows', () => {
    const source = readFileSync(repoPath('src-tauri/sidecar/local-api-server.mjs'), 'utf8');
    assert.equal(source.includes("const WINDOWS_HIDE_BACKGROUND_CHILDREN = process.platform === 'win32';"), true);
    assert.ok(
      source.includes('windowsHide: WINDOWS_HIDE_BACKGROUND_CHILDREN'),
      'expected sidecar background spawns to set windowsHide',
    );
  });
});
