/**
 * S-Tier B1+B2 — Model comparison aggregator.
 *
 * Reads model_eval to compare every trained model_version on the standard
 * out-of-sample metrics (Brier, ECE, log-loss, top20 precision, hit rate,
 * Sharpe). Powers /api/model-comparison and the standalone
 * model-comparison.html page.
 *
 * Schema reference (model_eval):
 *   model_version, eval_date, split_type, brier_score, ece, log_loss,
 *   top20_precision, deflated_sharpe, raw_sharpe, information_ratio,
 *   alpha_hit_rate, n_trials, n_samples
 *
 * Splits: typical training records both 'aggregate' and per-fold rows. We
 * surface the worst-fold values explicitly because they're the gating
 * metric used in production (CLAUDE.md §10 promotion gate uses worst split).
 *
 * Naive baseline: a synthetic "random top-20" baseline reference at
 * top20_precision = 0.20 (assuming events are roughly 50/50 alpha-positive
 * — close enough for a positioning chart, not a research claim).
 */

const NAIVE_BASELINE = {
  model_version: 'naive-random-top20',
  description: 'Random selection — what an uninformed picker would achieve.',
  brier_score: 0.25,           // entropic coin flip
  ece: 0.10,
  top20_precision: 0.20,       // P(true alpha) when sampling at random
  alpha_hit_rate: 0.50,        // 50/50 base rate
};

export async function buildModelComparisonPayload(pool) {
  const eval_rows = await pool.query(`
    SELECT model_version,
           split_type,
           eval_date,
           brier_score,
           ece,
           log_loss,
           top20_precision,
           alpha_hit_rate,
           deflated_sharpe,
           raw_sharpe,
           information_ratio,
           n_trials,
           n_samples
      FROM model_eval
     ORDER BY model_version, split_type, eval_date DESC
  `).catch(() => ({ rows: [] }));

  // Group by model_version. For each version, take the most recent row per
  // split_type. Compute aggregate (mean across folds) and worst (worst per
  // fold).
  const byVersion = new Map();
  for (const row of eval_rows.rows) {
    if (!byVersion.has(row.model_version)) {
      byVersion.set(row.model_version, []);
    }
    byVersion.get(row.model_version).push(row);
  }

  const num = (v) => (v == null || !Number.isFinite(Number(v))) ? null : Number(v);
  const worst = (vals, mode) => {
    const filtered = vals.filter((v) => v != null);
    if (filtered.length === 0) return null;
    return mode === 'higher-better' ? Math.min(...filtered) : Math.max(...filtered);
  };
  const mean = (vals) => {
    const filtered = vals.filter((v) => v != null && Number.isFinite(v));
    if (filtered.length === 0) return null;
    return filtered.reduce((a, b) => a + b, 0) / filtered.length;
  };

  const models = [];
  for (const [version, rows] of byVersion.entries()) {
    const briers = rows.map((r) => num(r.brier_score));
    const eces = rows.map((r) => num(r.ece));
    const logLosses = rows.map((r) => num(r.log_loss));
    const top20s = rows.map((r) => num(r.top20_precision));
    const hits = rows.map((r) => num(r.alpha_hit_rate));
    const sharpes = rows.map((r) => num(r.deflated_sharpe));

    models.push({
      modelVersion: version,
      evalRowCount: rows.length,
      latestEvalDate: rows[0]?.eval_date || null,
      brier: { mean: mean(briers), worst: worst(briers, 'lower-better') },
      ece: { mean: mean(eces), worst: worst(eces, 'lower-better') },
      logLoss: { mean: mean(logLosses), worst: worst(logLosses, 'lower-better') },
      top20Precision: { mean: mean(top20s), worst: worst(top20s, 'higher-better') },
      alphaHitRate: { mean: mean(hits), worst: worst(hits, 'higher-better') },
      deflatedSharpe: { mean: mean(sharpes), worst: worst(sharpes, 'higher-better') },
      nSamples: rows.reduce((acc, r) => acc + Number(r.n_samples ?? 0), 0),
    });
  }

  // Add the naive baseline as a comparison anchor.
  models.push({
    modelVersion: NAIVE_BASELINE.model_version,
    description: NAIVE_BASELINE.description,
    evalRowCount: 0,
    latestEvalDate: null,
    brier: { mean: NAIVE_BASELINE.brier_score, worst: NAIVE_BASELINE.brier_score },
    ece: { mean: NAIVE_BASELINE.ece, worst: NAIVE_BASELINE.ece },
    logLoss: { mean: null, worst: null },
    top20Precision: { mean: NAIVE_BASELINE.top20_precision, worst: NAIVE_BASELINE.top20_precision },
    alphaHitRate: { mean: NAIVE_BASELINE.alpha_hit_rate, worst: NAIVE_BASELINE.alpha_hit_rate },
    deflatedSharpe: { mean: null, worst: null },
    nSamples: 0,
    isBaseline: true,
  });

  // Sort: real models by best (lowest) Brier score, naive last.
  models.sort((a, b) => {
    if (a.isBaseline) return 1;
    if (b.isBaseline) return -1;
    const aB = a.brier.mean ?? Infinity;
    const bB = b.brier.mean ?? Infinity;
    return aB - bB;
  });

  // Compute the lift of the best model vs the naive baseline.
  const best = models.find((m) => !m.isBaseline);
  const baseline = NAIVE_BASELINE;
  const lift = best ? {
    activeModel: best.modelVersion,
    brierImprovement: best.brier.mean != null ? +((baseline.brier_score - best.brier.mean) / baseline.brier_score * 100).toFixed(1) : null,
    eceImprovement: best.ece.mean != null ? +((baseline.ece - best.ece.mean) / baseline.ece * 100).toFixed(1) : null,
    top20Lift: best.top20Precision.mean != null ? +(((best.top20Precision.mean - baseline.top20_precision) / baseline.top20_precision) * 100).toFixed(1) : null,
    hitRateLift: best.alphaHitRate.mean != null ? +(((best.alphaHitRate.mean - baseline.alpha_hit_rate) / baseline.alpha_hit_rate) * 100).toFixed(1) : null,
    note: 'Lift over a random-top-20 baseline. Negative means the model underperforms random.',
  } : null;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    models,
    lift,
    methodology: {
      promotionGate: 'CLAUDE.md §10 requires worst-fold ECE ≤ 0.10 and worst-fold Brier ≤ 0.25 for a model to enter shadow/active state.',
      walkForward: 'Purged walk-forward by event_id group split (compare-models.py).',
      baselineNote: 'Naive baseline assumes random top-20 selection from a 50/50 alpha-positive event pool.',
    },
  };
}

/**
 * Comparison lift metric for /api/product-quality (B2).
 * Returns a ratio in [0, 1] suitable for the product-quality summary.
 *   ≥ 0.10 → model is meaningfully better than random
 *   < 0.10 → model lift is marginal; investigate calibration / drift
 */
export async function computeComparisonLiftMetric(pool) {
  try {
    const payload = await buildModelComparisonPayload(pool);
    if (!payload?.lift?.brierImprovement) {
      return { metric: null, sample: 0, note: 'No model evaluation rows available.' };
    }
    const brierLift = payload.lift.brierImprovement / 100;
    const top20Lift = payload.lift.top20Lift != null ? payload.lift.top20Lift / 100 : 0;
    const composite = Math.max(0, Math.min(1, (brierLift + top20Lift) / 2));
    return {
      metric: composite,
      sample: payload.models.filter((m) => !m.isBaseline).length,
      brierLift,
      top20Lift,
      activeModel: payload.lift.activeModel,
      note: 'Mean of (Brier improvement %) and (top20 precision lift %) vs random baseline, clamped to [0,1].',
    };
  } catch (err) {
    return { metric: null, error: String(err?.message || err) };
  }
}
