#!/usr/bin/env node
/**
 * alpha-validation.mjs — Phase 0: 데이터에 거래 가능한 시그널이 있는지 통계적 검증
 *
 * Tests:
 *   A. Feature-outcome AUC (개별 피처의 예측력)
 *   B. Top/Bottom decile return separation (방향성 시그널)
 *   C. Embedding KNN hit rate (임베딩 예측력)
 *   D. Random baseline comparison (현재 시스템 vs 랜덤)
 *
 * Usage:
 *   node --import tsx scripts/alpha-validation.mjs
 *   node --import tsx scripts/alpha-validation.mjs --horizon 2w
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { writeFileSync } from 'fs';

loadOptionalEnvFile();

const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const HORIZON = process.argv.includes('--horizon')
  ? process.argv[process.argv.indexOf('--horizon') + 1]
  : '2w';

// ─── Statistics helpers ──────────────────────────────────────

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, arr.length - 1));
}

/** Welch's t-test (two-sample, unequal variance) */
function welchTTest(a, b) {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return { t: 0, p: 1 };
  const ma = mean(a), mb = mean(b);
  const va = a.reduce((s, x) => s + (x - ma) ** 2, 0) / (na - 1);
  const vb = b.reduce((s, x) => s + (x - mb) ** 2, 0) / (nb - 1);
  const se = Math.sqrt(va / na + vb / nb);
  if (se < 1e-12) return { t: 0, p: 1 };
  const t = (ma - mb) / se;
  // Welch-Satterthwaite degrees of freedom
  const num = (va / na + vb / nb) ** 2;
  const den = (va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1);
  const df = num / den;
  // Two-tailed p-value approximation (normal for large df)
  const p = df > 100
    ? 2 * (1 - normalCDF(Math.abs(t)))
    : 2 * tCDF(-Math.abs(t), df);
  return { t, df, p, meanDiff: ma - mb };
}

function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

/** Simple t-distribution CDF using incomplete beta (approx) */
function tCDF(t, df) {
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(df / 2, 0.5, x);
}

function incompleteBeta(a, b, x) {
  // Continued fraction approximation
  if (x < 0 || x > 1) return 0;
  if (x === 0 || x === 1) return x;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  // Lentz continued fraction
  let f = 1, c = 1, d = 1 - (a + 1) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; f = d;
  for (let m = 1; m <= 200; m++) {
    let numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + numerator / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;
    numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + numerator / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const delta = d * c;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-8) break;
  }
  return front * f;
}

function lnGamma(z) {
  const c = [76.18009172947146, -86.50532032941678, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** ROC-AUC via trapezoidal rank method */
function computeAUC(scores, labels) {
  const n = scores.length;
  if (n === 0) return 0.5;
  const pairs = scores.map((s, i) => ({ s, l: labels[i] })).sort((a, b) => b.s - a.s);
  let tp = 0, fp = 0;
  const totalP = labels.filter(l => l === 1).length;
  const totalN = n - totalP;
  if (totalP === 0 || totalN === 0) return 0.5;
  let auc = 0, prevTPR = 0, prevFPR = 0;
  for (let i = 0; i < n; i++) {
    if (pairs[i].l === 1) tp++; else fp++;
    const tpr = tp / totalP;
    const fpr = fp / totalN;
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
    prevTPR = tpr;
    prevFPR = fpr;
  }
  return auc;
}

/** Spearman rank correlation */
function spearmanCorr(a, b) {
  const n = a.length;
  if (n < 3) return 0;
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const ranks = new Array(n);
    for (let i = 0; i < n;) {
      let j = i;
      while (j < n && sorted[j].v === sorted[i].v) j++;
      const avgRank = (i + j - 1) / 2;
      for (let k = i; k < j; k++) ranks[sorted[k].i] = avgRank;
      i = j;
    }
    return ranks;
  };
  const ra = rank(a), rb = rank(b);
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();
  console.log(`\n========================================`);
  console.log(`  Phase 0: Alpha Signal Validation`);
  console.log(`  Horizon: ${HORIZON}`);
  console.log(`========================================\n`);

  const results = { horizon: HORIZON, tests: {}, verdict: '' };

  // ── Test A: Feature-Outcome AUC ──────────────────────────
  console.log('▶ Test A: Feature-Outcome AUC (개별 피처 예측력)');
  console.log('  Loading labeled_outcomes + gdelt features...');

  const featureData = await client.query(`
    SELECT
      lo.forward_return_pct,
      lo.hit,
      lo.theme,
      lo.symbol,
      a.source,
      EXTRACT(DOW FROM a.published_at)::int as dow,
      EXTRACT(MONTH FROM a.published_at)::int as month,
      EXTRACT(YEAR FROM a.published_at)::int as year,
      COALESCE(g.avg_goldstein, 0)::float as goldstein,
      COALESCE(g.avg_tone, 0)::float as tone,
      COALESCE(g.event_count, 0)::int as event_count
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    LEFT JOIN gdelt_daily_agg g ON g.date = DATE(a.published_at)
      AND g.cameo_root IN ('14','17','18','19','20')
      AND g.country = 'US'
    WHERE lo.horizon = $1
    ORDER BY a.published_at
  `, [HORIZON]);

  console.log(`  ${featureData.rows.length}건 로딩\n`);

  const rows = featureData.rows;
  const labels = rows.map(r => r.hit ? 1 : 0);
  const returns = rows.map(r => Number(r.forward_return_pct));

  // Feature extractors
  const features = {
    goldstein: rows.map(r => Number(r.goldstein)),
    tone: rows.map(r => Number(r.tone)),
    event_count_log: rows.map(r => Math.log1p(Number(r.event_count))),
    is_guardian: rows.map(r => r.source === 'guardian' ? 1 : 0),
    is_nyt: rows.map(r => r.source === 'nyt' ? 1 : 0),
    is_tech: rows.map(r => r.theme === 'tech' ? 1 : 0),
    is_conflict: rows.map(r => r.theme === 'conflict' ? 1 : 0),
    is_politics: rows.map(r => r.theme === 'politics' ? 1 : 0),
    dow_sin: rows.map(r => Math.sin(2 * Math.PI * Number(r.dow) / 7)),
    month_sin: rows.map(r => Math.sin(2 * Math.PI * Number(r.month) / 12)),
  };

  const aucResults = {};
  console.log('  Feature            AUC     Spearman  Verdict');
  console.log('  ─────────────────  ──────  ────────  ───────');

  let significantFeatures = 0;
  for (const [name, values] of Object.entries(features)) {
    const auc = computeAUC(values, labels);
    const rho = spearmanCorr(values, returns);
    const verdict = Math.abs(auc - 0.5) > 0.02 ? '✓ SIGNAL' : '  noise';
    if (Math.abs(auc - 0.5) > 0.02) significantFeatures++;
    aucResults[name] = { auc: Number(auc.toFixed(4)), spearman: Number(rho.toFixed(4)) };
    console.log(`  ${name.padEnd(19)} ${auc.toFixed(4)}  ${rho >= 0 ? ' ' : ''}${rho.toFixed(4)}    ${verdict}`);
  }

  results.tests.featureAUC = {
    features: aucResults,
    significantCount: significantFeatures,
    totalFeatures: Object.keys(features).length,
    pass: significantFeatures >= 3,
  };
  console.log(`\n  결과: ${significantFeatures}/${Object.keys(features).length} 피처가 AUC > 0.52 (기준: 3개 이상 → ${results.tests.featureAUC.pass ? 'PASS' : 'FAIL'})\n`);

  // ── Test B: Top/Bottom Decile Return Separation ───────────
  console.log('▶ Test B: Top/Bottom Decile Separation (방향성 시그널)');

  // Use goldstein score as the separator
  const goldsteinValues = rows.map(r => Number(r.goldstein));
  const p10 = percentile(goldsteinValues, 0.1);
  const p90 = percentile(goldsteinValues, 0.9);

  const bottomDecile = rows.filter(r => Number(r.goldstein) <= p10).map(r => Number(r.forward_return_pct));
  const topDecile = rows.filter(r => Number(r.goldstein) >= p90).map(r => Number(r.forward_return_pct));

  const ttest = welchTTest(topDecile, bottomDecile);
  console.log(`  Goldstein Top 10% (≥${p90.toFixed(2)}): n=${topDecile.length}, mean=${mean(topDecile).toFixed(3)}%, std=${std(topDecile).toFixed(3)}%`);
  console.log(`  Goldstein Bot 10% (≤${p10.toFixed(2)}): n=${bottomDecile.length}, mean=${mean(bottomDecile).toFixed(3)}%, std=${std(bottomDecile).toFixed(3)}%`);
  console.log(`  Welch t=${ttest.t.toFixed(3)}, p=${ttest.p.toFixed(6)}, diff=${ttest.meanDiff.toFixed(4)}%`);

  // Also test by theme (tech vs non-tech)
  const techReturns = rows.filter(r => r.theme === 'tech').map(r => Number(r.forward_return_pct));
  const nonTechReturns = rows.filter(r => r.theme !== 'tech').map(r => Number(r.forward_return_pct));
  const themeTtest = welchTTest(techReturns, nonTechReturns);
  console.log(`  Tech theme: n=${techReturns.length}, mean=${mean(techReturns).toFixed(3)}%`);
  console.log(`  Non-tech:   n=${nonTechReturns.length}, mean=${mean(nonTechReturns).toFixed(3)}%`);
  console.log(`  Theme Welch t=${themeTtest.t.toFixed(3)}, p=${themeTtest.p.toFixed(6)}`);

  results.tests.decileSeparation = {
    goldstein: { topMean: mean(topDecile), bottomMean: mean(bottomDecile), tStat: ttest.t, pValue: ttest.p },
    theme: { techMean: mean(techReturns), nonTechMean: mean(nonTechReturns), tStat: themeTtest.t, pValue: themeTtest.p },
    pass: ttest.p < 0.05 || themeTtest.p < 0.05,
  };
  console.log(`  결과: ${results.tests.decileSeparation.pass ? 'PASS' : 'FAIL'} (p < 0.05 기준)\n`);

  // ── Test C: Embedding KNN Prediction ──────────────────────
  console.log('▶ Test C: Embedding KNN (임베딩 유사도 기반 예측력)');
  console.log('  Sampling 1000 test articles + 10 neighbors each...');

  // Sample test set: most recent 1000 articles
  // For each, find 10 nearest neighbors from older articles
  const knnResult = await client.query(`
    WITH test_articles AS (
      SELECT a.id, a.embedding, a.published_at, lo.hit, lo.forward_return_pct
      FROM articles a
      JOIN labeled_outcomes lo ON lo.article_id = a.id
      WHERE lo.horizon = $1 AND a.embedding IS NOT NULL
      ORDER BY a.published_at DESC
      LIMIT 1000
    ),
    knn_predictions AS (
      SELECT
        t.id as test_id,
        t.hit as actual_hit,
        t.forward_return_pct as actual_return,
        (
          SELECT AVG(lo2.hit::int)
          FROM (
            SELECT a2.id, 1 - (a2.embedding <=> t.embedding) as sim
            FROM articles a2
            WHERE a2.embedding IS NOT NULL
              AND a2.published_at < t.published_at
              AND a2.id != t.id
            ORDER BY a2.embedding <=> t.embedding
            LIMIT 10
          ) nn
          JOIN labeled_outcomes lo2 ON lo2.article_id = nn.id AND lo2.horizon = $1
        ) as knn_hit_rate
      FROM test_articles t
    )
    SELECT
      test_id, actual_hit, actual_return, knn_hit_rate
    FROM knn_predictions
    WHERE knn_hit_rate IS NOT NULL
  `, [HORIZON]);

  const knnRows = knnResult.rows;
  console.log(`  ${knnRows.length}건 KNN 예측 완료`);

  if (knnRows.length > 50) {
    const knnScores = knnRows.map(r => Number(r.knn_hit_rate));
    const knnLabels = knnRows.map(r => r.actual_hit ? 1 : 0);
    const knnAUC = computeAUC(knnScores, knnLabels);
    const knnReturns = knnRows.map(r => Number(r.actual_return));
    const knnRho = spearmanCorr(knnScores, knnReturns);

    // High KNN vs Low KNN comparison
    const knnMedian = percentile(knnScores, 0.5);
    const highKNN = knnRows.filter(r => Number(r.knn_hit_rate) >= knnMedian).map(r => Number(r.actual_return));
    const lowKNN = knnRows.filter(r => Number(r.knn_hit_rate) < knnMedian).map(r => Number(r.actual_return));
    const knnTtest = welchTTest(highKNN, lowKNN);

    console.log(`  KNN AUC: ${knnAUC.toFixed(4)} (random=0.5)`);
    console.log(`  KNN-Return Spearman ρ: ${knnRho.toFixed(4)}`);
    console.log(`  High KNN group mean: ${mean(highKNN).toFixed(3)}%, Low: ${mean(lowKNN).toFixed(3)}%`);
    console.log(`  Welch t=${knnTtest.t.toFixed(3)}, p=${knnTtest.p.toFixed(6)}`);

    results.tests.embeddingKNN = {
      sampleSize: knnRows.length,
      auc: Number(knnAUC.toFixed(4)),
      spearman: Number(knnRho.toFixed(4)),
      highGroupMean: mean(highKNN),
      lowGroupMean: mean(lowKNN),
      tStat: knnTtest.t,
      pValue: knnTtest.p,
      pass: knnAUC > 0.52,
    };
  } else {
    console.log('  ⚠ KNN 샘플 부족 (pgvector 인덱스 또는 데이터 확인 필요)');
    results.tests.embeddingKNN = { sampleSize: knnRows.length, pass: false, note: 'insufficient samples' };
  }
  console.log(`  결과: ${results.tests.embeddingKNN.pass ? 'PASS' : 'FAIL'} (AUC > 0.52 기준)\n`);

  // ── Test D: Temporal Stability ────────────────────────────
  console.log('▶ Test D: Temporal Stability (시간에 따른 시그널 안정성)');

  const yearlyData = await client.query(`
    SELECT
      EXTRACT(YEAR FROM a.published_at)::int as year,
      lo.theme,
      COUNT(*) as n,
      AVG(lo.forward_return_pct::numeric) as avg_ret,
      AVG(lo.hit::int::numeric) as hit_rate,
      STDDEV(lo.forward_return_pct::numeric) as std_ret
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    WHERE lo.horizon = $1
    GROUP BY EXTRACT(YEAR FROM a.published_at)::int, lo.theme
    ORDER BY year, theme
  `, [HORIZON]);

  console.log('  Year  Theme      N       HitRate  AvgRet%   StdRet%');
  console.log('  ────  ─────────  ──────  ───────  ────────  ────────');
  let stableYears = 0;
  let totalYearTheme = 0;
  for (const r of yearlyData.rows) {
    const hr = Number(r.hit_rate);
    const marker = hr > 0.53 ? '✓' : hr > 0.50 ? '~' : '✗';
    console.log(`  ${r.year}  ${r.theme.padEnd(9)}  ${String(r.n).padStart(6)}  ${(hr * 100).toFixed(1)}%${marker}   ${Number(r.avg_ret).toFixed(3).padStart(7)}%  ${Number(r.std_ret).toFixed(3).padStart(7)}%`);
    if (hr > 0.50) stableYears++;
    totalYearTheme++;
  }

  results.tests.temporalStability = {
    yearlyDetails: yearlyData.rows.map(r => ({
      year: r.year, theme: r.theme, n: Number(r.n),
      hitRate: Number(Number(r.hit_rate).toFixed(4)),
      avgReturn: Number(Number(r.avg_ret).toFixed(4)),
    })),
    stableRatio: stableYears / totalYearTheme,
    pass: stableYears / totalYearTheme > 0.7,
  };
  console.log(`\n  Hit>50% 비율: ${stableYears}/${totalYearTheme} = ${(stableYears / totalYearTheme * 100).toFixed(0)}% (기준: 70% 이상 → ${results.tests.temporalStability.pass ? 'PASS' : 'FAIL'})\n`);

  // ── Overall Verdict ───────────────────────────────────────
  const passCount = [
    results.tests.featureAUC.pass,
    results.tests.decileSeparation.pass,
    results.tests.embeddingKNN.pass,
    results.tests.temporalStability.pass,
  ].filter(Boolean).length;

  console.log('════════════════════════════════════════');
  console.log('  VERDICT SUMMARY');
  console.log('════════════════════════════════════════');
  console.log(`  Test A (Feature AUC):        ${results.tests.featureAUC.pass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  Test B (Decile Separation):  ${results.tests.decileSeparation.pass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  Test C (Embedding KNN):      ${results.tests.embeddingKNN.pass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  Test D (Temporal Stability): ${results.tests.temporalStability.pass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  ──────────────────────────────────────`);

  if (passCount >= 3) {
    results.verdict = 'PROCEED — Signal exists, ML pipeline justified';
    console.log(`  ${passCount}/4 PASS → ✓ PROCEED with Phase 1+2`);
    console.log('  약한 시그널이지만 ML로 추출 가능한 수준.');
  } else if (passCount >= 2) {
    results.verdict = 'CAUTIOUS — Weak signal, proceed with reduced expectations';
    console.log(`  ${passCount}/4 PASS → ~ CAUTIOUS proceed`);
    console.log('  시그널이 약함. ML 파이프라인은 구축하되 기대치 조정 필요.');
  } else {
    results.verdict = 'HALT — Insufficient signal, reconsider data sources';
    console.log(`  ${passCount}/4 PASS → ✗ HALT`);
    console.log('  시그널 부재. 데이터 소스/피처 재검토 필요.');
  }
  console.log('');

  // Save results
  writeFileSync('./data/alpha-validation-result.json', JSON.stringify(results, null, 2));
  console.log('  결과 저장: data/alpha-validation-result.json\n');

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
