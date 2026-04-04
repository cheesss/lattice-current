#!/usr/bin/env node
/**
 * codex-agent.mjs — Codex를 에이전트로 실행 (도구 부여)
 *
 * Codex가 직접 DB 조회, 종목 검증, 데이터 수집을 수행합니다.
 * --sandbox workspace-write로 실행하여 스크립트 실행 권한 부여.
 *
 * Usage:
 *   node --import tsx scripts/codex-agent.mjs                    # 기본 탐색 모드
 *   node --import tsx scripts/codex-agent.mjs --task discover    # 새 패턴 발견
 *   node --import tsx scripts/codex-agent.mjs --task validate    # 제안 종목 검증
 *   node --import tsx scripts/codex-agent.mjs --task expand      # 새 데이터소스 추가
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { loadOptionalEnvFile } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const TASK = process.argv.includes('--task') ? process.argv[process.argv.indexOf('--task') + 1] : 'discover';

const SYSTEM_CONTEXT = `You are an autonomous event-impact research agent with direct access to:

## Available Tools (run these via shell)

### Database Queries
- \`node --import tsx scripts/query-event-impact.mjs stock <SYMBOL>\` — Get stock event reaction profile
- \`node --import tsx scripts/query-event-impact.mjs event "<keyword>"\` — Search events by keyword
- \`node --import tsx scripts/query-event-impact.mjs sensitivity\` — Full sensitivity matrix
- \`node --import tsx scripts/query-event-impact.mjs explain <theme> <symbol>\` — Why does this stock react?
- \`node --import tsx scripts/query-event-impact.mjs compare <SYM1> <SYM2>\` — Compare two stocks

### Analysis Pipeline
- \`node --import tsx scripts/auto-pipeline.mjs --step 2 --limit 100\` — Auto-detect which stocks react to events
- \`node --import tsx scripts/auto-pipeline.mjs --step 3 --limit 500\` — Generate labeled outcomes for new stock-theme pairs
- \`node --import tsx scripts/auto-pipeline.mjs --step 5\` — Refresh sensitivity matrix

### Direct SQL (via psql or node)
- PostgreSQL proxy at localhost:15433 (forwards to NAS), database: lattice
- IMPORTANT: Use host=localhost port=15433 (NOT 192.168.0.76 — external IP is blocked in sandbox)
- Tables: articles (60k), labeled_outcomes (618k), stock_sensitivity_matrix, auto_theme_symbols,
  regime_conditional_impact, event_hawkes_intensity, whatif_simulations, conditional_sensitivity, event_anomalies
- You can run SQL queries to explore data patterns

## Environment
- DB is pre-configured via environment: PG_HOST=localhost PG_PORT=15433 PG_DATABASE=lattice PG_USER=postgres
- .env.local has PG_PASSWORD — load with: export $(grep -v '^#' .env.local | xargs)
- ALWAYS override: export PG_HOST=localhost PG_PORT=15433

## Key Facts
- 60,353 articles (Guardian 57k + NYT 3.3k), 2020-2025
- 618,402 labeled outcomes (5 themes × 18 symbols × 3 horizons)
- 52 auto-detected theme-symbol pairs via price reaction
- All articles have 768-dim embeddings (nomic-embed-text)
- GDELT 1.38M daily aggregations (goldstein, tone, event_count)
- Yahoo prices for 57 symbols (5 years daily)

## Rules
1. ALWAYS load env first: export $(grep -v '^#' .env.local | xargs)
2. Use the query tools first before writing SQL
3. Validate claims with data — don't just theorize
4. Report findings in structured format
5. If you discover something new, save results to data/ directory`;

const TASK_PROMPTS = {
  discover: `${SYSTEM_CONTEXT}

## Your Mission: Discover New Patterns

1. Query the sensitivity matrix and find the MOST and LEAST predictive theme-symbol pairs
2. Look for patterns that aren't obvious from averages:
   - Are there specific time periods where hit rates spike?
   - Do certain GDELT conditions dramatically change reactions?
   - Are there cross-theme correlations (e.g., conflict events affect tech stocks)?
3. Run SQL queries to explore the data deeply
4. Find at least 3 non-obvious patterns and validate each with data
5. Save your findings to data/codex-discoveries.json

START by loading env and querying the sensitivity matrix.`,

  validate: `${SYSTEM_CONTEXT}

## Your Mission: Validate These Proposed Symbols

Codex previously proposed these symbols. Validate each by checking actual price data:
- VIXY (politics/long) — VIX futures, political shock
- LNG (energy/long) — Cheniere LNG export
- FRO (conflict/long) — Frontline tanker
- AVGO (tech/long) — Broadcom semiconductors
- AAL (politics/short) — American Airlines

For each symbol:
1. Check if it exists in Yahoo price data: SELECT DISTINCT symbol FROM worldmonitor_intel.historical_raw_items WHERE provider='yahoo-chart' AND symbol='<SYM>'
2. If exists, run auto-pipeline step 2 to check if it reacts to events
3. If it reacts, run step 3 to generate labeled outcomes
4. Run step 5 to refresh the sensitivity matrix
5. Query the new sensitivity data and report whether the proposal was correct

Save validation results to data/codex-validations.json`,

  expand: `${SYSTEM_CONTEXT}

## Your Mission: Find and Add New Data Sources

1. First, check what data we already have:
   - SELECT provider, COUNT(*) FROM worldmonitor_intel.historical_raw_items GROUP BY provider
   - SELECT source, COUNT(*) FROM articles GROUP BY source
2. Identify GAPS — what types of events are we missing?
   - Are there technology topics with < 50 articles? (quantum, fusion, biotech)
   - Are there geographic regions with no coverage?
3. For each gap, propose a concrete data source:
   - RSS feeds: suggest specific URLs
   - APIs: suggest specific endpoints
4. If possible, test ONE new RSS feed by fetching its content
5. Save source proposals to data/codex-source-proposals.json

START by exploring what we have and what's missing.`,
};

async function main() {
  // Start PG local proxy so Codex sandbox can reach NAS via localhost
  console.log('Starting PG proxy (localhost:15433 → NAS)...');
  const { fork } = await import('child_process');
  const proxy = fork(new URL('./pg-local-proxy.mjs', import.meta.url).pathname, [], {
    stdio: 'pipe',
    env: { ...process.env },
  });
  await new Promise(r => setTimeout(r, 1500));
  console.log('PG proxy running.\n');

  const prompt = TASK_PROMPTS[TASK] || TASK_PROMPTS.discover;
  console.log(`═══ Codex Agent — Task: ${TASK} ═══\n`);
  console.log(`Launching Codex with workspace-write sandbox...\n`);

  const command = process.env.CODEX_BIN || (process.env.APPDATA + '/npm/codex.cmd');
  const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--full-auto'];
  if (process.env.CODEX_MODEL?.trim()) args.push('--model', process.env.CODEX_MODEL.trim());
  args.push('-');

  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 600000, // 10 minutes
    env: {
      ...process.env,
      PG_HOST: 'localhost', PG_PORT: '15433',
      INTEL_PG_HOST: 'localhost', INTEL_PG_PORT: '15433',
      NAS_PG_HOST: 'localhost', NAS_PG_PORT: '15433',
    },
    shell: true,
    cwd: process.cwd(),
  });

  child.stdin.write(prompt);
  child.stdin.end();

  let stdout = '';
  let lastMessage = '';
  let toolCalls = 0;

  child.stdout.on('data', d => {
    const chunk = d.toString();
    stdout += chunk;
    // Parse JSON lines for progress
    for (const line of chunk.split(/\r?\n/)) {
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message') {
          lastMessage = parsed.item.text?.trim() || '';
          process.stderr.write(`\n[agent] ${lastMessage.slice(0, 100)}...\n`);
        }
        if (parsed?.type === 'item.completed' && parsed?.item?.type === 'tool_call') {
          toolCalls++;
          const name = parsed.item.name || 'unknown';
          process.stderr.write(`[tool:${name}] `);
        }
        if (parsed?.type === 'turn.completed') {
          const usage = parsed.usage || {};
          process.stderr.write(`\n[usage] input=${usage.input_tokens} output=${usage.output_tokens} cached=${usage.cached_input_tokens}\n`);
        }
      } catch { /* not JSON */ }
    }
  });

  child.stderr.on('data', d => {
    process.stderr.write(d.toString());
  });

  return new Promise((resolve, reject) => {
    child.on('close', code => {
      console.log(`\n═══ Agent Complete (exit=${code}, tools=${toolCalls}) ═══\n`);

      // Extract all agent messages
      const messages = [];
      for (const line of stdout.split(/\r?\n/)) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message') {
            messages.push(parsed.item.text);
          }
        } catch { /* skip */ }
      }

      if (messages.length > 0) {
        console.log('=== Agent Report ===\n');
        console.log(messages[messages.length - 1]); // Last message is usually the summary
      }

      // Save full session
      writeFileSync(`data/codex-agent-${TASK}-${Date.now()}.json`, JSON.stringify({
        task: TASK,
        timestamp: new Date().toISOString(),
        exitCode: code,
        toolCalls,
        messages,
        lastMessage: messages[messages.length - 1] || '',
      }, null, 2));

      if (code !== 0) reject(new Error(`Codex agent exited ${code}`));
      else resolve();
    });
    child.on('error', reject);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
