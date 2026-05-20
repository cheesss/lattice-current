#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  runGenericKpiCollectionCycle,
  ensureKpiThemeCoverage,
  loadThemeKpiCollectionState,
} from './_shared/generic-kpi-collection.mjs';

const { Client } = pg;

function readArg(argv, name) {
  const prefix = `--${name}=`;
  const eq = argv.find((arg) => arg.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  return next && !next.startsWith('--') ? next : true;
}

export function parseGenericKpiArgs(argv = process.argv.slice(2)) {
  const theme = readArg(argv, 'theme');
  const themes = theme
    ? String(theme).split(',').map((item) => item.trim()).filter(Boolean)
    : undefined;
  return {
    mode: readArg(argv, 'mode') || 'cycle',
    themes,
    limit: readArg(argv, 'limit'),
    materializeLimit: readArg(argv, 'materialize-limit'),
    jobLimit: readArg(argv, 'job-limit'),
  };
}

export async function runGenericKpiCli(options = {}) {
  loadOptionalEnvFile();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    if (options.mode === 'state') {
      const themeId = options.themes?.[0];
      if (!themeId) return { ok: false, reason: '--theme is required for --mode=state' };
      return {
        ok: true,
        state: await loadThemeKpiCollectionState(client, { themeId, key: themeId, themeLabel: themeId }),
      };
    }
    if (options.mode === 'theme') {
      const themeId = options.themes?.[0];
      if (!themeId) return { ok: false, reason: '--theme is required for --mode=theme' };
      return await ensureKpiThemeCoverage(client, { themeId, themeLabel: themeId }, options);
    }
    return await runGenericKpiCollectionCycle(client, options);
  } finally {
    if (ownClient) await client.end().catch(() => {});
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runGenericKpiCli(parseGenericKpiArgs())
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
