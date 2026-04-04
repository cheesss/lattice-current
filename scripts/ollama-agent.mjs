#!/usr/bin/env node
/**
 * ollama-agent.mjs — 로컬 Ollama LLM 에이전트 (비용 $0)
 *
 * Ollama gemma3:4b가 직접 SQL을 생성하고, 실행하고, 결과를 분석하고,
 * 다음 쿼리를 결정하는 자율 에이전트 루프.
 *
 * Usage:
 *   node --import tsx scripts/ollama-agent.mjs                          # 기본 탐색
 *   node --import tsx scripts/ollama-agent.mjs --goal "Find new patterns in conflict events"
 *   node --import tsx scripts/ollama-agent.mjs --goal "Validate if AVGO reacts to tech events"
 *   node --import tsx scripts/ollama-agent.mjs --max-turns 5            # 최대 5턴
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const OLLAMA_URL = (process.env.OLLAMA_API_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'gemma3:4b';
const MAX_TURNS = Number(process.argv.includes('--max-turns') ? process.argv[process.argv.indexOf('--max-turns') + 1] : 8);
const GOAL = process.argv.includes('--goal') ? process.argv[process.argv.indexOf('--goal') + 1] : 'Explore the event-impact data and find non-obvious patterns. Report 3 interesting findings.';

const SYSTEM_PROMPT = `You are a data analysis agent with access to a PostgreSQL database containing event-impact data.

## Database Schema

Tables in the 'public' schema:
- articles (id, source, theme, published_at, title, summary, embedding) — 60,353 news articles
- labeled_outcomes (article_id, theme, symbol, horizon, forward_return_pct, hit) — 618,402 outcomes
- stock_sensitivity_matrix (theme, symbol, horizon, avg_return, hit_rate, sensitivity_zscore) — sensitivity
- auto_theme_symbols (theme, symbol, avg_abs_reaction, correlation) — auto-detected reactive stocks
- regime_conditional_impact (theme, symbol, regime, avg_return, hit_rate, regime_multiplier) — VIX regime
- event_hawkes_intensity (theme, event_date, hawkes_intensity, normalized_temperature, is_surge) — issue heat
- whatif_simulations (theme, symbol, direction, sharpe_ratio, hit_rate, total_return_pct) — what-if results
- conditional_sensitivity (theme, symbol, condition_type, condition_value, avg_return, hit_rate) — GDELT conditional
- event_anomalies (event_date, theme, symbol, forward_return_pct, z_score, title) — anomalous reactions
- gdelt_daily_agg (date, country, cameo_root, avg_goldstein, avg_tone, event_count) — GDELT daily
- event_impact_profiles (article_id, event_date, title, theme, symbol, forward_return_pct, hit, reaction_pattern, causal_explanation) — full profiles
- auto_article_themes (article_id, auto_theme, confidence) — auto-classified articles

Tables in 'worldmonitor_intel' schema:
- historical_raw_items (provider, symbol, price, valid_time_start) — Yahoo prices, FRED, GDELT

## Instructions
1. Generate ONE SQL query to explore the data
2. I will run it and show you the results
3. Analyze the results and decide your next step
4. Repeat until you have findings
5. When done, write "DONE:" followed by your findings in structured format

## Rules
- Use simple, readable SQL
- LIMIT results to 20 rows max
- Always cast numeric types: ::numeric or ::float
- For text searches use ILIKE
- Reference the correct schema (public vs worldmonitor_intel)`;

async function chat(messages) {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
  const result = await resp.json();
  return result.message?.content || '';
}

function extractSQL(text) {
  // Try to find SQL in code blocks
  const blockMatch = text.match(/```sql\s*([\s\S]*?)```/i) || text.match(/```\s*(SELECT[\s\S]*?)```/i);
  if (blockMatch) return blockMatch[1].trim();
  // Try to find bare SELECT statement
  const selectMatch = text.match(/(SELECT\s[\s\S]*?;)/i);
  if (selectMatch) return selectMatch[1].trim();
  return null;
}

function formatResults(rows, maxWidth = 120) {
  if (!rows || rows.length === 0) return '(no results)';
  const cols = Object.keys(rows[0]);
  let result = cols.join(' | ') + '\n' + cols.map(() => '---').join(' | ') + '\n';
  for (const row of rows.slice(0, 20)) {
    result += cols.map(c => {
      const v = row[c];
      if (v === null) return 'NULL';
      if (typeof v === 'number') return Number(v).toFixed(3);
      return String(v).slice(0, 40);
    }).join(' | ') + '\n';
  }
  return result.slice(0, 3000); // Cap at 3k chars for context
}

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log(`═══ Ollama Agent (${CHAT_MODEL}) — Local, $0 cost ═══`);
  console.log(`Goal: ${GOAL}`);
  console.log(`Max turns: ${MAX_TURNS}\n`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Goal: ${GOAL}\n\nStart by generating your first SQL query to explore the data.` },
  ];

  const findings = [];
  let turn = 0;

  while (turn < MAX_TURNS) {
    turn++;
    console.log(`\n── Turn ${turn}/${MAX_TURNS} ──`);

    // Get LLM response
    let response;
    try {
      response = await chat(messages);
    } catch (e) {
      console.log(`  LLM error: ${e.message}`);
      break;
    }

    console.log(`  LLM: ${response.slice(0, 200)}...`);
    messages.push({ role: 'assistant', content: response });

    // Check if done
    if (response.includes('DONE:')) {
      const doneIdx = response.indexOf('DONE:');
      findings.push(response.slice(doneIdx + 5).trim());
      console.log('\n  Agent signaled DONE');
      break;
    }

    // Extract and run SQL
    const sql = extractSQL(response);
    if (!sql) {
      messages.push({ role: 'user', content: 'I need a SQL query to run. Please provide one in a ```sql code block.' });
      continue;
    }

    console.log(`  SQL: ${sql.slice(0, 150)}...`);

    // Execute SQL
    let resultText;
    try {
      const result = await client.query(sql);
      resultText = `Query returned ${result.rows.length} rows:\n\n${formatResults(result.rows)}`;
      console.log(`  → ${result.rows.length} rows`);
    } catch (e) {
      resultText = `SQL Error: ${e.message}`;
      console.log(`  → Error: ${e.message.slice(0, 100)}`);
    }

    messages.push({ role: 'user', content: `${resultText}\n\nAnalyze these results. Then either:\n1. Generate another SQL query to dig deeper\n2. Write "DONE:" followed by your findings if you have enough data` });
  }

  // Final summary
  if (findings.length === 0 && messages.length > 2) {
    // Ask for summary
    messages.push({ role: 'user', content: 'Summarize your findings so far. Write "DONE:" followed by the summary.' });
    try {
      const summary = await chat(messages);
      const doneIdx = summary.indexOf('DONE:');
      findings.push(doneIdx >= 0 ? summary.slice(doneIdx + 5).trim() : summary);
    } catch { /* skip */ }
  }

  console.log('\n═══ Agent Findings ═══\n');
  for (const f of findings) console.log(f);

  // Save session
  const sessionFile = `data/ollama-agent-${Date.now()}.json`;
  writeFileSync(sessionFile, JSON.stringify({
    model: CHAT_MODEL,
    goal: GOAL,
    turns: turn,
    maxTurns: MAX_TURNS,
    timestamp: new Date().toISOString(),
    findings,
    messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 500) })),
  }, null, 2));
  console.log(`\nSession saved: ${sessionFile}`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
