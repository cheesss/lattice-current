#!/usr/bin/env node

import pg from 'pg';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const DRY_RUN = process.argv.includes('--dry-run');
const FILE_ARG = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : null;
const FAILED_QUEUE_PATH = path.resolve('data', 'failed-proposals.json');
const DEAD_QUEUE_PATH = path.resolve('data', 'dead-proposals.json');
const RESULTS_PATH = path.resolve('data', 'executor-results.json');
const MAX_RETRIES = Math.max(1, Number(process.env.PROPOSAL_EXECUTOR_MAX_RETRIES || 2));

function getPgConfig() {
  return resolveNasPgConfig();
}

function loadJsonArray(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJsonArray(filePath, items) {
  writeFileSync(filePath, JSON.stringify(items, null, 2));
}

function proposalKey(proposal) {
  return [
    proposal.type || proposal.proposal_type || 'unknown',
    proposal._dbId || proposal.id || proposal.symbol || proposal.url || proposal.theme || proposal.name || 'anonymous',
  ].join('::');
}

function mergeUniqueProposals(...groups) {
  const merged = new Map();
  for (const proposals of groups) {
    for (const proposal of proposals || []) {
      merged.set(proposalKey(proposal), proposal);
    }
  }
  return Array.from(merged.values());
}

function loadRetryQueue() {
  return loadJsonArray(FAILED_QUEUE_PATH);
}

function saveRetryQueue(queue) {
  saveJsonArray(FAILED_QUEUE_PATH, queue);
}

function moveToDeadQueue(entry) {
  const deadQueue = loadJsonArray(DEAD_QUEUE_PATH);
  deadQueue.push({
    ...entry,
    deadAt: new Date().toISOString(),
  });
  saveJsonArray(DEAD_QUEUE_PATH, deadQueue);
}

function clearFailedProposal(proposal) {
  saveRetryQueue(loadRetryQueue().filter((entry) => proposalKey(entry) !== proposalKey(proposal)));
}

function onProposalFailed(proposal, error) {
  const queue = loadRetryQueue();
  const key = proposalKey(proposal);
  const existing = queue.find((entry) => proposalKey(entry) === key);
  if (existing) {
    existing.retryCount = Number(existing.retryCount || 0) + 1;
    existing.lastError = error;
    existing.failedAt = new Date().toISOString();
    if (existing.retryCount >= MAX_RETRIES) {
      moveToDeadQueue(existing);
      saveRetryQueue(queue.filter((entry) => proposalKey(entry) !== key));
      return { movedToDeadQueue: true, retryCount: existing.retryCount };
    }
    saveRetryQueue(queue);
    return { movedToDeadQueue: false, retryCount: existing.retryCount };
  }

  queue.push({
    ...proposal,
    retryCount: 1,
    lastError: error,
    failedAt: new Date().toISOString(),
  });
  saveRetryQueue(queue);
  return { movedToDeadQueue: false, retryCount: 1 };
}

async function ensureProposalTable(client) {
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
}

async function loadProposals(client) {
  let proposals = [];
  if (FILE_ARG) {
    const raw = JSON.parse(readFileSync(FILE_ARG, 'utf-8'));
    proposals = extractProposalsFromCodexOutput(raw);
    console.log(`Loaded ${proposals.length} proposals from ${FILE_ARG}`);
  } else {
    const pending = await client.query(
      "SELECT id, proposal_type, payload FROM codex_proposals WHERE status = 'pending' ORDER BY created_at",
    );
    proposals = pending.rows.map((row) => ({ ...row.payload, _dbId: row.id, type: row.proposal_type }));
    console.log(`Found ${proposals.length} pending proposals in DB`);
  }

  proposals = mergeUniqueProposals(loadRetryQueue(), proposals);
  if (proposals.length === 0 && existsSync('data/codex-discoveries.json')) {
    const discoveries = JSON.parse(readFileSync('data/codex-discoveries.json', 'utf-8'));
    proposals = extractProposalsFromDiscoveries(discoveries);
    console.log(`Extracted ${proposals.length} proposals from codex-discoveries.json`);
  }
  return proposals;
}

async function ensureDbIds(client, proposals) {
  for (const proposal of proposals) {
    if (proposal._dbId) continue;
    const result = await client.query(
      'INSERT INTO codex_proposals (proposal_type, payload) VALUES ($1, $2) RETURNING id',
      [proposal.type, JSON.stringify(proposal)],
    );
    proposal._dbId = result.rows[0].id;
  }
}

async function main() {
  const client = new Client(getPgConfig());
  await client.connect();

  console.log('Proposal Executor');
  await ensureProposalTable(client);

  const proposals = await loadProposals(client);
  if (proposals.length === 0) {
    console.log('No proposals to execute.');
    await client.end();
    return;
  }

  await ensureDbIds(client, proposals);

  const results = [];
  for (const proposal of proposals) {
    console.log(`\n[${proposal.type}] ${proposal.symbol || proposal.name || proposal.id || '?'}`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] Would execute:', JSON.stringify(proposal).slice(0, 200));
      results.push({ type: proposal.type, status: 'dry-run' });
      continue;
    }

    try {
      const result = await executeProposal(client, proposal);
      results.push({ type: proposal.type, status: 'success', ...result });
      clearFailedProposal(proposal);
      await client.query(
        "UPDATE codex_proposals SET status = 'executed', result = $1, executed_at = NOW() WHERE id = $2",
        [JSON.stringify(result), proposal._dbId],
      );
      console.log(`  OK ${result.summary || 'Done'}`);
    } catch (error) {
      const message = String(error?.message || error || 'proposal execution failed');
      const failure = onProposalFailed(proposal, message);
      results.push({ type: proposal.type, status: 'error', error: message, ...failure });
      await client.query(
        'UPDATE codex_proposals SET status = $1, result = $2, executed_at = NOW() WHERE id = $3',
        [
          failure.movedToDeadQueue ? 'dead' : 'failed',
          JSON.stringify({ error: message, ...failure }),
          proposal._dbId,
        ],
      );
      console.log(`  FAIL ${message} (retry ${failure.retryCount}/${MAX_RETRIES})`);
    }
  }

  const success = results.filter((row) => row.status === 'success').length;
  const failed = results.filter((row) => row.status === 'error').length;
  console.log(`\nExecution Summary: total=${results.length} success=${success} failed=${failed}`);
  writeFileSync(RESULTS_PATH, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  await client.end();
}

async function executeProposal(client, proposal) {
  switch (proposal.type) {
    case 'add-symbol': return handleAddSymbol(client, proposal);
    case 'add-rss': return handleAddRss(client, proposal);
    case 'add-theme': return handleAddTheme(client, proposal);
    case 'validate': return handleValidate(client, proposal);
    case 'remove-symbol': return handleRemoveSymbol(client, proposal);
    default: throw new Error(`Unknown proposal type: ${proposal.type}`);
  }
}

async function handleAddSymbol(client, proposal) {
  const { symbol, theme, direction } = proposal;
  if (!symbol || !theme) throw new Error('Missing symbol or theme');

  const existing = await client.query(
    "SELECT COUNT(*) n FROM worldmonitor_intel.historical_raw_items WHERE provider='yahoo-chart' AND symbol=$1",
    [symbol],
  );
  let priceCount = Number(existing.rows[0].n);

  if (priceCount === 0) {
    console.log(`  Fetching ${symbol} from Yahoo Finance...`);
    try {
      const endDate = Math.floor(Date.now() / 1000);
      const startDate = endDate - 5 * 365 * 24 * 60 * 60;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Yahoo ${response.status}`);
      const data = await response.json();
      const result = data.chart?.result?.[0];
      if (!result?.timestamp) throw new Error('No price data from Yahoo');

      const timestamps = result.timestamp;
      const closes = result.indicators?.quote?.[0]?.close || [];
      for (let index = 0; index < timestamps.length; index += 1) {
        const price = closes[index];
        if (price == null) continue;
        const ts = new Date(timestamps[index] * 1000).toISOString();
        const itemId = `yahoo-auto::yahoo-chart::${symbol}:${timestamps[index]}::${ts}::${index}`;
        await client.query(`
          INSERT INTO worldmonitor_intel.historical_raw_items
            (id, dataset_id, provider, source_kind, source_id, item_kind, valid_time_start, transaction_time, knowledge_boundary, symbol, price)
          VALUES ($1, 'yahoo-auto', 'yahoo-chart', 'market', $3, 'market', $2, $2, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [itemId, ts, symbol, price]);
      }
      priceCount = timestamps.length;
    } catch (error) {
      throw new Error(`Yahoo fetch failed for ${symbol}: ${error.message}`);
    }
  }

  await client.query(`
    INSERT INTO auto_theme_symbols (theme, symbol, avg_abs_reaction, reaction_count, correlation, method)
    VALUES ($1, $2, 0, 0, 1.0, 'codex-proposal')
    ON CONFLICT (theme, symbol) DO NOTHING
  `, [theme, symbol]);

  const articles = await client.query(`
    SELECT a.id, a.published_at
    FROM articles a
    JOIN auto_article_themes t ON t.article_id = a.id
    WHERE t.auto_theme = $1
    ORDER BY RANDOM()
    LIMIT 500
  `, [theme]);

  let outcomeCount = 0;
  for (const article of articles.rows) {
    for (const horizon of [{ name: '1w', days: 7 }, { name: '2w', days: 14 }, { name: '1m', days: 30 }]) {
      const prices = await client.query(`
        SELECT price
        FROM worldmonitor_intel.historical_raw_items
        WHERE provider='yahoo-chart' AND symbol=$1
          AND valid_time_start >= $2::timestamptz
          AND valid_time_start <= $2::timestamptz + INTERVAL '${horizon.days + 2} days'
        ORDER BY valid_time_start
        LIMIT 2
      `, [symbol, article.published_at]);
      if (prices.rows.length < 2) continue;
      const entry = Number(prices.rows[0].price);
      const exit = Number(prices.rows[1].price);
      if (entry <= 0) continue;
      const ret = ((exit - entry) / entry) * 100;

      await client.query(`
        INSERT INTO labeled_outcomes (article_id, theme, symbol, published_at, horizon, entry_price, exit_price, forward_return_pct, hit)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (article_id, symbol, horizon) DO NOTHING
      `, [article.id, theme, symbol, article.published_at, horizon.name, entry, exit, ret, ret > 0]);
      outcomeCount += 1;
    }
  }

  const sensitivity = await client.query(`
    SELECT AVG(forward_return_pct::numeric) AS avg_ret, AVG(hit::int::numeric) AS hit_rate, COUNT(*) AS n
    FROM labeled_outcomes
    WHERE theme=$1 AND symbol=$2 AND horizon='2w'
  `, [theme, symbol]);
  const hitRate = Number(sensitivity.rows[0]?.hit_rate || 0);
  const avgRet = Number(sensitivity.rows[0]?.avg_ret || 0);
  const sampleSize = Number(sensitivity.rows[0]?.n || 0);
  const validated = hitRate >= 0.45;
  if (!validated && sampleSize >= 20) {
    await client.query('DELETE FROM auto_theme_symbols WHERE theme=$1 AND symbol=$2', [theme, symbol]);
  }

  return {
    summary: `${symbol}/${theme}: ${priceCount} prices, ${outcomeCount} outcomes, hit=${(hitRate * 100).toFixed(0)}%, avg=${avgRet.toFixed(2)}%, validated=${validated}`,
    symbol,
    theme,
    direction,
    priceCount,
    outcomeCount,
    hitRate,
    avgRet,
    sampleSize,
    validated,
  };
}

async function handleAddRss(client, proposal) {
  const { url, name, theme } = proposal;
  if (!url) throw new Error('Missing RSS url');

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`RSS fetch ${response.status}`);
  const text = await response.text();

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

  let inserted = 0;
  for (const item of items.slice(0, 100)) {
    try {
      await client.query(`
        INSERT INTO articles (source, theme, published_at, title, url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [name || 'rss', theme || 'tech', item.date, item.title, item.url]);
      inserted += 1;
    } catch {
      // ignore duplicates
    }
  }

  await client.query(`
    INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
    SELECT a.id, $1, 0.5, 'rss-default'
    FROM articles a
    WHERE a.source = $2
      AND NOT EXISTS (SELECT 1 FROM auto_article_themes t WHERE t.article_id = a.id)
  `, [theme || 'tech', name || 'rss']);

  return {
    summary: `RSS ${name}: ${items.length} parsed, ${inserted} inserted`,
    feedName: name,
    url,
    articleCount: inserted,
  };
}

async function handleAddTheme(client, proposal) {
  const { id, triggers, symbols } = proposal;
  if (!id || !triggers?.length) throw new Error('Missing theme id or triggers');

  const triggerCondition = triggers.map((_, index) => `title ILIKE $${index + 1}`).join(' OR ');
  const matched = await client.query(`SELECT id FROM articles WHERE ${triggerCondition}`, triggers.map((term) => `%${term}%`));

  for (const row of matched.rows) {
    await client.query(`
      INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
      VALUES ($1, $2, 0.7, 'codex-theme-proposal')
      ON CONFLICT (article_id) DO UPDATE
      SET auto_theme = EXCLUDED.auto_theme
      WHERE auto_article_themes.confidence < 0.7
    `, [row.id, id]);
  }

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

  return {
    summary: `Theme ${id}: ${matched.rows.length} articles matched, ${symbols?.length || 0} symbols registered`,
    themeId: id,
    matchedArticles: matched.rows.length,
  };
}

async function handleValidate(client, proposal) {
  const { theme, symbol } = proposal;
  if (!theme || !symbol) throw new Error('Missing theme or symbol');

  const sensitivity = await client.query(`
    SELECT
      AVG(forward_return_pct::numeric) AS avg_ret,
      AVG(hit::int::numeric) AS hit_rate,
      STDDEV(forward_return_pct::numeric) AS vol,
      COUNT(*) AS n
    FROM labeled_outcomes
    WHERE theme=$1 AND symbol=$2 AND horizon='2w'
  `, [theme, symbol]);

  const row = sensitivity.rows[0];
  const hitRate = Number(row?.hit_rate || 0);
  const avgRet = Number(row?.avg_ret || 0);
  const n = Number(row?.n || 0);
  const sharpe = Number(row?.vol) > 0 ? (avgRet / Number(row.vol)) * Math.sqrt(26) : 0;
  const verdict = n < 20 ? 'insufficient-data' : hitRate >= 0.55 ? 'strong' : hitRate >= 0.45 ? 'marginal' : 'weak';

  if (n >= 20) {
    await client.query(`
      INSERT INTO stock_sensitivity_matrix (theme, symbol, horizon, sample_size, avg_return, hit_rate, return_vol, sensitivity_zscore, baseline_return, baseline_vol)
      VALUES ($1, $2, '2w', $3, $4, $5, $6, 0, 0, 1)
      ON CONFLICT (theme, symbol, horizon) DO UPDATE SET
        sample_size = EXCLUDED.sample_size,
        avg_return = EXCLUDED.avg_return,
        hit_rate = EXCLUDED.hit_rate,
        updated_at = NOW()
    `, [theme, symbol, n, avgRet, hitRate, Number(row?.vol || 0)]);
  }

  return {
    summary: `${theme}/${symbol}: hit=${(hitRate * 100).toFixed(0)}% avg=${avgRet.toFixed(2)}% n=${n} sharpe=${sharpe.toFixed(2)} => ${verdict}`,
    hitRate,
    avgRet,
    n,
    sharpe,
    verdict,
  };
}

async function handleRemoveSymbol(client, proposal) {
  const { theme, symbol, reason } = proposal;
  if (!theme || !symbol) throw new Error('Missing theme or symbol');

  await client.query('DELETE FROM auto_theme_symbols WHERE theme=$1 AND symbol=$2', [theme, symbol]);
  await client.query('DELETE FROM stock_sensitivity_matrix WHERE theme=$1 AND symbol=$2', [theme, symbol]);

  return {
    summary: `Removed ${symbol} from ${theme}: ${reason || 'no reason'}`,
    symbol,
    theme,
    reason,
  };
}

function extractProposalsFromCodexOutput(raw) {
  const proposals = [];
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
    for (const proposal of raw.proposals) {
      proposals.push({
        type: 'add-symbol',
        symbol: proposal.symbol,
        theme: proposal.theme,
        direction: proposal.direction,
        reason: proposal.reason,
      });
    }
  }
  return proposals;
}

function extractProposalsFromDiscoveries(discoveries) {
  const proposals = [];
  const pairs = discoveries.matrixRanking?.mostPredictiveBySensitivity || [];
  for (const pair of pairs) {
    proposals.push({ type: 'validate', theme: pair.theme, symbol: pair.symbol });
  }
  return proposals;
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
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
