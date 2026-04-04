#!/usr/bin/env node
/**
 * auto-pipeline.mjs — 전체 자동화 파이프라인
 *
 * 하드코딩 5가지를 모두 자동화:
 * 1. 기사 → 테마 자동 분류 (임베딩 클러스터링)
 * 2. 테마 → 종목 자동 매핑 (가격 역추적)
 * 3. labeled_outcomes 자동 갱신
 * 4. 원인 설명 자동 생성 (Ollama LLM)
 * 5. 트렌드 키워드 자동 확장
 *
 * Usage:
 *   node --import tsx scripts/auto-pipeline.mjs              # 전체 실행
 *   node --import tsx scripts/auto-pipeline.mjs --step 1     # 특정 단계만
 *   node --import tsx scripts/auto-pipeline.mjs --since 2025-01-01  # 특정 날짜 이후만
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { step: null, since: null, limit: 10000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--step') result.step = parseInt(args[++i]);
    if (args[i] === '--since') result.since = args[++i];
    if (args[i] === '--limit') result.limit = parseInt(args[++i]);
  }
  return result;
}

const OLLAMA_URL = (process.env.OLLAMA_API_URL || process.env.OLLAMA_BASE_URL || '').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || process.env.CODEX_MODEL || 'llama3';

async function main() {
  const opts = parseArgs();
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log('═══ AUTO PIPELINE — 하드코딩 전면 자동화 ═══\n');

  // ═══ STEP 1: 기사 → 테마 자동 분류 ═══
  if (!opts.step || opts.step === 1) {
    console.log('▶ STEP 1: 기사 → 테마 자동 분류 (임베딩 클러스터링)...');

    // Ensure auto_themes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS auto_article_themes (
        article_id INTEGER PRIMARY KEY REFERENCES articles(id),
        auto_theme TEXT,
        confidence DOUBLE PRECISION DEFAULT 0,
        method TEXT DEFAULT 'embedding-cluster',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Batch classification: for each theme, pick 5 anchor articles
    // Then classify ALL unclassified articles in a single batch query per theme
    console.log('  Batch classifying articles by embedding similarity to theme anchors...');

    const themes = ['conflict', 'tech', 'energy', 'economy', 'politics'];
    // Build anchor IDs for each theme
    const anchorMap = {};
    for (const theme of themes) {
      const r = await client.query(`
        SELECT a.id FROM articles a
        JOIN labeled_outcomes lo ON lo.article_id = a.id
        WHERE lo.theme = $1 AND a.embedding IS NOT NULL AND lo.horizon = '2w'
        ORDER BY RANDOM() LIMIT 5
      `, [theme]);
      anchorMap[theme] = r.rows.map(row => row.id);
    }

    // For each unclassified article, compute similarity to each theme's anchors in batch
    // Use a single query that finds the closest anchor overall
    await client.query(`
      INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
      SELECT sub.article_id, sub.best_theme, sub.best_sim, 'embedding-batch'
      FROM (
        SELECT a.id AS article_id,
          (SELECT lo.theme FROM labeled_outcomes lo
           JOIN articles anchor ON anchor.id = lo.article_id
           WHERE lo.horizon = '2w' AND anchor.embedding IS NOT NULL
           ORDER BY anchor.embedding <=> a.embedding LIMIT 1
          ) AS best_theme,
          (SELECT 1 - (anchor.embedding <=> a.embedding) FROM articles anchor
           JOIN labeled_outcomes lo ON lo.article_id = anchor.id
           WHERE lo.horizon = '2w' AND anchor.embedding IS NOT NULL
           ORDER BY anchor.embedding <=> a.embedding LIMIT 1
          ) AS best_sim
        FROM articles a
        WHERE a.embedding IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM auto_article_themes t WHERE t.article_id = a.id)
        ${opts.since ? "AND a.published_at >= '" + opts.since + "'::timestamptz" : ''}
        LIMIT ${opts.limit}
      ) sub
      WHERE sub.best_theme IS NOT NULL
      ON CONFLICT (article_id) DO UPDATE SET
        auto_theme=EXCLUDED.auto_theme, confidence=EXCLUDED.confidence, updated_at=NOW()
    `);

    void anchorMap;

    const counts = await client.query('SELECT auto_theme, COUNT(*) n FROM auto_article_themes GROUP BY auto_theme ORDER BY n DESC');
    console.log('  분류 결과:');
    for (const r of counts.rows) console.log(`    ${r.auto_theme.padEnd(12)} ${r.n} articles`);
  }

  // ═══ STEP 2: 테마 → 종목 자동 매핑 (가격 역추적) ═══
  if (!opts.step || opts.step === 2) {
    console.log('\n▶ STEP 2: 테마 → 종목 자동 매핑 (가격 역추적)...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS auto_theme_symbols (
        id SERIAL PRIMARY KEY,
        theme TEXT,
        symbol TEXT,
        avg_abs_reaction DOUBLE PRECISION,
        reaction_count INTEGER,
        correlation DOUBLE PRECISION,
        method TEXT DEFAULT 'price-reaction',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(theme, symbol)
      )
    `);

    // Single batch query: for ALL themes × ALL symbols at once
    console.log('  Batch computing event-day vs non-event-day reactions (single query)...');

    await client.query(`
      WITH event_dates_by_theme AS (
        SELECT t.auto_theme AS theme, DATE(a.published_at) AS d
        FROM auto_article_themes t
        JOIN articles a ON a.id = t.article_id
        WHERE t.auto_theme != 'unknown'
        GROUP BY t.auto_theme, DATE(a.published_at)
      ),
      theme_date_counts AS (
        SELECT theme, COUNT(DISTINCT d) AS date_count FROM event_dates_by_theme GROUP BY theme HAVING COUNT(DISTINCT d) >= 10
      ),
      daily_returns AS (
        SELECT h.symbol, DATE(h.valid_time_start) AS d,
               CASE WHEN LAG(h.price::float) OVER (PARTITION BY h.symbol ORDER BY h.valid_time_start) > 0
                    THEN (h.price::float - LAG(h.price::float) OVER (PARTITION BY h.symbol ORDER BY h.valid_time_start))
                         / LAG(h.price::float) OVER (PARTITION BY h.symbol ORDER BY h.valid_time_start) * 100
                    ELSE 0 END AS ret
        FROM worldmonitor_intel.historical_raw_items h
        WHERE h.provider = 'yahoo-chart' AND h.price IS NOT NULL
      ),
      reactions AS (
        SELECT e.theme, dr.symbol,
               AVG(ABS(dr.ret)) AS event_avg_abs,
               COUNT(*) AS event_count
        FROM daily_returns dr
        JOIN event_dates_by_theme e ON e.d = dr.d
        JOIN theme_date_counts tc ON tc.theme = e.theme
        WHERE dr.ret != 0
        GROUP BY e.theme, dr.symbol
        HAVING COUNT(*) >= 20
      ),
      baselines AS (
        SELECT symbol, AVG(ABS(ret)) AS baseline_avg_abs
        FROM daily_returns WHERE ret != 0
        GROUP BY symbol
      )
      INSERT INTO auto_theme_symbols (theme, symbol, avg_abs_reaction, reaction_count, correlation, method)
      SELECT r.theme, r.symbol, r.event_avg_abs, r.event_count,
             CASE WHEN b.baseline_avg_abs > 0.01 THEN r.event_avg_abs / b.baseline_avg_abs ELSE 1 END,
             'price-reaction-batch'
      FROM reactions r
      JOIN baselines b ON b.symbol = r.symbol
      WHERE r.event_avg_abs / GREATEST(b.baseline_avg_abs, 0.01) > 1.05
      ON CONFLICT (theme, symbol) DO UPDATE SET
        avg_abs_reaction=EXCLUDED.avg_abs_reaction, reaction_count=EXCLUDED.reaction_count,
        correlation=EXCLUDED.correlation, method=EXCLUDED.method, updated_at=NOW()
    `);

    const mapped = await client.query('SELECT theme, symbol, avg_abs_reaction, correlation FROM auto_theme_symbols ORDER BY theme, correlation DESC');
    let lastTheme = '';
    for (const r of mapped.rows) {
      if (r.theme !== lastTheme) { console.log(`  ${r.theme}:`); lastTheme = r.theme; }
      console.log(`    ${r.symbol.padEnd(6)} |move|=${Number(r.avg_abs_reaction).toFixed(2)}% ratio=${Number(r.correlation).toFixed(2)}x`);
    }
    console.log(`  Total: ${mapped.rows.length} auto-mapped symbol-theme pairs`);
  }

  // ═══ STEP 3: labeled_outcomes 자동 갱신 ═══
  if (!opts.step || opts.step === 3) {
    console.log('\n▶ STEP 3: labeled_outcomes 자동 갱신...');

    // Use auto_article_themes + auto_theme_symbols to generate new outcomes
    // For articles not yet in labeled_outcomes with auto-detected themes/symbols
    const newArticles = await client.query(`
      SELECT t.article_id, t.auto_theme, a.published_at
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      WHERE t.auto_theme != 'unknown'
        AND NOT EXISTS (SELECT 1 FROM labeled_outcomes lo WHERE lo.article_id = t.article_id)
      ${opts.since ? "AND a.published_at >= $1::timestamptz" : ''}
      LIMIT $${opts.since ? 2 : 1}
    `, opts.since ? [opts.since, 5000] : [5000]);

    console.log(`  ${newArticles.rows.length} articles need outcome labeling...`);

    let labeled = 0;
    for (const article of newArticles.rows) {
      // Get auto-mapped symbols for this theme
      const symbols = await client.query(
        'SELECT symbol FROM auto_theme_symbols WHERE theme=$1 ORDER BY correlation DESC LIMIT 5',
        [article.auto_theme]
      );
      if (symbols.rows.length === 0) continue;

      for (const symRow of symbols.rows) {
        for (const horizon of [{ name: '1w', days: 7 }, { name: '2w', days: 14 }, { name: '1m', days: 30 }]) {
          // Get entry and exit prices
          const prices = await client.query(`
            SELECT price::float AS price, valid_time_start
            FROM worldmonitor_intel.historical_raw_items
            WHERE provider='yahoo-chart' AND symbol=$1
              AND valid_time_start >= $2::timestamptz
              AND valid_time_start <= $2::timestamptz + INTERVAL '${horizon.days + 2} days'
            ORDER BY valid_time_start
            LIMIT 2
          `, [symRow.symbol, article.published_at]);

          if (prices.rows.length < 2) continue;
          const entry = Number(prices.rows[0].price);
          const exit = Number(prices.rows[1].price);
          if (entry <= 0) continue;

          const returnPct = ((exit - entry) / entry) * 100;

          await client.query(`
            INSERT INTO labeled_outcomes (article_id, theme, symbol, published_at, horizon, entry_price, exit_price, forward_return_pct, hit)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (article_id, symbol, horizon) DO NOTHING
          `, [article.article_id, article.auto_theme, symRow.symbol, article.published_at,
              horizon.name, entry, exit, returnPct, returnPct > 0]);

          labeled++;
        }
      }
      if (labeled % 1000 === 0 && labeled > 0) process.stderr.write(`  ${labeled} new outcomes labeled\n`);
    }

    const total = await client.query('SELECT COUNT(*) FROM labeled_outcomes');
    console.log(`  ${labeled} new outcomes created. Total: ${total.rows[0].count}`);
  }

  // ═══ STEP 4: 원인 설명 자동 생성 (Ollama) ═══
  if (!opts.step || opts.step === 4) {
    console.log('\n▶ STEP 4: 원인 설명 자동 생성 (Ollama LLM)...');

    // Get theme-symbol pairs without causal explanation
    const pairs = await client.query(`
      SELECT DISTINCT theme, symbol FROM auto_theme_symbols
      WHERE NOT EXISTS (
        SELECT 1 FROM event_impact_profiles e
        WHERE e.theme = auto_theme_symbols.theme
          AND e.symbol = auto_theme_symbols.symbol
          AND e.causal_explanation IS NOT NULL
      )
      ORDER BY theme, symbol
      LIMIT 30
    `);

    if (!OLLAMA_URL) {
      console.log('  Ollama URL not configured — skipping LLM explanations');
      console.log('  Set OLLAMA_API_URL and OLLAMA_CHAT_MODEL to enable');
    } else {
      console.log(`  ${pairs.rows.length} pairs need causal explanations (using ${OLLAMA_CHAT_MODEL})...`);

      for (const pair of pairs.rows) {
        // Get sample articles for context
        const samples = await client.query(`
          SELECT a.title FROM articles a
          JOIN auto_article_themes t ON t.article_id = a.id
          WHERE t.auto_theme = $1
          ORDER BY a.published_at DESC LIMIT 5
        `, [pair.theme]);
        const titles = samples.rows.map(r => r.title).join('\n');

        try {
          const chatEndpoint = OLLAMA_URL + '/api/generate';
          const prompt = `Given these news articles classified as "${pair.theme}" theme:\n${titles}\n\nExplain in ONE Korean sentence (30 words max) why the stock ${pair.symbol} would react to this type of event. Focus on the causal mechanism (supply chain, sentiment, policy impact, etc).`;

          const resp = await fetch(chatEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: OLLAMA_CHAT_MODEL, prompt, stream: false }),
            signal: AbortSignal.timeout(30000),
          });

          if (resp.ok) {
            const result = await resp.json();
            const explanation = (result.response || '').trim().slice(0, 200);
            if (explanation.length > 10) {
              await client.query(`
                UPDATE event_impact_profiles SET causal_explanation = $1
                WHERE theme = $2 AND symbol = $3 AND causal_explanation IS NULL
              `, [explanation, pair.theme, pair.symbol]);
              console.log(`  ${pair.theme} → ${pair.symbol}: ${explanation.slice(0, 60)}`);
            }
          }
        } catch {
          console.log(`  ${pair.theme} → ${pair.symbol}: LLM call failed (skipping)`);
        }
      }
    }

    // Also auto-generate trend keywords from recent article clusters
    console.log('\n  Auto-expanding trend keywords...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS auto_trend_keywords (
        id SERIAL PRIMARY KEY,
        keyword TEXT UNIQUE,
        source TEXT DEFAULT 'auto-extracted',
        article_count INTEGER DEFAULT 0,
        first_seen DATE,
        last_seen DATE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Extract frequent bigrams from recent article titles
    const recentTitles = await client.query(`
      SELECT title FROM articles
      WHERE published_at >= NOW() - INTERVAL '90 days'
      ORDER BY published_at DESC LIMIT 3000
    `);

    const bigramCounts = {};
    const stopwords = new Set(['the','and','for','are','was','has','had','but','not','its','this','that','with','from','will','have','been','more','than','what','says','after','over','about','could','their','were','they','said','would','year','also','into','first','last','live','news','new','how','why','can','may','who','all','one','two','out','now','most','just','very','some','when','which','where','being','does','make']);

    for (const row of recentTitles.rows) {
      const words = (row.title || '').toLowerCase().replace(/[^a-z\s-]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = words[i] + ' ' + words[i + 1];
        bigramCounts[bigram] = (bigramCounts[bigram] || 0) + 1;
      }
    }

    const topBigrams = Object.entries(bigramCounts)
      .filter(([, n]) => n >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    for (const [kw, count] of topBigrams) {
      await client.query(`
        INSERT INTO auto_trend_keywords (keyword, article_count, first_seen, last_seen)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (keyword) DO UPDATE SET article_count=EXCLUDED.article_count, last_seen=NOW(), updated_at=NOW()
      `, [kw, count]);
    }

    console.log(`  ${topBigrams.length} trend keywords auto-extracted`);
    console.log('  Top 10:', topBigrams.slice(0, 10).map(([k, n]) => `${k}(${n})`).join(', '));
  }

  // ═══ STEP 5: 분석 테이블 갱신 ═══
  if (!opts.step || opts.step === 5) {
    console.log('\n▶ STEP 5: 분석 테이블 갱신...');

    // Refresh stock_sensitivity_matrix with new labeled_outcomes
    await client.query(`
      INSERT INTO stock_sensitivity_matrix (theme, symbol, horizon, sample_size, avg_return, hit_rate, return_vol, sensitivity_zscore, baseline_return, baseline_vol)
      SELECT
        tr.theme, tr.symbol, tr.horizon, tr.n, tr.avg_return, tr.hit_rate, tr.return_vol,
        CASE WHEN sb.baseline_vol > 0.01 THEN (tr.avg_return - sb.baseline_return) / sb.baseline_vol ELSE 0 END,
        sb.baseline_return, sb.baseline_vol
      FROM (
        SELECT theme, symbol, horizon, COUNT(*) AS n,
               AVG(forward_return_pct::numeric) AS avg_return,
               STDDEV(forward_return_pct::numeric) AS return_vol,
               AVG(hit::int::numeric) AS hit_rate
        FROM labeled_outcomes GROUP BY theme, symbol, horizon
      ) tr
      JOIN (
        SELECT symbol, horizon,
               AVG(forward_return_pct::numeric) AS baseline_return,
               STDDEV(forward_return_pct::numeric) AS baseline_vol
        FROM labeled_outcomes GROUP BY symbol, horizon
      ) sb ON sb.symbol = tr.symbol AND sb.horizon = tr.horizon
      ON CONFLICT (theme, symbol, horizon) DO UPDATE SET
        sample_size=EXCLUDED.sample_size, avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate,
        return_vol=EXCLUDED.return_vol, sensitivity_zscore=EXCLUDED.sensitivity_zscore,
        baseline_return=EXCLUDED.baseline_return, baseline_vol=EXCLUDED.baseline_vol, updated_at=NOW()
    `);

    const sensCount = await client.query('SELECT COUNT(*) FROM stock_sensitivity_matrix');
    console.log(`  sensitivity matrix: ${sensCount.rows[0].count} entries refreshed`);
  }

  console.log('\n✅ Auto pipeline 완료');
  console.log('  다음 실행: node --import tsx scripts/auto-pipeline.mjs');
  console.log('  특정 단계만: node --import tsx scripts/auto-pipeline.mjs --step 2');
  console.log('  날짜 필터: node --import tsx scripts/auto-pipeline.mjs --since 2025-01-01');

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
