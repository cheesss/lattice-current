#!/usr/bin/env node
/**
 * save-backtest-to-nas.mjs — Walk-forward 결과를 NAS PostgreSQL에 저장
 *
 * Usage:
 *   node --import tsx scripts/save-backtest-to-nas.mjs --result .tmp-wf-result.json
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

function parseArgs() {
  const args = process.argv.slice(2);
  let resultFile = '.tmp-wf-result.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--result' && args[i + 1]) resultFile = args[++i];
  }
  return { resultFile };
}

async function main() {
  const { resultFile } = parseArgs();
  console.log(`Loading results from ${resultFile}...`);
  const raw = JSON.parse(readFileSync(resultFile, 'utf-8'));
  const run = raw.run;

  if (!run) { console.error('No "run" field in result file'); process.exit(1); }

  const client = new Client(PG_CONFIG);
  await client.connect();

  // Recreate tables with correct schema (existing tables are empty)
  await client.query('DROP TABLE IF EXISTS worldmonitor_intel.forward_returns CASCADE');
  await client.query('DROP TABLE IF EXISTS worldmonitor_intel.idea_runs CASCADE');
  await client.query(`
    CREATE TABLE IF NOT EXISTS worldmonitor_intel.idea_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      frame_id TEXT,
      generated_at TIMESTAMPTZ,
      title TEXT,
      theme_id TEXT,
      direction TEXT,
      conviction DOUBLE PRECISION,
      false_positive_risk DOUBLE PRECISION,
      size_pct DOUBLE PRECISION,
      calibrated_confidence DOUBLE PRECISION,
      reality_score DOUBLE PRECISION,
      confirmation_score DOUBLE PRECISION,
      meta_hit_probability DOUBLE PRECISION,
      meta_expected_return_pct DOUBLE PRECISION,
      meta_decision_score DOUBLE PRECISION,
      admission_state TEXT,
      continuous_conviction DOUBLE PRECISION,
      cluster_confidence DOUBLE PRECISION,
      market_stress_prior DOUBLE PRECISION,
      transmission_stress DOUBLE PRECISION,
      properties JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS worldmonitor_intel.forward_returns (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      idea_run_id TEXT,
      symbol TEXT,
      direction TEXT,
      horizon_hours INTEGER,
      entry_timestamp TIMESTAMPTZ,
      exit_timestamp TIMESTAMPTZ,
      entry_price DOUBLE PRECISION,
      exit_price DOUBLE PRECISION,
      raw_return_pct DOUBLE PRECISION,
      signed_return_pct DOUBLE PRECISION,
      cost_adjusted_signed_return_pct DOUBLE PRECISION,
      max_drawdown_pct DOUBLE PRECISION,
      exit_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS worldmonitor_intel.backtest_runs (
      id TEXT PRIMARY KEY,
      label TEXT,
      mode TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      frame_count INTEGER,
      idea_count INTEGER,
      forward_return_count INTEGER,
      cagr_pct DOUBLE PRECISION,
      sharpe_ratio DOUBLE PRECISION,
      total_return_pct DOUBLE PRECISION,
      max_drawdown_pct DOUBLE PRECISION,
      avg_cash_pct DOUBLE PRECISION,
      trade_count INTEGER,
      governance JSONB,
      summary_lines TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Save backtest_runs summary (uses existing schema: backtest_run_id, summary JSONB)
  const s = run.portfolioAccounting?.summary || {};
  const summaryBlob = {
    ...s,
    ideaCount: run.ideaRuns?.length || 0,
    forwardReturnCount: run.forwardReturns?.length || 0,
    governance: run.governance || null,
    summaryLines: run.summaryLines || [],
    acceptedCount: (run.ideaRuns || []).filter(i => i.admissionState === 'accepted').length,
    watchCount: (run.ideaRuns || []).filter(i => i.admissionState === 'watch').length,
  };
  await client.query(`
    INSERT INTO worldmonitor_intel.backtest_runs (backtest_run_id, label, mode, started_at, completed_at, frame_count, warmup_frame_count, evaluation_frame_count, summary, windows)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (backtest_run_id) DO UPDATE SET summary=EXCLUDED.summary, completed_at=EXCLUDED.completed_at
  `, [
    run.id, run.label, run.mode, run.startedAt, run.completedAt,
    run.frameCount, run.warmupFrameCount || 0, run.evaluationFrameCount || 0,
    JSON.stringify(summaryBlob),
    JSON.stringify(run.windows || []),
  ]);
  console.log(`  backtest_runs: ${run.id}`);

  // Batch insert idea_runs
  const ideaRuns = run.ideaRuns || [];
  let ideaSaved = 0;
  for (let i = 0; i < ideaRuns.length; i += 100) {
    const batch = ideaRuns.slice(i, i + 100);
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const ir of batch) {
      placeholders.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9},$${idx+10},$${idx+11},$${idx+12},$${idx+13},$${idx+14},$${idx+15},$${idx+16},$${idx+17},$${idx+18},$${idx+19})`);
      values.push(
        ir.id, ir.runId, ir.frameId, ir.generatedAt, ir.title, ir.themeId, ir.direction,
        ir.conviction, ir.falsePositiveRisk, ir.sizePct, ir.calibratedConfidence, ir.realityScore,
        ir.confirmationScore, ir.metaHitProbability, ir.metaExpectedReturnPct, ir.metaDecisionScore,
        ir.admissionState, ir.continuousConviction, ir.clusterConfidence, ir.marketStressPrior,
      );
      idx += 20;
    }
    await client.query(`
      INSERT INTO worldmonitor_intel.idea_runs (id, run_id, frame_id, generated_at, title, theme_id, direction, conviction, false_positive_risk, size_pct, calibrated_confidence, reality_score, confirmation_score, meta_hit_probability, meta_expected_return_pct, meta_decision_score, admission_state, continuous_conviction, cluster_confidence, market_stress_prior)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (id) DO NOTHING
    `, values);
    ideaSaved += batch.length;
  }
  console.log(`  idea_runs: ${ideaSaved} saved`);

  // Batch insert forward_returns
  const fwdReturns = run.forwardReturns || [];
  let fwdSaved = 0;
  for (let i = 0; i < fwdReturns.length; i += 100) {
    const batch = fwdReturns.slice(i, i + 100);
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const fr of batch) {
      placeholders.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9},$${idx+10},$${idx+11},$${idx+12},$${idx+13})`);
      values.push(
        fr.id, fr.runId, fr.ideaRunId, fr.symbol, fr.direction, fr.horizonHours,
        fr.entryTimestamp, fr.exitTimestamp, fr.entryPrice, fr.exitPrice,
        fr.rawReturnPct, fr.signedReturnPct, fr.costAdjustedSignedReturnPct, fr.exitReason,
      );
      idx += 14;
    }
    await client.query(`
      INSERT INTO worldmonitor_intel.forward_returns (id, run_id, idea_run_id, symbol, direction, horizon_hours, entry_timestamp, exit_timestamp, entry_price, exit_price, raw_return_pct, signed_return_pct, cost_adjusted_signed_return_pct, exit_reason)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (id) DO NOTHING
    `, values);
    fwdSaved += batch.length;
  }
  console.log(`  forward_returns: ${fwdSaved} saved`);

  console.log('\nDone. NAS tables updated.');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
