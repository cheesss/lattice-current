#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile, verifySeedKey } from './_seed-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const seedScripts = [
  'seed-market-quotes.mjs',
  'seed-commodity-quotes.mjs',
  'seed-crypto-quotes.mjs',
  'seed-service-statuses.mjs',
  'seed-earthquakes.mjs',
  'seed-insights.mjs',
  'seed-climate-anomalies.mjs',
  'seed-unrest-events.mjs',
  'seed-iran-events.mjs',
  'seed-ucdp-events.mjs',
  'seed-etf-flows.mjs',
  'seed-wb-indicators.mjs',
];

const fallbackKeys = {
  marketQuotes: 'market:stocks-bootstrap:v1',
  commodityQuotes: 'market:commodities-bootstrap:v1',
  sectors: 'market:sectors:v1',
  serviceStatuses: 'infra:service-statuses:v1',
  insights: 'news:insights:v1',
  earthquakes: 'seismology:earthquakes:v1',
  etfFlows: 'market:etf-flows:v1',
  macroSignals: 'economic:macro-signals:v1',
  unrestEvents: 'unrest:events:v1',
  iranEvents: 'conflict:iran-events:v1',
  ucdpEvents: 'conflict:ucdp-events:v1',
};

function runSeed(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', scriptName)], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with ${code}`));
    });
  });
}

async function refreshFallbackSnapshot() {
  const data = {};
  for (const [name, cacheKey] of Object.entries(fallbackKeys)) {
    // eslint-disable-next-line no-await-in-loop
    const payload = await verifySeedKey(cacheKey);
    if (payload !== null && payload !== undefined) data[name] = payload;
  }

  const fallbackPath = path.join(repoRoot, 'public', 'data', 'bootstrap-fallback.json');
  await mkdir(path.dirname(fallbackPath), { recursive: true });
  await writeFile(fallbackPath, JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'seed-bootstrap',
      keyCount: Object.keys(data).length,
    },
    data,
  }, null, 2));
}

loadEnvFile(import.meta.url);

for (const scriptName of seedScripts) {
  // eslint-disable-next-line no-await-in-loop
  await runSeed(scriptName);
}

await refreshFallbackSnapshot();

console.log('[seed-bootstrap] completed');
