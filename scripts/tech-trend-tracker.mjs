#!/usr/bin/env node
/**
 * tech-trend-tracker.mjs — 신기술 트렌드 자동 추적 + 리포트 생성
 *
 * 60k 기사에서:
 * 1. 기술 키워드 기반 주제 자동 발견
 * 2. 시간대별 트렌드 곡선 (월별 기사 수)
 * 3. 서지(surge) 감지 — 갑자기 기사가 폭발하는 시점
 * 4. 임베딩 클러스터링 — 키워드로 잡히지 않는 새로운 주제 발견
 * 5. 기술-종목 연결 — 해당 기술과 관련된 종목의 반응
 * 6. 리포트 생성
 *
 * Usage:
 *   node --import tsx scripts/tech-trend-tracker.mjs
 *   node --import tsx scripts/tech-trend-tracker.mjs --topic "AI"
 *   node --import tsx scripts/tech-trend-tracker.mjs --discover
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  THEME_TAXONOMY_VERSION,
  TREND_AGGREGATION_PERIODS,
  listTrendTrackerThemes,
} from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

function buildTrackedTopics() {
  return listTrendTrackerThemes()
    .map((theme) => ({
      key: theme.key,
      name: theme.label,
      aliases: [...new Set([theme.key, theme.label, ...(theme.aliases || [])])],
      category: theme.category,
      parentTheme: theme.parentTheme || null,
      lifecycleHint: theme.lifecycleHint || null,
      keywords: [...new Set(theme.keywords || [])],
      symbols: [...new Set(theme.representativeSymbols || [])],
    }))
    .filter((topic) => topic.keywords.length > 0);
}

function matchesTopicFilter(topic, rawFilter) {
  if (!rawFilter) return true;
  const normalizedFilter = String(rawFilter).trim().toLowerCase();
  return topic.aliases.some((alias) => String(alias).toLowerCase().includes(normalizedFilter));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { topic: null, discover: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic') result.topic = args[++i];
    if (args[i] === '--discover') result.discover = true;
  }
  return result;
}

async function main() {
  const opts = parseArgs();
  const client = new Client(PG_CONFIG);
  await client.connect();

  const trackedTopics = buildTrackedTopics();
  const report = {
    generatedAt: new Date().toISOString(),
    taxonomyVersion: THEME_TAXONOMY_VERSION,
    supportedPeriods: TREND_AGGREGATION_PERIODS,
    topics: [],
    surges: [],
    discovery: null,
  };

  // ═══ 1. Topic Trend Analysis ═══
  console.log('▶ 1. 기술 주제별 트렌드 분석...\n');

  for (const topic of trackedTopics) {
    if (!matchesTopicFilter(topic, opts.topic)) continue;

    const topicName = topic.name;
    const config = {
      keywords: topic.keywords,
      symbols: topic.symbols,
    };

    const kwCondition = config.keywords.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
    const kwParams = config.keywords.map(kw => `%${kw}%`);

    // Monthly article counts
    const trend = await client.query(`
      SELECT DATE_TRUNC('month', published_at)::date AS month, COUNT(*) AS n
      FROM articles WHERE ${kwCondition}
      GROUP BY month ORDER BY month
    `, kwParams);

    if (trend.rows.length < 3) continue;

    const counts = trend.rows.map(r => ({ month: r.month, n: Number(r.n) }));
    const totalArticles = counts.reduce((s, r) => s + r.n, 0);
    const avgMonthly = totalArticles / counts.length;

    // Detect surges (months where count > 2x average)
    const surges = counts.filter(r => r.n > avgMonthly * 2);

    // Recent trend: last 6 months vs previous 6 months
    const recent6 = counts.slice(-6);
    const prev6 = counts.slice(-12, -6);
    const recentAvg = recent6.length > 0 ? recent6.reduce((s, r) => s + r.n, 0) / recent6.length : 0;
    const prevAvg = prev6.length > 0 ? prev6.reduce((s, r) => s + r.n, 0) / prev6.length : 0;
    const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100) : 0;

    // Representative recent articles
    const recentArticles = await client.query(`
      SELECT title, source, published_at::date AS date
      FROM articles WHERE ${kwCondition}
      ORDER BY published_at DESC LIMIT 5
    `, kwParams);

    // Stock impact (if labeled_outcomes available)
    let stockImpact = [];
    if (config.symbols.length > 0) {
      const symList = config.symbols.map((_, i) => `$${kwParams.length + i + 1}`);
      const impact = await client.query(`
        SELECT lo.symbol, lo.horizon,
               AVG(lo.forward_return_pct::numeric) AS avg_ret,
               AVG(lo.hit::int::numeric) AS hit_rate,
               COUNT(*) AS n
        FROM labeled_outcomes lo
        JOIN articles a ON lo.article_id = a.id
        WHERE (${kwCondition}) AND lo.symbol IN (${symList.join(',')})
        GROUP BY lo.symbol, lo.horizon
        ORDER BY lo.symbol, lo.horizon
      `, [...kwParams, ...config.symbols]);
      stockImpact = impact.rows.map(r => ({
        symbol: r.symbol, horizon: r.horizon,
        avgReturn: Number(Number(r.avg_ret).toFixed(3)),
        hitRate: Number(Number(r.hit_rate).toFixed(3)),
        n: Number(r.n),
      }));
    }

    const topicData = {
      key: topic.key,
      name: topicName,
      category: topic.category,
      parentTheme: topic.parentTheme,
      lifecycleHint: topic.lifecycleHint,
      totalArticles,
      avgMonthly: Number(avgMonthly.toFixed(1)),
      recentMonthlyAvg: Number(recentAvg.toFixed(1)),
      momentum: Number(momentum.toFixed(1)),
      trend: momentum > 30 ? 'SURGING' : momentum > 10 ? 'GROWING' : momentum > -10 ? 'STABLE' : 'DECLINING',
      surgeMonths: surges.map(s => ({ month: s.month, count: s.n })),
      monthlyCounts: counts,
      recentArticles: recentArticles.rows.map(r => ({ title: r.title, source: r.source, date: r.date })),
      stockImpact,
    };
    report.topics.push(topicData);

    // Print summary
    const trendEmoji = topicData.trend === 'SURGING' ? '🔥' : topicData.trend === 'GROWING' ? '📈' : topicData.trend === 'STABLE' ? '➡️' : '📉';
    console.log(`  ${trendEmoji} ${topicName.padEnd(20)} ${String(totalArticles).padStart(5)} articles | avg ${avgMonthly.toFixed(0)}/mo | recent ${recentAvg.toFixed(0)}/mo | momentum ${momentum > 0 ? '+' : ''}${momentum.toFixed(0)}% ${topicData.trend}`);

    if (surges.length > 0) {
      console.log(`     Surges: ${surges.map(s => s.month?.toISOString?.()?.slice(0, 7) || String(s.month).slice(0, 7) + '(' + s.n + '건)').join(', ')}`);
    }

    if (stockImpact.length > 0) {
      const twoWeek = stockImpact.filter(s => s.horizon === '2w');
      if (twoWeek.length > 0) {
        console.log(`     Stock impact (2w): ${twoWeek.map(s => s.symbol + ' ' + (s.avgReturn >= 0 ? '+' : '') + s.avgReturn.toFixed(2) + '% (hit ' + (s.hitRate * 100).toFixed(0) + '%)').join(', ')}`);
      }
    }

    if (recentArticles.rows.length > 0) {
      console.log(`     Latest: ${recentArticles.rows[0]?.title?.slice(0, 70)}`);
    }
    console.log('');
  }

  // ═══ 2. Surge Detection (전체 기술 분야에서 최근 급증) ═══
  console.log('▶ 2. 최근 서지(급증) 감지...\n');

  for (const topic of report.topics) {
    const recent3 = topic.monthlyCounts.slice(-3);
    const baseline = topic.monthlyCounts.slice(-15, -3);
    if (baseline.length < 3) continue;

    const baseAvg = baseline.reduce((s, r) => s + r.n, 0) / baseline.length;
    const baseStd = Math.sqrt(baseline.reduce((s, r) => s + (r.n - baseAvg) ** 2, 0) / baseline.length);

    for (const month of recent3) {
      if (baseStd > 0 && (month.n - baseAvg) / baseStd > 2.0) {
        const surge = {
          topic: topic.name,
          month: month.month,
          count: month.n,
          baselineAvg: Number(baseAvg.toFixed(1)),
          zScore: Number(((month.n - baseAvg) / baseStd).toFixed(2)),
        };
        report.surges.push(surge);
        console.log(`  ⚡ ${topic.name} — ${String(month.month).slice(0, 7)}: ${month.n}건 (평균 ${baseAvg.toFixed(0)}, z=${surge.zScore})`);
      }
    }
  }
  if (report.surges.length === 0) console.log('  (최근 3개월 내 유의한 서지 없음)');

  // ═══ 3. Embedding-based Topic Discovery ═══
  if (opts.discover) {
    console.log('\n▶ 3. 임베딩 기반 신규 주제 발견...');
    console.log('  (60k × 768-dim 클러스터링 — 시간 소요)');

    // Sample 5000 recent articles, compute pairwise similarity, find dense clusters
    const sample = await client.query(`
      SELECT id, title, published_at::date AS date,
             embedding::text AS emb_text
      FROM articles
      WHERE embedding IS NOT NULL
      ORDER BY published_at DESC
      LIMIT 3000
    `);

    // Parse embeddings and run simple k-means (k=30)
    const articles = sample.rows.map(r => {
      const emb = r.emb_text.replace(/[\[\]]/g, '').split(',').map(Number);
      return { id: r.id, title: r.title, date: r.date, embedding: emb };
    }).filter(a => a.embedding.length > 100);

    console.log(`  ${articles.length}개 기사 로드, k-means 실행 (k=30)...`);

    const k = 30;
    const dim = articles[0].embedding.length;
    const clusters = kMeans(articles.map(a => a.embedding), k, 15, dim);

    // Analyze each cluster
    const clusterInfo = [];
    for (let c = 0; c < k; c++) {
      const members = articles.filter((_, i) => clusters.assignments[i] === c);
      if (members.length < 10) continue;

      // Extract common words from titles
      const wordFreq = {};
      for (const m of members) {
        const words = m.title.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
        for (const w of words) wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
      const topWords = Object.entries(wordFreq)
        .filter(([w]) => !['that', 'this', 'with', 'from', 'have', 'been', 'will', 'more', 'than', 'what', 'says', 'after', 'over', 'about', 'could', 'their', 'were', 'they', 'said', 'would', 'year', 'years', 'also', 'into', 'first', 'last', 'live', 'news'].includes(w))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([w, n]) => w + '(' + n + ')');

      clusterInfo.push({
        clusterId: c,
        size: members.length,
        keywords: topWords,
        sampleTitles: members.slice(0, 3).map(m => m.title.slice(0, 60)),
        dateRange: members[members.length - 1]?.date + ' ~ ' + members[0]?.date,
      });
    }

    clusterInfo.sort((a, b) => b.size - a.size);
    report.discovery = clusterInfo;

    console.log(`\n  발견된 주제 클러스터 (상위 15):`);
    for (const cl of clusterInfo.slice(0, 15)) {
      console.log(`  [${cl.clusterId}] ${cl.size}건 | ${cl.keywords.slice(0, 5).join(', ')}`);
      console.log(`       ${cl.sampleTitles[0]}`);
    }
  }

  // ═══ 4. Save Report ═══
  const outFile = './data/tech-trend-report.json';
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n결과 저장: ${outFile}`);

  // ═══ 5. Summary ═══
  console.log('\n════════════════════════════════════════');
  console.log('  TECH TREND SUMMARY');
  console.log('════════════════════════════════════════');
  const surging = report.topics.filter(t => t.trend === 'SURGING');
  const growing = report.topics.filter(t => t.trend === 'GROWING');
  const declining = report.topics.filter(t => t.trend === 'DECLINING');
  if (surging.length > 0) console.log(`  🔥 SURGING:   ${surging.map(t => t.name).join(', ')}`);
  if (growing.length > 0) console.log(`  📈 GROWING:   ${growing.map(t => t.name).join(', ')}`);
  if (declining.length > 0) console.log(`  📉 DECLINING: ${declining.map(t => t.name).join(', ')}`);
  console.log(`  ⚡ Surges:    ${report.surges.length}건 (최근 3개월)`);
  console.log('');

  await client.end();
}

// Simple k-means clustering
function kMeans(data, k, maxIter, dim) {
  const n = data.length;
  // Initialize centroids from random samples
  const centroids = [];
  const used = new Set();
  for (let i = 0; i < k; i++) {
    let idx;
    do { idx = Math.floor(Math.random() * n); } while (used.has(idx));
    used.add(idx);
    centroids.push(data[idx].slice());
  }

  const assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each point to nearest centroid
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let minC = 0;
      for (let c = 0; c < k; c++) {
        let dist = 0;
        for (let d = 0; d < dim; d++) {
          const diff = (data[i][d] || 0) - (centroids[c][d] || 0);
          dist += diff * diff;
        }
        if (dist < minDist) { minDist = dist; minC = c; }
      }
      if (assignments[i] !== minC) { assignments[i] = minC; changed++; }
    }

    if (changed === 0) break;

    // Update centroids
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) sums[c][d] += (data[i][d] || 0);
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / counts[c];
      }
    }
  }

  return { assignments, centroids };
}

main().catch(e => { console.error(e); process.exit(1); });
