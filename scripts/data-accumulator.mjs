#!/usr/bin/env node
/**
 * data-accumulator.mjs — Continuous data accumulation daemon.
 *
 * Runs in a loop, gradually collecting and importing data:
 * - Recent Yahoo prices (all theme symbols, 10 per cycle)
 * - GDELT backfill (10 days further back each cycle)
 * - Auto-imports everything into the local intelligence DB
 * - Triggers replay after each cycle so patterns accumulate
 *
 * Usage:
 *   node --import tsx scripts/data-accumulator.mjs          # continuous (every 2h)
 *   node --import tsx scripts/data-accumulator.mjs --once   # single cycle
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { loadEnvFile } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CYCLE_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const GDELT_RATE_LIMIT_MS = 6000;
const YAHOO_BATCH_SIZE = 10;
const SIDECAR_PORT = 46123;
const MAX_BACKFILL_DAYS = 365;

const runOnce = process.argv.includes('--once');
const backfillAll = process.argv.includes('--backfill-all');

// Global safety timeout — kill the process if it hangs (10 min for --once, 0 for daemon)
if (runOnce) {
  const TIMEOUT_MS = Number(process.env.SCRIPT_TIMEOUT_MS || 10 * 60 * 1000);
  setTimeout(() => {
    process.stderr.write('[data-accumulator] global timeout reached, forcing exit\n');
    process.exit(1);
  }, TIMEOUT_MS).unref();
}
const backfillDays = (() => {
  const idx = process.argv.indexOf('--days');
  return idx >= 0 ? parseInt(process.argv[idx + 1]) || 365 : 365;
})();

// Resolve project root (handle Windows drive-letter paths from import.meta.url)
const scriptDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const projectRoot = path.resolve(scriptDir, '..');

// State file to track backfill progress across restarts
const stateFile = path.join(projectRoot, 'data', 'historical', 'accumulator-state.json');

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

function loadState() {
  const defaults = {
    backfillDayOffset: 0,
    lastYahooSymbolIndex: 0,
    cycleCount: 0,
    lastRun: null,
    seedQueries: [
      { name: 'conflict', q: '(war OR conflict OR military OR troops OR missile)' },
      { name: 'economy', q: '(inflation OR recession OR GDP OR trade OR tariff)' },
      { name: 'energy', q: '(oil OR gas OR energy OR OPEC OR pipeline)' },
      { name: 'tech', q: '(semiconductor OR AI OR regulation OR cyber)' },
      { name: 'politics', q: '(election OR sanctions OR diplomacy OR summit OR protest)' },
    ],
    codexQueries: [],
    dynamicSymbols: [],
    retiredQueries: [],
    validationLog: [],
    codexHistory: [],
    limits: { maxQueries: 20, maxSymbols: 100, retireAfterDaysNoArticles: 30, codexEveryNCycles: 5 },
  };
  try {
    const loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return { ...defaults, ...loaded };
  } catch {
    return defaults;
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatGdeltDate(date) {
  return date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function safeFilename(str) {
  return str.replace(/[:.]/g, '-');
}

/**
 * POST JSON to the sidecar and return parsed response.
 */
function sidecarPost(urlPath, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: SIDECAR_PORT,
        path: urlPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

async function importToSidecar(filePath, datasetId, provider) {
  const result = await sidecarPost('/api/local-intelligence-import', {
    filePath: path.resolve(filePath),
    options: { datasetId, provider, bucketHours: 6, warmupFrameCount: 10 },
  });
  if (result?.result?.frameCount > 0) {
    console.log(`  imported ${datasetId}: ${result.result.rawRecordCount} raw -> ${result.result.frameCount} frames`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Yahoo Finance price collection
// ---------------------------------------------------------------------------

async function fetchYahooPrices(symbols, state) {
  console.log('[accumulator] fetching Yahoo prices...');

  // Merge theme symbols with Codex-discovered symbols
  const codexSymbols = (state.dynamicSymbols || []).map(s => s.symbol);
  const allSymbols = [...new Set([...symbols, ...codexSymbols])];

  // Rotate through all symbols, YAHOO_BATCH_SIZE per cycle
  const start = state.lastYahooSymbolIndex;
  const batch = allSymbols.slice(start, start + YAHOO_BATCH_SIZE);
  state.lastYahooSymbolIndex = (start + YAHOO_BATCH_SIZE) % allSymbols.length;

  let fetched = 0;
  for (const sym of batch) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1mo&interval=1d`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const quotes = data?.chart?.result?.[0];
      if (!quotes?.timestamp?.length) continue;

      const items = quotes.timestamp.map((ts, i) => ({
        id: `${sym}:${ts}`,
        sourceId: `yahoo-chart:${sym}`,
        sourceName: 'Yahoo Finance',
        validTimeStart: new Date(ts * 1000).toISOString(),
        symbol: sym,
        price: quotes.indicators?.quote?.[0]?.close?.[i] ?? 0,
        headline: `${sym} daily close`,
        link: `https://finance.yahoo.com/quote/${sym}`,
      }));

      const dir = path.join(projectRoot, 'data', 'historical', 'automation', `yahoo-${sym}`);
      fs.mkdirSync(dir, { recursive: true });
      const outPath = path.join(dir, `${safeFilename(new Date().toISOString())}.json`);
      fs.writeFileSync(
        outPath,
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          provider: 'yahoo-chart',
          envelope: { provider: 'yahoo-chart', data: { items } },
        }),
      );

      await importToSidecar(outPath, `yahoo-${sym}`, 'yahoo-chart');
      fetched++;
    } catch {
      // skip individual symbol failures
    }
  }
  console.log(`  processed ${fetched}/${batch.length} symbols (index now ${state.lastYahooSymbolIndex}/${symbols.length})`);
}

// ---------------------------------------------------------------------------
// GDELT backfill
// ---------------------------------------------------------------------------

async function fetchGdeltBackfill(state) {
  console.log(`[accumulator] GDELT backfill from -${state.backfillDayOffset} days...`);

  const queries = [
    { name: 'conflict', q: '(war OR conflict OR military OR troops OR missile)' },
    { name: 'economy', q: '(inflation OR recession OR GDP OR trade OR tariff)' },
    { name: 'energy', q: '(oil OR gas OR energy OR OPEC OR pipeline)' },
    { name: 'tech', q: '(semiconductor OR AI OR regulation OR cyber)' },
    { name: 'politics', q: '(election OR sanctions OR diplomacy OR summit OR protest)' },
  ];

  // Unfiltered global sweep — catches topics no keyword covers
  queries.push({ name: 'global-unfiltered', q: '(world OR global OR breaking OR crisis OR emergency)' });

  // Add Codex-discovered queries
  const codexQueries = (state.codexQueries || []).map(q => ({ name: q.name, q: q.q }));
  const allQueries = [...queries, ...codexQueries];

  const backfillStart = new Date(Date.now() - (state.backfillDayOffset + 10) * 86400000);
  const backfillEnd = new Date(Date.now() - state.backfillDayOffset * 86400000);

  for (const { name, q } of allQueries) {
    await sleep(GDELT_RATE_LIMIT_MS); // respect rate limits
    try {
      const params = new URLSearchParams({
        query: q + ' sourcelang:english',
        mode: 'ArtList',
        format: 'json',
        maxrecords: '250',
        startdatetime: formatGdeltDate(backfillStart),
        enddatetime: formatGdeltDate(backfillEnd),
      });
      const res = await fetch(`http://api.gdeltproject.org/api/v2/doc/doc?${params}`);
      const text = await res.text();
      let articles = [];
      try {
        articles = JSON.parse(text)?.articles || [];
      } catch {
        // GDELT sometimes returns non-JSON; skip
      }

      if (articles.length > 0) {
        const dir = path.join(projectRoot, 'data', 'historical', 'automation', `gdelt-backfill-${name}`);
        fs.mkdirSync(dir, { recursive: true });
        const outPath = path.join(dir, `${formatGdeltDate(backfillStart)}.json`);
        fs.writeFileSync(
          outPath,
          JSON.stringify({
            fetchedAt: new Date().toISOString(),
            provider: 'gdelt-doc',
            envelope: { provider: 'gdelt-doc', data: { articles } },
          }),
        );

        await importToSidecar(outPath, `gdelt-backfill-${name}`, 'gdelt-doc');
        console.log(`  ${name}: ${articles.length} articles (${formatGdeltDate(backfillStart)} -> ${formatGdeltDate(backfillEnd)})`);

        // Track article counts for Codex query lifecycle management
        const cq = (state.codexQueries || []).find(cq => cq.name === name);
        if (cq) cq.lastArticleCount = articles.length;
      } else {
        console.log(`  ${name}: no articles for window`);
        const cq = (state.codexQueries || []).find(cq => cq.name === name);
        if (cq) cq.lastArticleCount = 0;
      }
    } catch (e) {
      console.log(`  ${name}: error - ${e.message}`);
    }
  }

  // Advance backfill window
  state.backfillDayOffset += 10;
  if (state.backfillDayOffset > MAX_BACKFILL_DAYS) {
    console.log('[accumulator] backfill reached 365 days, resetting to 0');
    state.backfillDayOffset = 0;
  }
}

// ---------------------------------------------------------------------------
// Replay trigger
// ---------------------------------------------------------------------------

async function triggerReplay() {
  console.log('[accumulator] triggering replay...');
  const result = await sidecarPost('/api/local-intelligence-replay', {
    frameLoadOptions: { includeWarmup: true },
    options: { label: 'auto-accumulation' },
  });

  if (result?.run) {
    const r = result.run;
    console.log(`  replay: ${r.ideaRuns?.length || 0} ideas, ${r.forwardReturns?.length || 0} returns`);
    const pa = r.portfolioAccounting?.summary;
    if (pa) {
      console.log(`  portfolio: ${pa.totalReturnPct}% return, Sharpe ${pa.sharpeRatio}`);
    }
  } else {
    console.log('  replay: no result (sidecar may be unavailable or DB locked)');
  }
}

// ---------------------------------------------------------------------------
// Codex coverage analysis (auto-expansion)
// ---------------------------------------------------------------------------

async function runCodexAnalysis(state) {
  if (state.cycleCount % (state.limits?.codexEveryNCycles || 5) !== 0) return;

  console.log('[accumulator] running Codex coverage analysis...');

  // Check if Codex is available
  try {
    const statusRes = await fetch('http://127.0.0.1:46123/api/local-codex-status');
    const status = await statusRes.json();
    if (!status.loggedIn) {
      console.log('  Codex not logged in, skipping');
      return;
    }
  } catch {
    console.log('  Codex status check failed, skipping');
    return;
  }

  // Collect recent headlines from imported data
  const recentHeadlines = [];
  const baseDir = path.join(projectRoot, 'data', 'historical', 'automation');
  try {
    const dirs = fs.readdirSync(baseDir).filter(d => d.startsWith('gdelt-'));
    for (const dir of dirs.slice(-5)) {
      const files = fs.readdirSync(path.join(baseDir, dir)).filter(f => f.endsWith('.json')).sort().slice(-1);
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(baseDir, dir, f), 'utf8'));
          const articles = data?.envelope?.data?.articles || [];
          for (const a of articles.slice(0, 5)) {
            if (a.title) recentHeadlines.push(a.title);
          }
        } catch {}
      }
    }
  } catch {}

  // Build current query list
  const allCurrentQueries = [
    ...(state.seedQueries || []).map(q => q.name + ': ' + q.q),
    ...(state.codexQueries || []).map(q => q.name + ': ' + q.q),
  ];

  const allSymbols = [
    ...(state.dynamicSymbols || []).map(s => s.symbol),
  ];

  // Call Codex via sidecar summarize endpoint with a structured prompt
  const prompt = [
    'You are the research head of a global macro hedge fund.',
    'Return strict JSON only. No markdown.',
    '',
    'SCOPE (only these categories):',
    '- Geopolitical conflicts/tensions (wars, sanctions, territorial disputes)',
    '- Macro economic risks (inflation, rates, currency crisis)',
    '- Supply chain/commodity shocks (energy, food, minerals, semiconductors)',
    '- Technology regulation/geopolitics (AI regulation, export controls)',
    '- Financial system risks (banking crisis, credit crunch)',
    '',
    'EXCLUDE: entertainment, sports, celebrity, individual earnings, weather (unless market-moving)',
    '',
    'Currently collecting news with these queries:',
    allCurrentQueries.slice(0, 15).join('\n'),
    '',
    'Currently tracking these symbols:',
    (allSymbols.length > 0 ? allSymbols.join(', ') : '(using theme defaults)'),
    '',
    'Recent headlines collected (sample):',
    recentHeadlines.slice(0, 20).join('\n'),
    '',
    'TASKS:',
    '1. Identify 3-5 important global risks NOT covered by current queries',
    '2. For each, provide a GDELT search query and relevant symbols',
    '3. Identify any current queries that are redundant or should be removed',
    '',
    'JSON schema:',
    '{',
    '  "newIssues": [{"name":"string","gdeltQuery":"(keyword OR keyword)","symbols":[{"symbol":"string","direction":"long|short"}],"reason":"string"}],',
    '  "removeQueries": [{"name":"string","reason":"string"}],',
    '  "insights": "string"',
    '}',
  ].join('\n');

  try {
    const res = await fetch('http://127.0.0.1:46123/api/local-codex-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines: [prompt], mode: 'analysis' }),
    });
    const result = await res.json();
    const summary = result?.summary || '';

    // Try to parse JSON from Codex response
    let codexResult = null;
    try {
      // Extract JSON from response (might be wrapped in text)
      const jsonMatch = summary.match(/\{[\s\S]*\}/);
      if (jsonMatch) codexResult = JSON.parse(jsonMatch[0]);
    } catch {}

    if (codexResult?.newIssues?.length > 0) {
      console.log(`  Codex found ${codexResult.newIssues.length} new issues`);

      if (!state.codexQueries) state.codexQueries = [];
      if (!state.dynamicSymbols) state.dynamicSymbols = [];
      if (!state.validationLog) state.validationLog = [];
      if (!state.codexHistory) state.codexHistory = [];

      let accepted = 0;
      let rejected = 0;

      for (const issue of codexResult.newIssues.slice(0, 5)) {
        const name = String(issue.name || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
        const query = String(issue.gdeltQuery || '').trim();
        if (!name || !query) continue;

        // Gate 1: Scope check — must contain geopolitical/macro/supply/tech/finance keywords
        const scopeKeywords = ['war','conflict','military','sanction','trade','tariff','inflation','rate','currency','oil','gas','energy','supply','semiconductor','chip','bank','credit','debt','crisis','nuclear','missile'];
        const queryLower = query.toLowerCase();
        const inScope = scopeKeywords.some(kw => queryLower.includes(kw)) ||
          String(issue.reason || '').toLowerCase().match(/geopolit|macro|supply.chain|commodit|financial/);

        if (!inScope) {
          state.validationLog.push({ cycle: state.cycleCount, proposed: name, rejected: true, gate: 'scope', reason: 'out of scope' });
          rejected++;
          continue;
        }

        // Gate 2: Not duplicate
        const existingNames = new Set([
          ...(state.seedQueries || []).map(q => q.name),
          ...state.codexQueries.map(q => q.name),
        ]);
        if (existingNames.has(name)) {
          state.validationLog.push({ cycle: state.cycleCount, proposed: name, rejected: true, gate: 'duplicate', reason: 'already exists' });
          rejected++;
          continue;
        }

        // Gate 3: Has tradeable symbols
        const symbols = Array.isArray(issue.symbols) ? issue.symbols.filter(s => s.symbol) : [];
        if (symbols.length < 1) {
          state.validationLog.push({ cycle: state.cycleCount, proposed: name, rejected: true, gate: 'symbols', reason: 'no tradeable symbols' });
          rejected++;
          continue;
        }

        // Passed all gates — add
        if (state.codexQueries.length < (state.limits?.maxQueries || 20)) {
          state.codexQueries.push({
            name,
            q: query,
            source: 'codex-proactive',
            addedAt: new Date().toISOString(),
            addedCycle: state.cycleCount,
            lastArticleCount: 0,
          });
          accepted++;
          console.log(`    + query: ${name} = ${query}`);
        }

        // Add symbols
        for (const sym of symbols.slice(0, 3)) {
          if (state.dynamicSymbols.length < (state.limits?.maxSymbols || 100)) {
            const exists = state.dynamicSymbols.some(s => s.symbol === sym.symbol);
            if (!exists) {
              state.dynamicSymbols.push({
                symbol: sym.symbol,
                direction: sym.direction || 'long',
                reason: `${name}: ${issue.reason || ''}`.slice(0, 200),
                source: 'codex-proactive',
                addedAt: new Date().toISOString(),
              });
              console.log(`    + symbol: ${sym.symbol} (${sym.direction || 'long'})`);
            }
          }
        }
      }

      // Handle remove recommendations
      if (codexResult.removeQueries?.length > 0) {
        for (const rem of codexResult.removeQueries) {
          const idx = state.codexQueries.findIndex(q => q.name === rem.name);
          if (idx >= 0) {
            const removed = state.codexQueries.splice(idx, 1)[0];
            if (!state.retiredQueries) state.retiredQueries = [];
            state.retiredQueries.push({ ...removed, retiredAt: new Date().toISOString(), reason: rem.reason || 'codex recommended removal', canRevive: true });
            console.log(`    - removed query: ${rem.name}`);
          }
        }
      }

      state.codexHistory.push({
        cycle: state.cycleCount,
        type: 'proactive',
        issuesFound: codexResult.newIssues.length,
        queriesAccepted: accepted,
        queriesRejected: rejected,
        symbolsAdded: codexResult.newIssues.reduce((s, i) => s + (i.symbols?.length || 0), 0),
        insights: codexResult.insights || '',
      });

      if (codexResult.insights) {
        console.log(`  Codex insight: ${codexResult.insights.substring(0, 150)}`);
      }
    } else {
      console.log('  Codex returned no actionable issues');
    }
  } catch (e) {
    console.log('  Codex analysis error:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Query/symbol lifecycle management
// ---------------------------------------------------------------------------

function manageQueryLifecycle(state) {
  if (!state.codexQueries) return;
  if (!state.retiredQueries) state.retiredQueries = [];

  const now = Date.now();
  const retireAfterMs = (state.limits?.retireAfterDaysNoArticles || 30) * 86400000;

  // Retire queries with no articles for 30 days
  state.codexQueries = state.codexQueries.filter(q => {
    if (q.lastArticleCount > 0) return true; // Has articles, keep
    const addedAt = Date.parse(q.addedAt);
    if (now - addedAt < retireAfterMs) return true; // Too new to judge
    // Retire
    state.retiredQueries.push({ ...q, retiredAt: new Date().toISOString(), reason: 'no articles for 30+ days', canRevive: true });
    console.log(`  retired query: ${q.name} (no articles)`);
    return false;
  });

  // Cap at maxQueries
  const maxQ = state.limits?.maxQueries || 20;
  while (state.codexQueries.length > maxQ) {
    const oldest = state.codexQueries.shift();
    state.retiredQueries.push({ ...oldest, retiredAt: new Date().toISOString(), reason: 'exceeded max queries', canRevive: true });
  }

  // Cap symbols
  const maxS = state.limits?.maxSymbols || 100;
  if (state.dynamicSymbols?.length > maxS) {
    state.dynamicSymbols = state.dynamicSymbols.slice(-maxS);
  }

  // Keep retired list manageable
  if (state.retiredQueries.length > 50) {
    state.retiredQueries = state.retiredQueries.slice(-50);
  }
}

// ---------------------------------------------------------------------------
// Main cycle
// ---------------------------------------------------------------------------

async function runCycle() {
  const state = loadState();
  state.cycleCount++;
  state.lastRun = new Date().toISOString();
  console.log(`\n========== Accumulation Cycle #${state.cycleCount} ==========`);
  console.log(`Time: ${state.lastRun}`);

  // Load symbols dynamically from the project constants
  let symbols = [];
  try {
    const { THEME_RULES, UNIVERSE_ASSET_CATALOG } = await import('../src/services/investment/constants.ts');
    const symSet = new Set();
    for (const theme of THEME_RULES) {
      for (const asset of theme.assets) {
        if (!asset.symbol.startsWith('^')) symSet.add(asset.symbol);
      }
    }
    for (const asset of UNIVERSE_ASSET_CATALOG) {
      if (!asset.symbol.startsWith('^')) symSet.add(asset.symbol);
    }
    symbols = [...symSet];
  } catch (e) {
    console.log('  could not load theme symbols, using fallback set:', e.message);
    symbols = ['SPY', 'QQQ', 'XLE', 'GLD', 'TLT', 'ITA', 'USO', 'SMH', 'EWJ', 'INDA'];
  }

  // Step 1: Recent Yahoo prices
  await fetchYahooPrices(symbols, state);

  // Step 2: GDELT backfill (advances 10 days further back each cycle)
  await fetchGdeltBackfill(state);

  // Step 3: FRED macro series (every 10 cycles ≈ 20 hours)
  if (state.cycleCount % 10 === 1) {
    const fredApiKey = process.env.FRED_API_KEY || '';
    if (fredApiKey) {
      console.log('[accumulator] FRED macro series update...');
      const fredIds = ['CPIAUCSL','FEDFUNDS','UNRATE','T10Y2Y','DTWEXBGS','BAMLH0A0HYM2','VIXCLS','DGS10','DCOILWTICO'];
      const startDate = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      for (const seriesId of fredIds) {
        try {
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fredApiKey}&file_type=json&observation_start=${startDate}`;
          const res = await fetch(url);
          const data = await res.json();
          const observations = (data?.observations || []).filter(o => o.value !== '.');
          if (observations.length > 0) {
            const items = observations.map(o => ({
              id: `${seriesId}:${o.date}`, sourceId: `fred:${seriesId}`, sourceName: `FRED`,
              validTimeStart: `${o.date}T00:00:00.000Z`, symbol: seriesId, price: parseFloat(o.value),
              headline: `${seriesId}: ${o.value}`,
            }));
            const dir = path.join(projectRoot, 'data', 'historical', 'automation', `fred-${seriesId.toLowerCase()}`);
            fs.mkdirSync(dir, { recursive: true });
            const outPath = path.join(dir, `cycle-${state.cycleCount}.json`);
            fs.writeFileSync(outPath, JSON.stringify({
              fetchedAt: new Date().toISOString(), provider: 'fred',
              envelope: { provider: 'fred', data: { items, observations } },
            }));
            await importToSidecar(outPath, `fred-${seriesId.toLowerCase()}`, 'fred');
          }
        } catch {}
      }
      console.log('  FRED update complete');
    }
  }

  // Step 4: Replay so accumulated data feeds back into the system
  await triggerReplay();

  // Step 5: Codex coverage analysis (every 5 cycles)
  await runCodexAnalysis(state);

  // Step 6: Query/symbol lifecycle management
  manageQueryLifecycle(state);

  saveState(state);
  console.log(`========== Cycle #${state.cycleCount} complete, next backfill: -${state.backfillDayOffset} days ==========\n`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log('[data-accumulator] starting');
  console.log('  project root: ' + projectRoot);

  if (backfillAll) {
    // Fast backfill mode: collect as much past data as possible in one run
    console.log(`  mode: BACKFILL ALL (${backfillDays} days, ~${Math.ceil(backfillDays / 10)} windows)`);
    const state = loadState();

    // Load symbols once
    let symbols = [];
    try {
      const { THEME_RULES, UNIVERSE_ASSET_CATALOG } = await import('../src/services/investment/constants.ts');
      const symSet = new Set();
      for (const theme of THEME_RULES) for (const a of theme.assets) if (!a.symbol.startsWith('^')) symSet.add(a.symbol);
      for (const a of UNIVERSE_ASSET_CATALOG) if (!a.symbol.startsWith('^')) symSet.add(a.symbol);
      symbols = [...symSet];
    } catch { symbols = ['SPY','XLE','GLD','TLT','ITA','USO','SMH']; }

    // Yahoo: fetch all symbols with max range
    console.log(`\n[backfill] Yahoo: ${symbols.length} symbols (1y daily)...`);
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1y&interval=1d`;
        const res = await fetch(url);
        const data = await res.json();
        const quotes = data?.chart?.result?.[0];
        if (!quotes?.timestamp?.length) continue;
        const items = quotes.timestamp.map((ts, idx) => ({
          id: `${sym}:${ts}`,
          sourceId: `yahoo-chart:${sym}`,
          sourceName: 'Yahoo Finance',
          validTimeStart: new Date(ts * 1000).toISOString(),
          symbol: sym,
          price: quotes.indicators?.quote?.[0]?.close?.[idx] ?? 0,
          headline: `${sym} price`,
          link: `https://finance.yahoo.com/quote/${sym}`,
        }));
        const dir = path.join(projectRoot, 'data', 'historical', 'automation', `yahoo-${sym}`);
        fs.mkdirSync(dir, { recursive: true });
        const outPath = path.join(dir, `backfill-1y.json`);
        fs.writeFileSync(outPath, JSON.stringify({
          fetchedAt: new Date().toISOString(),
          provider: 'yahoo-chart',
          envelope: { provider: 'yahoo-chart', data: { items } },
        }));
        await importToSidecar(outPath, `yahoo-${sym}`, 'yahoo-chart');
        if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${symbols.length} symbols done`);
      } catch {}
    }
    console.log(`  Yahoo complete: ${symbols.length} symbols`);

    // GDELT: sweep all windows from now back to backfillDays
    const queries = [
      { name: 'conflict', q: '(war OR conflict OR military OR troops OR missile)' },
      { name: 'economy', q: '(inflation OR recession OR GDP OR trade OR tariff)' },
      { name: 'energy', q: '(oil OR gas OR energy OR OPEC OR pipeline)' },
      { name: 'tech', q: '(semiconductor OR AI OR regulation OR cyber)' },
      { name: 'politics', q: '(election OR sanctions OR diplomacy OR summit OR protest)' },
    ];
    // Unfiltered global sweep — catches topics no keyword covers
    queries.push({ name: 'global-unfiltered', q: '(world OR global OR breaking OR crisis OR emergency)' });
    const totalWindows = Math.ceil(backfillDays / 10);
    console.log(`\n[backfill] GDELT: ${queries.length} categories × ${totalWindows} windows (${backfillDays} days)...`);
    let totalArticles = 0;

    for (let offset = 0; offset < backfillDays; offset += 10) {
      const windowStart = new Date(Date.now() - (offset + 10) * 86400000);
      const windowEnd = new Date(Date.now() - offset * 86400000);
      const windowLabel = formatGdeltDate(windowStart).slice(0, 8);

      for (const { name, q } of queries) {
        await sleep(GDELT_RATE_LIMIT_MS);
        try {
          const params = new URLSearchParams({
            query: q + ' sourcelang:english',
            mode: 'ArtList', format: 'json', maxrecords: '250',
            startdatetime: formatGdeltDate(windowStart),
            enddatetime: formatGdeltDate(windowEnd),
          });
          const res = await fetch(`http://api.gdeltproject.org/api/v2/doc/doc?${params}`);
          const text = await res.text();
          let articles = [];
          try { articles = JSON.parse(text)?.articles || []; } catch {}

          if (articles.length > 0) {
            const dir = path.join(projectRoot, 'data', 'historical', 'automation', `gdelt-backfill-${name}`);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${windowLabel}.json`), JSON.stringify({
              fetchedAt: new Date().toISOString(),
              provider: 'gdelt-doc',
              envelope: { provider: 'gdelt-doc', data: { articles } },
            }));
            await importToSidecar(path.join(dir, `${windowLabel}.json`), `gdelt-backfill-${name}`, 'gdelt-doc');
            totalArticles += articles.length;
          }
        } catch {}
      }
      const progress = Math.round((offset / backfillDays) * 100);
      console.log(`  window ${windowLabel}: ${progress}% done (${totalArticles} articles total)`);
    }
    // FRED macro series
    const fredSeries = [
      { id: 'CPIAUCSL', name: 'CPI' },
      { id: 'FEDFUNDS', name: 'Fed Funds Rate' },
      { id: 'UNRATE', name: 'Unemployment' },
      { id: 'T10Y2Y', name: 'Yield Curve' },
      { id: 'DTWEXBGS', name: 'Dollar Index' },
      { id: 'BAMLH0A0HYM2', name: 'HY Spread' },
      { id: 'VIXCLS', name: 'VIX' },
      { id: 'DGS10', name: '10Y Treasury' },
      { id: 'DCOILWTICO', name: 'WTI Crude' },
    ];
    const fredApiKey = process.env.FRED_API_KEY || '';
    if (fredApiKey) {
      console.log(`\n[backfill] FRED: ${fredSeries.length} macro series...`);
      const startDate = new Date(Date.now() - backfillDays * 86400000).toISOString().slice(0, 10);
      for (const series of fredSeries) {
        try {
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${fredApiKey}&file_type=json&observation_start=${startDate}`;
          const res = await fetch(url);
          const data = await res.json();
          const observations = data?.observations || [];
          if (observations.length > 0) {
            const items = observations
              .filter(o => o.value !== '.')
              .map(o => ({
                id: `${series.id}:${o.date}`,
                sourceId: `fred:${series.id}`,
                sourceName: `FRED ${series.name}`,
                validTimeStart: `${o.date}T00:00:00.000Z`,
                symbol: series.id,
                price: parseFloat(o.value),
                headline: `${series.name}: ${o.value}`,
              }));
            const dir = path.join(projectRoot, 'data', 'historical', 'automation', `fred-${series.id.toLowerCase()}`);
            fs.mkdirSync(dir, { recursive: true });
            const outPath = path.join(dir, `backfill.json`);
            fs.writeFileSync(outPath, JSON.stringify({
              fetchedAt: new Date().toISOString(),
              provider: 'fred',
              envelope: { provider: 'fred', data: { items, observations } },
            }));
            await importToSidecar(outPath, `fred-${series.id.toLowerCase()}`, 'fred');
            console.log(`  ${series.name} (${series.id}): ${items.length} observations`);
          }
        } catch (e) {
          console.log(`  ${series.name}: error - ${e.message}`);
        }
      }
    } else {
      console.log('\n[backfill] FRED: skipped (no FRED_API_KEY in env)');
    }

    console.log(`\n[backfill] complete: ${totalArticles} GDELT articles + ${symbols.length} Yahoo symbols + ${fredApiKey ? fredSeries.length : 0} FRED series`);

    // Run replay once at the end
    await triggerReplay();

    // After GDELT + FRED backfill, run one Codex analysis
    state.cycleCount = 5; // Force Codex to run (every 5 cycles check)
    await runCodexAnalysis(state);
    manageQueryLifecycle(state);

    state.backfillDayOffset = backfillDays;
    state.cycleCount++;
    state.lastRun = new Date().toISOString();
    saveState(state);
    return;
  }

  console.log('  mode: ' + (runOnce ? 'single cycle' : `continuous (every ${CYCLE_INTERVAL_MS / 60000} min)`));

  await runCycle();

  if (!runOnce) {
    setInterval(() => runCycle(), CYCLE_INTERVAL_MS);
    console.log('[data-accumulator] daemon running, Ctrl+C to stop');
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
