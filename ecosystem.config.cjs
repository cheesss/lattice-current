module.exports = {
  apps: [
    {
      name: 'lattice-master-daemon',
      script: 'scripts/master-daemon.mjs',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '512M',
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
