#!/usr/bin/env node
/**
 * train-meta-weights.mjs
 * labeled_outcomes + raw_items 데이터로 ML 가중치 학습
 * → data/learned_meta_weights.json 저장
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import { resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

const PG_CONFIG = resolveNasPgConfig();

// Logistic regression helpers (pure JS)
function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); }

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function trainLogistic(X, y, { lr = 0.01, iterations = 1000, lambda = 0.01 } = {}) {
  const n = X.length;
  const d = X[0].length;
  const weights = new Array(d).fill(0);
  let bias = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const pred = sigmoid(dotProduct(weights, X[i]) + bias);
      const err = pred - y[i];
      for (let j = 0; j < d; j++) gradW[j] += err * X[i][j];
      gradB += err;
    }

    for (let j = 0; j < d; j++) {
      weights[j] -= lr * (gradW[j] / n + lambda * weights[j]);
    }
    bias -= lr * (gradB / n);

    if ((iter + 1) % 200 === 0) {
      let loss = 0;
      for (let i = 0; i < n; i++) {
        const p = sigmoid(dotProduct(weights, X[i]) + bias);
        loss -= y[i] * Math.log(p + 1e-10) + (1 - y[i]) * Math.log(1 - p + 1e-10);
      }
      console.log(`  iter ${iter + 1}: loss=${(loss / n).toFixed(6)}`);
    }
  }
  return { weights, bias };
}

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  // Build training data from labeled_outcomes
  // Group by article, compute features from article metadata + theme
  console.log('학습 데이터 로딩...');
  
  const data = await client.query(`
    SELECT 
      lo.theme,
      lo.symbol,
      lo.horizon,
      lo.forward_return_pct,
      CASE WHEN lo.forward_return_pct > 0 THEN 1 ELSE 0 END as hit,
      a.source,
      EXTRACT(DOW FROM a.published_at) as dow,
      EXTRACT(MONTH FROM a.published_at) as month,
      COALESCE(g.avg_goldstein, 0) as goldstein,
      COALESCE(g.avg_tone, 0) as tone,
      COALESCE(g.event_count, 0) as event_count
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    LEFT JOIN gdelt_daily_agg g ON g.date = DATE(a.published_at) 
      AND g.cameo_root IN ('14','17','18','19','20')
      AND g.country IN ('US','CN','RU','IR','UA')
    WHERE lo.horizon = '2w'
    ORDER BY RANDOM()
    LIMIT 50000
  `);

  console.log(`  ${data.rows.length}건 로딩`);

  // Theme encoding
  const themes = ['conflict', 'economy', 'energy', 'tech', 'politics'];
  
  // Build feature matrix
  // Features: theme_onehot(5) + source_guardian(1) + goldstein(1) + tone(1) + event_count_log(1) + dow_sin(1) + month_sin(1) = 11 features
  const featureNames = [
    'theme_conflict', 'theme_economy', 'theme_energy', 'theme_tech', 'theme_politics',
    'source_guardian', 'goldstein', 'tone', 'event_count_log', 'dow_cycle', 'month_cycle'
  ];

  const X = [];
  const y = [];

  for (const row of data.rows) {
    const themeVec = themes.map(t => t === row.theme ? 1 : 0);
    const sourceGuardian = row.source === 'guardian' ? 1 : 0;
    const goldstein = Number(row.goldstein) / 10; // normalize to [-1, 1]
    const tone = Number(row.tone) / 10;
    const eventCountLog = Math.log1p(Number(row.event_count)) / 5;
    const dowCycle = Math.sin(2 * Math.PI * Number(row.dow) / 7);
    const monthCycle = Math.sin(2 * Math.PI * Number(row.month) / 12);

    X.push([...themeVec, sourceGuardian, goldstein, tone, eventCountLog, dowCycle, monthCycle]);
    y.push(Number(row.hit));
  }

  console.log(`  피처 수: ${featureNames.length}, 샘플 수: ${X.length}`);
  console.log(`  적중률: ${(y.reduce((a,b) => a+b, 0) / y.length * 100).toFixed(1)}%`);

  // Split train/test (80/20)
  const splitIdx = Math.floor(X.length * 0.8);
  const Xtrain = X.slice(0, splitIdx);
  const ytrain = y.slice(0, splitIdx);
  const Xtest = X.slice(splitIdx);
  const ytest = y.slice(splitIdx);

  console.log(`\n로지스틱 회귀 학습 (train=${Xtrain.length}, test=${Xtest.length})...`);
  const model = trainLogistic(Xtrain, ytrain, { lr: 0.05, iterations: 1000, lambda: 0.01 });

  // Evaluate
  let correct = 0;
  for (let i = 0; i < Xtest.length; i++) {
    const pred = sigmoid(dotProduct(model.weights, Xtest[i]) + model.bias);
    const predicted = pred > 0.5 ? 1 : 0;
    if (predicted === ytest[i]) correct++;
  }
  const accuracy = (correct / Xtest.length * 100).toFixed(1);
  console.log(`\n테스트 정확도: ${accuracy}%`);

  // Print learned weights
  console.log('\n=== 학습된 가중치 ===');
  featureNames.forEach((name, i) => {
    console.log(`  ${name}: ${model.weights[i].toFixed(4)}`);
  });
  console.log(`  bias: ${model.bias.toFixed(4)}`);

  // Save as meta weights format compatible with weight-learner.ts
  // Note: the weight-learner.ts expects features matching idea-generator.ts
  // This is a separate model trained on article-level features
  // We save it as a general learned model
  const metaWeights = {
    featureNames,
    weights: model.weights.map(w => Number(w.toFixed(6))),
    bias: Number(model.bias.toFixed(6)),
    metadata: {
      trainSamples: Xtrain.length,
      testSamples: Xtest.length,
      testAccuracy: Number(accuracy),
      hitRate: Number((y.reduce((a,b) => a+b, 0) / y.length * 100).toFixed(1)),
      trainedAt: new Date().toISOString(),
      horizon: '2w',
    }
  };

  writeFileSync('./data/learned_meta_weights.json', JSON.stringify(metaWeights, null, 2));
  console.log('\n저장 완료: data/learned_meta_weights.json');

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
