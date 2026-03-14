import { spawn, spawnSync } from 'node:child_process';

function buildSpawnEnv(extraEnv = {}) {
  const merged = { ...process.env, ...extraEnv };
  const env = {};
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'string') continue;
    // Windows has pseudo env keys like "=C:" which break spawn() when passed explicitly.
    if (process.platform === 'win32' && key.startsWith('=')) continue;
    env[key] = value;
  }
  return env;
}

function runNpm(args, extraEnv = {}) {
  const npmCommand = ['npm', ...args].join(' ');
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, {
      stdio: 'inherit',
      shell: true,
      env: buildSpawnEnv(extraEnv),
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} failed with code ${code ?? -1}`));
    });
  });
}

function assertCargoAvailable() {
  const probeCommand = process.platform === 'win32' ? 'where cargo' : 'command -v cargo';
  const probe = spawnSync(probeCommand, {
    shell: true,
    env: buildSpawnEnv(),
    stdio: 'ignore',
  });
  if (probe.status !== 0) {
    throw new Error(
      '[desktop:dev] cargo not found. Install Rust (rustup) and reopen your terminal.'
    );
  }
}

assertCargoAvailable();
await runNpm(['run', 'version:sync']);
await runNpm(['run', 'tauri', '--', 'dev', '-f', 'devtools'], { VITE_DESKTOP_RUNTIME: '1' });
