import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = path.resolve('C:/Users/chohj/Documents/Playground/lattice-current-fix');

test('event-dashboard-api import does not bind the standalone port', async () => {
  const dashboardModuleUrl = pathToFileURL(path.join(workspace, 'scripts', 'event-dashboard-api.mjs')).href;
  const script = `
    import net from 'node:net';
    await import(${JSON.stringify(dashboardModuleUrl)});

    const server = net.createServer();
    server.once('error', (error) => {
      console.error(error && error.code ? error.code : String(error));
      process.exit(1);
    });
    server.listen(46200, '127.0.0.1', () => {
      server.close(() => process.exit(0));
    });
  `;

  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 0, `import should not bind port 46200, stderr: ${stderr}`);
});
