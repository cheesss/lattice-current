#!/usr/bin/env node
/**
 * proposal-executor.mjs — Codex 제안을 자동으로 실행하는 Executor
 *
 * Codex가 제안한 종목/데이터소스/테마를 읽고, 타입에 따라 동적으로:
 *   - Yahoo 가격 수집
 *   - RSS 파싱 + 기사 저장
 *   - 테마 등록
 *   - labeled_outcomes 생성
 *   - 민감도 검증
 *   - 검증 실패 시 제거
 *
 * Usage:
 *   node --import tsx scripts/proposal-executor.mjs                          # DB에서 미실행 제안 처리
 *   node --import tsx scripts/proposal-executor.mjs --file data/codex-discoveries.json  # 파일에서 읽기
 *   node --import tsx scripts/proposal-executor.mjs --dry-run                # 실행 없이 계획만 출력
 */

import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();
const DRY_RUN = process.argv.includes('--dry-run');
const FILE_ARG = process.argv.includes('--file') ? process.argv[process.argv.indexOf('--file') + 1] : null;

// ═══════════════════════════════════════════════════════════
// Proposal Schema
// ═══════════════════════════════════════════════════════════

/*
Proposals are JSON objects with a "type" field:

{ "type": "add-symbol", "symbol": "AVGO", "theme": "tech", "direction": "long", "reason": "..." }
{ "type": "add-rss", "url": "https://...", "name": "arXiv AI", "theme": "tech" }
{ "type": "add-theme", "id": "quantum-computing", "label": "...", "triggers": [...], "symbols": [...] }
{ "type": "validate", "theme": "tech", "symbol": "AVGO" }
{ "type": "remove-symbol", "theme": "tech", "symbol": "AAL", "reason": "hit rate too low" }
*/

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log('═══ Proposal Executor ═══\n');

  // Ensure proposals table
  await client.query(`
    CREATE TABLE IF NOT EXISTS codex_proposals (
      id SERIAL PRIMARY KEY,
      proposal_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT DEFAULT 'pending',
      result JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    )
  `);

  // Load proposals
  let proposals = [];

  if (FILE_ARG) {
    // Load from file (Codex output)
    const raw = JSON.parse(readFileSync(FILE_ARG, 'utf-8'));
    proposals = extractProposalsFromCodexOutput(raw);
    console.log(`Loaded ${proposals.length} proposals from ${FILE_ARG}`);
  } else {
    // Load pending from DB
    const pending = await client.query("SELECT id, proposal_type, payload FROM codex_proposals WHERE status = 'pending' ORDER BY created_at");
    proposals = pending.rows.map(r => ({ ...r.payload, _dbId: r.id, type: r.proposal_type }));
    console.log(`Found ${proposals.length} pending proposals in DB`);
  }

  if (proposals.length === 0) {
    // Check for Codex discoveries to convert
    if (existsSync('data/codex-discoveries.json')) {
      const discoveries = JSON.parse(readFileSync('data/codex-discoveries.json', 'utf-8'));
      proposals = extractProposalsFromDiscoveries(discoveries);
      console.log(`Extracted ${proposals.length} proposals from codex-discoveries.json`);
    }
  }

  if (proposals.length === 0) {
    console.log('No proposals to execute.');
    await client.end();
    return;
  }

  // Save to DB if loaded from file
  for (const p of proposals) {
    if (!p._dbId) {
      const r = await client.query(
        "INSERT INTO codex_proposals (proposal_type, payload) VALUES ($1, $2) RETURNING id",
        [p.type, JSON.stringify(p)]
      );
      p._dbId = r.rows[0].id;
    }
  }

  // Execute each proposal
  const results = [];
  for (const proposal of proposals) {
    console.log(`\n▶ [${proposal.type}] ${proposal.symbol || proposal.name || proposal.id || '?'}`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] Would execute:', JSON.stringify(proposal).slice(0, 200));
      results.push({ type: proposal.type, status: 'dry-run' });
      continue;
    }

    try {
      const result = await executeProposal(client, proposal);
      results.push({ type: proposal.type, status: 'success', ...result });

      await client.query(
        "UPDATE codex_proposals SET status = 'executed', result = $1, executed_at = NOW() WHERE id = $2",
        [JSON.stringify(result), proposal._dbId]
      );
      console.log(`  ✅ ${result.summary || 'Done'}`);
    } catch (e) {
      results.push({ type: proposal.type, status: 'error', error: e.message });
      await client.query(
        "UPDATE codex_proposals SET status = 'failed', result = $1, executed_at = NOW() WHERE id = $2",
        [JSON.stringify({ error: e.message }), proposal._dbId]
      );
      console.log(`  ❌ ${e.message}`);
    }
  }

  // Summary
  console.log('\n═══ Execution Summary ═══');
  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  console.log(`  Total: ${results.length}, Success: ${success}, Failed: ${failed}`);

  // Save results
  writeFileSync('data/executor-results.json', JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  await client.end();
}

// ═══════════════════════════════════════════════════════════
// Handlers — one per proposal type
// ═══════════════════════════════════════════════════════════

async function executeProposal(client, proposal) {
  switch (proposal.type) {
    case 'add-symbol': return await handleAddSymbol(client, proposal);
    case 'add-rss': return await handleAddRss(client, proposal);
    case 'add-theme': return await handleAddTheme(client, proposal);
    case 'validate': return await handleValidate(client, proposal);
    case 'remove-symbol': return await handleRemoveSymbol(client, proposal);
    default: throw new Error(`Unknown proposal type: ${proposal.type}`);
  }
}

// ── add-symbol: Yahoo 가격 수집 + outcome 생성 + 검증 ──

async function handleAddSymbol(client, proposal) {
  const { symbol, theme, direction } = proposal;
  if (!symbol || !theme) throw new Error('Missing symbol or theme');

  // 1. Check if Yahoo price data exists
  const existing = await client.query(
    "SELECT COUNT(*) n FROM worldmonitor_intel.historical_raw_items WHERE provider='yahoo-chart' AND symbol=$1",
    [symbol]
  );

  let priceCount = Number(existing.rows[0].n);

  if (priceCount === 0) {
    // 2. Fetch from Yahoo Finance (last 5 years)
    console.log(`  Fetching ${symbol} from Yahoo Finance...`);
    try {
      const endDate = Math.floor(Date.now() / 1000);
      const startDate = endDate - 5 * 365 * 24 * 60 * 60;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`Yahoo ${resp.status}`);
      const data = await resp.json();
      const result = data.chart?.result?.[0];
      if (!result?.timestamp) throw new Error('No price data from Yahoo');

      const timestamps = result.timestamp;
      const closes = result.indicators?.quote?.[0]?.close || [];

      // Insert into NAS (id is a composite text key)
      for (let i = 0; i < timestamps.length; i++) {
        const price = closes[i];
        if (price == null) continue;
        const ts = new Date(timestamps[i] * 1000).toISOString();
        const itemId = `yahoo-auto::yahoo-chart::${symbol}:${timestamps[i]}::${ts}::${i}`;
        await client.query(
          `INSERT INTO worldmonitor_intel.historical_raw_items
           (id, dataset_id, provider, source_kind, source_id, item_kind, valid_time_start, transaction_time, knowledge_boundary, symbol, price)
           VALUES ($1, 'yahoo-auto', 'yahoo-chart', 'market', $3, 'market', $2, $2, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [itemId, ts, symbol, price]
        );
      }
      priceCount = timestamps.length;
      console.log(`  Fetched ${priceCount} price points for ${symbol}`);
    } catch (e) {
      throw new Error(`Yahoo fetch failed for ${symbol}: ${e.message}`);
    }
  } else {
    console.log(`  ${symbol} already has ${priceCount} price points`);
  }

  // 3. Register in auto_theme_symbols
  await client.query(`
    INSERT INTO auto_theme_symbols (theme, symbol, avg_abs_reaction, reaction_count, correlation, method)
    VALUES ($1, $2, 0, 0, 1.0, 'codex-proposal')
    ON CONFLICT (theme, symbol) DO NOTHING
  `, [theme, symbol]);

  // 4. Generate labeled_outcomes
  const articles = await client.query(`
    SELECT a.id, a.published_at FROM articles a
    JOIN auto_article_themes t ON t.article_id = a.id
    WHERE t.auto_theme = $1 ORDER BY RANDOM() LIMIT 500
  `, [theme]);

  let outcomeCount = 0;
  for (const art of articles.rows) {
    for (const horizon of [{ name: '1w', days: 7 }, { name: '2w', days: 14 }, { name: '1m', days: 30 }]) {
      const prices = await client.query(`
        SELECT price FROM worldmonitor_intel.historical_raw_items
        WHERE provider='yahoo-chart' AND symbol=$1
          AND valid_time_start >= $2::timestamptz
          AND valid_time_start <= $2::timestamptz + INTERVAL '${horizon.days + 2} days'
        ORDER BY valid_time_start LIMIT 2
      `, [symbol, art.published_at]);

      if (prices.rows.length < 2) continue;
      const entry = Number(prices.rows[0].price);
      const exit = Number(prices.rows[1].price);
      if (entry <= 0) continue;
      const ret = ((exit - entry) / entry) * 100;

      await client.query(`
        INSERT INTO labeled_outcomes (article_id, theme, symbol, published_at, horizon, entry_price, exit_price, forward_return_pct, hit)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (article_id, symbol, horizon) DO NOTHING
      `, [art.id, theme, symbol, art.published_at, horizon.name, entry, exit, ret, ret > 0]);
      outcomeCount++;
    }
  }

  // 5. Compute sensitivity
  const sens = await client.query(`
    SELECT AVG(forward_return_pct::numeric) as avg_ret, AVG(hit::int::numeric) as hit_rate, COUNT(*) as n
    FROM labeled_outcomes WHERE theme=$1 AND symbol=$2 AND horizon='2w'
  `, [theme, symbol]);

  const hitRate = Number(sens.rows[0]?.hit_rate || 0);
  const avgRet = Number(sens.rows[0]?.avg_ret || 0);
  const sampleSize = Number(sens.rows[0]?.n || 0);

  // 6. Auto-remove if hit rate < 45%
  const validated = hitRate >= 0.45;
  if (!validated && sampleSize >= 20) {
    await client.query("DELETE FROM auto_theme_symbols WHERE theme=$1 AND symbol=$2", [theme, symbol]);
    console.log(`  Removed ${symbol}: hit ${(hitRate * 100).toFixed(0)}% < 45% threshold`);
  }

  return {
    summary: `${symbol}/${theme}: ${priceCount} prices, ${outcomeCount} outcomes, hit=${(hitRate * 100).toFixed(0)}%, avg=${avgRet.toFixed(2)}%, validated=${validated}`,
    symbol, theme, direction, priceCount, outcomeCount, hitRate, avgRet, sampleSize, validated,
  };
}

// ── add-rss: RSS 파싱 + articles 저장 + 임베딩 ──

async function handleAddRss(client, proposal) {
  const { url, name, theme } = proposal;
  if (!url) throw new Error('Missing RSS url');

  console.log(`  Fetching RSS: ${url}`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`RSS fetch ${resp.status}`);
  const text = await resp.text();

  // Simple XML parsing for <item> or <entry>
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    const content = match[1] || match[2] || '';
    const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    const link = content.match(/<link[^>]*href="([^"]*)"[^>]*\/?>|<link[^>]*>([\s\S]*?)<\/link>/i);
    const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>|<published>([\s\S]*?)<\/published>|<updated>([\s\S]*?)<\/updated>/i);
    if (title) {
      items.push({
        title: title.slice(0, 500),
        url: (link?.[1] || link?.[2] || '').trim(),
        date: pubDate ? new Date(pubDate[1] || pubDate[2] || pubDate[3]).toISOString() : new Date().toISOString(),
      });
    }
  }

  console.log(`  Parsed ${items.length} articles from RSS`);

  let inserted = 0;
  for (const item of items.slice(0, 100)) {
    try {
      await client.query(`
        INSERT INTO articles (source, theme, published_at, title, url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [name || 'rss', theme || 'tech', item.date, item.title, item.url]);
      inserted++;
    } catch { /* skip duplicates */ }
  }

  // Auto-classify new articles
  await client.query(`
    INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
    SELECT a.id, $1, 0.5, 'rss-default'
    FROM articles a WHERE a.source = $2
      AND NOT EXISTS (SELECT 1 FROM auto_article_themes t WHERE t.article_id = a.id)
  `, [theme || 'tech', name || 'rss']);

  return { summary: `RSS ${name}: ${items.length} parsed, ${inserted} inserted`, feedName: name, url, articleCount: inserted };
}

// ── add-theme: 테마 등록 + 키워드 매칭 ──

async function handleAddTheme(client, proposal) {
  const { id, label, triggers, symbols } = proposal;
  if (!id || !triggers?.length) throw new Error('Missing theme id or triggers');

  // Match existing articles to this theme
  const triggerCondition = triggers.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
  const matched = await client.query(`
    SELECT id FROM articles WHERE ${triggerCondition}
  `, triggers.map(t => `%${t}%`));

  // Register in auto_article_themes
  for (const row of matched.rows) {
    await client.query(`
      INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
      VALUES ($1, $2, 0.7, 'codex-theme-proposal')
      ON CONFLICT (article_id) DO UPDATE SET auto_theme=EXCLUDED.auto_theme WHERE auto_article_themes.confidence < 0.7
    `, [row.id, id]);
  }

  // Register symbols
  if (symbols?.length) {
    for (const sym of symbols) {
      const symbol = typeof sym === 'string' ? sym : sym.symbol;
      if (!symbol) continue;
      await client.query(`
        INSERT INTO auto_theme_symbols (theme, symbol, avg_abs_reaction, reaction_count, correlation, method)
        VALUES ($1, $2, 0, 0, 1.0, 'codex-theme-proposal')
        ON CONFLICT (theme, symbol) DO NOTHING
      `, [id, symbol]);
    }
  }

  return { summary: `Theme ${id}: ${matched.rows.length} articles matched, ${symbols?.length || 0} symbols registered`, themeId: id, matchedArticles: matched.rows.length };
}

// ── validate: 특정 테마-종목 쌍 검증 ──

async function handleValidate(client, proposal) {
  const { theme, symbol } = proposal;
  if (!theme || !symbol) throw new Error('Missing theme or symbol');

  const sens = await client.query(`
    SELECT AVG(forward_return_pct::numeric) as avg_ret, AVG(hit::int::numeric) as hit_rate,
           STDDEV(forward_return_pct::numeric) as vol, COUNT(*) as n
    FROM labeled_outcomes WHERE theme=$1 AND symbol=$2 AND horizon='2w'
  `, [theme, symbol]);

  const r = sens.rows[0];
  const hitRate = Number(r?.hit_rate || 0);
  const avgRet = Number(r?.avg_ret || 0);
  const n = Number(r?.n || 0);
  const sharpe = Number(r?.vol) > 0 ? (avgRet / Number(r.vol)) * Math.sqrt(26) : 0;

  const verdict = n < 20 ? 'insufficient-data' : hitRate >= 0.55 ? 'strong' : hitRate >= 0.45 ? 'marginal' : 'weak';

  // Update sensitivity matrix
  if (n >= 20) {
    await client.query(`
      INSERT INTO stock_sensitivity_matrix (theme, symbol, horizon, sample_size, avg_return, hit_rate, return_vol, sensitivity_zscore, baseline_return, baseline_vol)
      VALUES ($1, $2, '2w', $3, $4, $5, $6, 0, 0, 1)
      ON CONFLICT (theme, symbol, horizon) DO UPDATE SET
        sample_size=EXCLUDED.sample_size, avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate, updated_at=NOW()
    `, [theme, symbol, n, avgRet, hitRate, Number(r?.vol || 0)]);
  }

  return { summary: `${theme}/${symbol}: hit=${(hitRate * 100).toFixed(0)}% avg=${avgRet.toFixed(2)}% n=${n} sharpe=${sharpe.toFixed(2)} → ${verdict}`, hitRate, avgRet, n, sharpe, verdict };
}

// ── remove-symbol: DB에서 제거 ──

async function handleRemoveSymbol(client, proposal) {
  const { theme, symbol, reason } = proposal;
  if (!theme || !symbol) throw new Error('Missing theme or symbol');

  await client.query("DELETE FROM auto_theme_symbols WHERE theme=$1 AND symbol=$2", [theme, symbol]);
  await client.query("DELETE FROM stock_sensitivity_matrix WHERE theme=$1 AND symbol=$2", [theme, symbol]);

  return { summary: `Removed ${symbol} from ${theme}: ${reason || 'no reason'}`, symbol, theme, reason };
}

// ═══════════════════════════════════════════════════════════
// Proposal Extractors
// ═══════════════════════════════════════════════════════════

function extractProposalsFromCodexOutput(raw) {
  const proposals = [];

  // From codex-from-analysis.mjs output (themes + candidates)
  if (raw.themes) {
    for (const theme of raw.themes) {
      proposals.push({
        type: 'add-theme',
        id: theme.id,
        label: theme.label,
        triggers: theme.triggers || [],
        symbols: theme.assets || [],
      });
    }
  }
  if (raw.proposals) {
    for (const p of raw.proposals) {
      proposals.push({
        type: 'add-symbol',
        symbol: p.symbol,
        theme: p.theme,
        direction: p.direction,
        reason: p.reason,
      });
    }
  }
  return proposals;
}

function extractProposalsFromDiscoveries(discoveries) {
  const proposals = [];

  // Extract validation proposals from discovered patterns
  const pairs = discoveries.matrixRanking?.mostPredictiveBySensitivity || [];
  for (const pair of pairs) {
    proposals.push({ type: 'validate', theme: pair.theme, symbol: pair.symbol });
  }

  return proposals;
}

main().catch(e => { console.error(e); process.exit(1); });
