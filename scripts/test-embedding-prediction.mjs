#!/usr/bin/env node
/**
 * test-embedding-prediction.mjs
 *
 * 핵심 질문: 768-dim 임베딩 + 시장 컨텍스트로 2주 수익을 예측할 수 있는가?
 *
 * labeled_outcomes + articles(embedding) + GDELT + FRED → 학습 → AUC 측정
 * 시간순 분할 (look-ahead 방지): 앞 80% 학습, 뒤 20% 테스트
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); }

function computeAUC(scores, labels) {
  const n = scores.length;
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
    prevTPR = tpr; prevFPR = fpr;
  }
  return auc;
}

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log('=== 임베딩 기반 예측력 테스트 ===\n');

  // Load: embedding + GDELT context + FRED context + 2w label
  // Time-ordered, sample 20k for memory
  console.log('1. 데이터 로딩 (embedding + context + label)...');
  const data = await client.query(`
    WITH sampled AS (
      SELECT lo.article_id, lo.forward_return_pct, lo.hit,
             lo.theme, lo.symbol,
             a.source, a.published_at,
             a.embedding,
             COALESCE(g.avg_goldstein, 0)::float AS goldstein,
             COALESCE(g.avg_tone, 0)::float AS tone,
             COALESCE(g.event_count, 0)::int AS event_count
      FROM labeled_outcomes lo
      JOIN articles a ON lo.article_id = a.id
      LEFT JOIN gdelt_daily_agg g ON g.date = DATE(a.published_at)
        AND g.cameo_root IN ('14','17','18','19','20') AND g.country = 'US'
      WHERE lo.horizon = '2w' AND a.embedding IS NOT NULL
      ORDER BY a.published_at
    )
    SELECT * FROM sampled
    LIMIT 25000
  `);

  console.log(`  ${data.rows.length}건 로딩\n`);

  // Parse embeddings and build feature matrix
  console.log('2. 피처 매트릭스 구축...');
  const examples = [];
  for (const row of data.rows) {
    let emb;
    if (typeof row.embedding === 'string') {
      // pgvector format: [0.1,0.2,...] or other formats
      emb = row.embedding.replace(/[\[\]{}]/g, '').split(',').map(Number);
    } else if (Array.isArray(row.embedding)) {
      emb = row.embedding.map(Number);
    } else {
      continue;
    }
    if (emb.length < 100) continue; // skip bad embeddings

    // Context features (10개)
    const context = [
      row.source === 'guardian' ? 1 : 0,
      row.source === 'nyt' ? 1 : 0,
      row.theme === 'conflict' ? 1 : 0,
      row.theme === 'tech' ? 1 : 0,
      row.theme === 'energy' ? 1 : 0,
      row.theme === 'economy' ? 1 : 0,
      row.theme === 'politics' ? 1 : 0,
      Number(row.goldstein) / 10,       // [-1, 1]
      Number(row.tone) / 10,            // [-1, 1]
      Math.log1p(Number(row.event_count)) / 8,  // [0, ~1]
    ];

    examples.push({
      features: [...emb, ...context],  // 768 + 10 = 778 dims
      embOnly: emb,
      contextOnly: context,
      label: row.hit ? 1 : 0,
      returnPct: Number(row.forward_return_pct),
    });
  }

  console.log(`  피처 차원: ${examples[0]?.features.length} (embedding ${examples[0]?.embOnly.length} + context ${examples[0]?.contextOnly.length})`);
  console.log(`  유효 샘플: ${examples.length}\n`);

  // Time-ordered split: 80% train, 20% test (no shuffle — temporal barrier)
  const splitIdx = Math.floor(examples.length * 0.8);
  const train = examples.slice(0, splitIdx);
  const test = examples.slice(splitIdx);
  console.log(`  Train: ${train.length}, Test: ${test.length}\n`);

  // ═══ Test A: Context-only (10 features) ═══
  console.log('3A. Context-only 모델 (10 피처)...');
  const modelCtx = trainLogistic(
    train.map(e => e.contextOnly),
    train.map(e => e.label),
    { lr: 0.05, iterations: 500, lambda: 0.01 }
  );
  const predsCtx = test.map(e => predict(modelCtx, e.contextOnly));
  const aucCtx = computeAUC(predsCtx, test.map(e => e.label));
  console.log(`  AUC: ${aucCtx.toFixed(4)} (random=0.5)\n`);

  // ═══ Test B: Embedding-only (768 features, L1 heavy) ═══
  console.log('3B. Embedding-only 모델 (768 피처, L1 강한 정규화)...');
  const modelEmb = trainLogistic(
    train.map(e => e.embOnly),
    train.map(e => e.label),
    { lr: 0.01, iterations: 200, lambda: 0.1, l1Lambda: 0.05 }
  );
  const predsEmb = test.map(e => predict(modelEmb, e.embOnly));
  const aucEmb = computeAUC(predsEmb, test.map(e => e.label));
  const nonzero = modelEmb.weights.filter(w => Math.abs(w) > 0.001).length;
  console.log(`  AUC: ${aucEmb.toFixed(4)}, 비제로 가중치: ${nonzero}/${modelEmb.weights.length}\n`);

  // ═══ Test C: Embedding + Context (778 features) ═══
  console.log('3C. Embedding + Context 통합 모델 (778 피처)...');
  const modelFull = trainLogistic(
    train.map(e => e.features),
    train.map(e => e.label),
    { lr: 0.01, iterations: 200, lambda: 0.1, l1Lambda: 0.03 }
  );
  const predsFull = test.map(e => predict(modelFull, e.features));
  const aucFull = computeAUC(predsFull, test.map(e => e.label));
  const nonzeroFull = modelFull.weights.filter(w => Math.abs(w) > 0.001).length;
  console.log(`  AUC: ${aucFull.toFixed(4)}, 비제로 가중치: ${nonzeroFull}/${modelFull.weights.length}\n`);

  // ═══ Test D: Top/Bottom quartile by prediction ═══
  console.log('3D. 예측 상위/하위 25% 수익률 비교...');
  const sorted = test.map((e, i) => ({ pred: predsFull[i], ret: e.returnPct })).sort((a, b) => b.pred - a.pred);
  const q1 = sorted.slice(0, Math.floor(sorted.length * 0.25));
  const q4 = sorted.slice(Math.floor(sorted.length * 0.75));
  const q1ret = q1.reduce((s, r) => s + r.ret, 0) / q1.length;
  const q4ret = q4.reduce((s, r) => s + r.ret, 0) / q4.length;
  const q1hit = q1.filter(r => r.ret > 0).length / q1.length;
  const q4hit = q4.filter(r => r.ret > 0).length / q4.length;
  console.log(`  예측 상위 25%: avg ${q1ret.toFixed(3)}%, hit ${(q1hit * 100).toFixed(1)}%`);
  console.log(`  예측 하위 25%: avg ${q4ret.toFixed(3)}%, hit ${(q4hit * 100).toFixed(1)}%`);
  console.log(`  차이: ${(q1ret - q4ret).toFixed(3)}%\n`);

  // ═══ Summary ═══
  console.log('════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('════════════════════════════════════');
  console.log(`  Context-only (10 feat):     AUC = ${aucCtx.toFixed(4)}`);
  console.log(`  Embedding-only (768 feat):  AUC = ${aucEmb.toFixed(4)}`);
  console.log(`  Full (778 feat):            AUC = ${aucFull.toFixed(4)}`);
  console.log(`  Top Q1 - Bottom Q4 return:  ${(q1ret - q4ret).toFixed(3)}%`);
  console.log(`  Top Q1 hit rate:            ${(q1hit * 100).toFixed(1)}%`);
  console.log('');

  if (aucFull > 0.55) {
    console.log('  ✓ SIGNAL DETECTED — 임베딩에 예측력 있음. 파이프라인 재설계 진행.');
  } else if (aucFull > 0.52) {
    console.log('  ~ WEAK SIGNAL — 약한 시그널. 보조 피처로 사용 가능.');
  } else {
    console.log('  ✗ NO SIGNAL — 임베딩에도 예측력 없음. 다른 피처 탐색 필요.');
  }

  await client.end();
}

function trainLogistic(X, y, opts = {}) {
  const { lr = 0.01, iterations = 300, lambda = 0.01, l1Lambda = 0 } = opts;
  const n = X.length;
  const d = X[0].length;
  const weights = new Array(d).fill(0);
  let bias = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Mini-batch SGD (batch size 512)
    const batchSize = Math.min(512, n);
    const startIdx = Math.floor(Math.random() * Math.max(1, n - batchSize));
    const gradW = new Array(d).fill(0);
    let gradB = 0;

    for (let b = 0; b < batchSize; b++) {
      const i = startIdx + b;
      let dot = bias;
      for (let j = 0; j < d; j++) dot += weights[j] * X[i][j];
      const pred = sigmoid(dot);
      const err = pred - y[i];
      for (let j = 0; j < d; j++) gradW[j] += err * X[i][j];
      gradB += err;
    }

    const scale = lr / batchSize;
    for (let j = 0; j < d; j++) {
      weights[j] -= scale * (gradW[j] + lambda * weights[j]);
      // L1 proximal step (soft thresholding)
      if (l1Lambda > 0) {
        const threshold = scale * l1Lambda;
        if (weights[j] > threshold) weights[j] -= threshold;
        else if (weights[j] < -threshold) weights[j] += threshold;
        else weights[j] = 0;
      }
    }
    bias -= scale * gradB;

    if ((iter + 1) % 100 === 0) {
      let loss = 0;
      for (let i = 0; i < Math.min(2000, n); i++) {
        let dot = bias;
        for (let j = 0; j < d; j++) dot += weights[j] * X[i][j];
        const p = sigmoid(dot);
        loss -= y[i] * Math.log(p + 1e-10) + (1 - y[i]) * Math.log(1 - p + 1e-10);
      }
      process.stderr.write(`  iter ${iter + 1}: loss=${(loss / Math.min(2000, n)).toFixed(4)}\n`);
    }
  }
  return { weights, bias };
}

function predict(model, features) {
  let dot = model.bias;
  for (let j = 0; j < features.length; j++) dot += model.weights[j] * features[j];
  return sigmoid(dot);
}

main().catch(e => { console.error(e); process.exit(1); });
