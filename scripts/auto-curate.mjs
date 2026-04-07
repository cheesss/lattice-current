#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { createLogger } from './_shared/structured-logger.mjs';
import { checkKillSwitch, checkBudget, consumeBudget } from './_shared/automation-budget.mjs';
import { logAutomationAction } from './_shared/automation-audit.mjs';
import { ensureAutomationSchema } from './_shared/schema-automation.mjs';
import { ensureCodexProposalSchema } from './_shared/schema-proposals.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { collectAutoCurateContext } from './_shared/auto-curate-support.mjs';
import { proposeBackfillActions } from '../src/services/server/codex-dataset-proposer.ts';

loadOptionalEnvFile();

const logger = createLogger('auto-curate');
const { Client } = pg;

export async function runAutoCurate() {
  checkKillSwitch();
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureAutomationSchema(client);
    await ensureCodexProposalSchema(client);
    await ensureEmergingTechSchema(client);

    const codexBudget = await checkBudget(client, 'codexCalls', 1);
    if (!codexBudget.allowed) {
      await logAutomationAction(client, {
        type: 'auto-curate',
        params: {},
        result: 'skipped',
        reason: codexBudget.reason,
      });
      return { ok: true, skipped: true, reason: codexBudget.reason };
    }

    const context = await collectAutoCurateContext(client);
    logger.info('auto-curate context prepared', {
      weakAreas: context.weakAreas,
      totalArticles: context.stats.totalArticles,
      recentTopics: context.stats.recentTopics,
    });
    const plan = await proposeBackfillActions(context);
    await consumeBudget(client, 'codexCalls', 1, {
      purpose: 'auto-curate',
      actionCount: plan.actions.length,
    });

    let inserted = 0;
    for (const action of plan.actions || []) {
      const result = await client.query(
        `
          INSERT INTO codex_proposals (proposal_type, payload, status, reasoning, source)
          VALUES ($1, $2, 'pending', $3, 'auto-curate')
          RETURNING id
        `,
        [action.type, JSON.stringify(action), action.reason || plan.diagnosis || null],
      );
      inserted += Number(result.rowCount || 0);
    }

    await logAutomationAction(client, {
      type: 'auto-curate',
      params: {
        diagnosis: plan.diagnosis,
        actions: plan.actions,
      },
      result: 'success',
      reason: `queued ${inserted} proposals`,
    });

    return {
      ok: true,
      proposalsAdded: inserted,
      diagnosis: plan.diagnosis,
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
  runAutoCurate()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      logger.error('auto-curate failed', {
        error: String(error?.message || error),
      });
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
