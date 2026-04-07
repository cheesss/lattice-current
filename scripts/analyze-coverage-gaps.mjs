#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureCodexProposalSchema } from './_shared/schema-proposals.mjs';

loadOptionalEnvFile();

const { Client } = pg;

export async function analyzeCoverageGaps() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureCodexProposalSchema(client);
    const [allSignals, usedSignals] = await Promise.all([
      client.query(`SELECT DISTINCT signal_name FROM signal_history ORDER BY signal_name`),
      client.query(`
        SELECT DISTINCT condition_type
        FROM conditional_sensitivity
        WHERE condition_type LIKE 'signal_%'
      `),
    ]);

    const used = new Set(usedSignals.rows.map((row) => String(row.condition_type || '').replace(/^signal_/, '')));
    const candidates = [];
    for (const row of allSignals.rows) {
      const signalName = String(row.signal_name || '');
      if (!signalName || used.has(signalName)) continue;
      // eslint-disable-next-line no-await-in-loop
      const points = await client.query(`
        SELECT COUNT(*)::int AS n, MIN(ts) AS oldest, MAX(ts) AS newest
        FROM signal_history
        WHERE signal_name = $1
      `, [signalName]);
      const count = Number(points.rows[0]?.n || 0);
      if (count < 100) continue;
      candidates.push({
        signalName,
        dataPoints: count,
        oldest: points.rows[0]?.oldest || null,
        newest: points.rows[0]?.newest || null,
      });
    }

    let proposalsAdded = 0;
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const result = await client.query(`
        INSERT INTO codex_proposals (proposal_type, payload, status, reasoning, source)
        VALUES ('add-conditional-sensitivity', $1, 'pending', $2, 'coverage-gap-analysis')
        RETURNING id
      `, [
        JSON.stringify({
          signalName: candidate.signalName,
          binMethod: 'quantile',
        }),
        `signal ${candidate.signalName} has ${candidate.dataPoints} data points but no conditional sensitivity rows`,
      ]);
      proposalsAdded += Number(result.rowCount || 0);
    }

    return {
      totalSignals: allSignals.rows.length,
      usedSignals: usedSignals.rows.length,
      unusedButReady: candidates,
      proposalsAdded,
    };
  } finally {
    await client.end();
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
  analyzeCoverageGaps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
