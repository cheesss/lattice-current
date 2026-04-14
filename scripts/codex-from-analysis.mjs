#!/usr/bin/env node
/**
 * codex-from-analysis.mjs — 분석 엔진 결과를 Claude API에 전달하여 테마/종목 제안 생성
 *
 * 기존 Codex CLI 기반에서 Anthropic Claude API로 전환.
 *
 * 1. 민감도 매트릭스에서 유의미한 패턴 추출
 * 2. 자동 매핑된 종목 + 트렌드 데이터 포함
 * 3. Claude API로 테마 생성 요청
 * 4. Claude API로 종목 확장 요청
 * 5. 결과를 codex_proposals 테이블에 저장
 *
 * Usage:
 *   node --import tsx scripts/codex-from-analysis.mjs
 *   node --import tsx scripts/codex-from-analysis.mjs --dry-run
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();
const DRY_RUN = process.argv.includes('--dry-run');
const MODEL = process.env.CODEX_MODEL || 'claude-sonnet-4-20250514';

async function callClaude(prompt) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0]?.text || '';
}

function extractJson(text) {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  return jsonMatch ? jsonMatch[1].trim() : text;
}

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log(`═══ Codex from Analysis Engine (Claude API: ${MODEL}) ═══\n`);

  // ── 1. Build evidence from analysis tables ──
  console.log('▶ 1. 분석 엔진에서 evidence 수집...');

  const sensitivity = await client.query(`
    SELECT theme, symbol, avg_return, hit_rate, sample_size
    FROM stock_sensitivity_matrix WHERE horizon = '2w' AND sample_size >= 1000
    ORDER BY ABS(avg_return) DESC LIMIT 15
  `);

  const autoMapped = await client.query(`
    SELECT theme, symbol, avg_abs_reaction, correlation
    FROM auto_theme_symbols ORDER BY correlation DESC LIMIT 20
  `);

  const regimeImpact = await client.query(`
    SELECT theme, symbol, regime, avg_return, hit_rate, regime_multiplier
    FROM regime_conditional_impact WHERE horizon = '2w' AND sample_size >= 100
    ORDER BY ABS(avg_return) DESC LIMIT 15
  `);

  const whatif = await client.query(`
    SELECT theme, symbol, direction, sharpe_ratio, hit_rate, total_return_pct
    FROM whatif_simulations WHERE horizon = '2w' AND sharpe_ratio > 1.0
    ORDER BY sharpe_ratio DESC LIMIT 10
  `);

  const trends = [];
  const topics = { 'AI': ['AI','GPT','LLM'], 'Semiconductor': ['semiconductor','chip'], 'Cyber': ['cyber','ransomware'], 'Drone': ['drone','robot'] };
  for (const [name, kws] of Object.entries(topics)) {
    const cond = kws.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
    const r = await client.query(
      `SELECT COUNT(*) n FROM articles WHERE ${cond} AND published_at >= NOW() - INTERVAL '6 months'`,
      kws.map(k => '%' + k + '%')
    );
    trends.push({ name, recent: Number(r.rows[0]?.n || 0) });
  }

  const evidenceLines = [
    '=== Event Impact Analysis (618k labeled outcomes, 5 years) ===',
    '',
    'Top Stock Sensitivities (2-week forward):',
    ...sensitivity.rows.map(r => `  ${r.theme} → ${r.symbol}: avg ${Number(r.avg_return) >= 0 ? '+' : ''}${Number(r.avg_return).toFixed(2)}%, hit ${(Number(r.hit_rate) * 100).toFixed(0)}%, n=${r.sample_size}`),
    '',
    'Auto-Detected Stock Reactions (price reaction ratio on event days):',
    ...autoMapped.rows.map(r => `  ${r.theme} → ${r.symbol}: |move|=${Number(r.avg_abs_reaction).toFixed(2)}%, reaction ratio=${Number(r.correlation).toFixed(2)}x vs normal`),
    '',
    'Regime-Conditional Impact (VIX-based market state):',
    ...regimeImpact.rows.map(r => `  ${r.theme} → ${r.symbol} [${r.regime}]: avg ${Number(r.avg_return) >= 0 ? '+' : ''}${Number(r.avg_return).toFixed(2)}%, hit ${(Number(r.hit_rate) * 100).toFixed(0)}%, multiplier ${Number(r.regime_multiplier).toFixed(2)}x`),
    '',
    'Best What-If Strategies (Sharpe > 1.0):',
    ...whatif.rows.map(r => `  ${r.theme} → ${r.symbol} ${r.direction}: Sharpe=${Number(r.sharpe_ratio).toFixed(2)}, hit=${(Number(r.hit_rate) * 100).toFixed(0)}%, total=${Number(r.total_return_pct).toFixed(0)}%`),
    '',
    'Technology Trends (recent 6 months):',
    ...trends.map(t => `  ${t.name}: ${t.recent} articles`),
  ];

  console.log('  Evidence lines:', evidenceLines.length);

  // ── 2. Theme Generation ──
  const themePrompt = `You are an investment research analyst. Based on the following event-impact analysis data from 5 years of Guardian/NYT news and market data, propose 3 NEW investment themes.

${evidenceLines.join('\n')}

For each theme, provide:
1. id: kebab-case identifier
2. label: Human-readable name (English)
3. thesis: 2-3 sentence investment thesis
4. triggers: 8-15 keywords that activate this theme
5. assets: 4-8 tradeable symbols with direction (long/short/hedge) and role (primary/confirm/hedge)
6. confidence: 25-95 score
7. invalidation: conditions that would kill this thesis

IMPORTANT: Base themes on the ACTUAL data above, not general knowledge. Focus on patterns where hit_rate > 55% or Sharpe > 1.0.

Respond in valid JSON: { "themes": [...] }`;

  console.log('\n▶ 2. Theme Generation...');
  if (DRY_RUN) {
    console.log('  [DRY RUN] Prompt length:', themePrompt.length, 'chars');
    console.log('  [DRY RUN] First 500 chars of prompt:');
    console.log(themePrompt.slice(0, 500));
  } else {
    console.log(`  Calling Claude (${MODEL})...`);
    const themeResult = await callClaude(themePrompt);

    try {
      const parsed = JSON.parse(extractJson(themeResult));
      if (parsed.themes) {
        for (const theme of parsed.themes) {
          console.log(`  Theme: ${theme.id} — ${theme.label} (conf=${theme.confidence})`);
          // Save to codex_proposals
          await client.query(`
            INSERT INTO codex_proposals (type, payload, status, source, created_at)
            VALUES ('theme', $1, 'pending', 'claude-analysis', NOW())
            ON CONFLICT DO NOTHING
          `, [JSON.stringify(theme)]);
        }
        console.log(`  ${parsed.themes.length} theme proposals saved`);
      }
    } catch (e) {
      console.warn('  Failed to parse theme JSON:', e.message);
    }
  }

  // ── 3. Candidate Expansion ──
  const expansionPrompt = `You are an investment analyst. Given these auto-detected stock reactions to news events:

${autoMapped.rows.map(r => `${r.theme} → ${r.symbol}: reaction ratio ${Number(r.correlation).toFixed(2)}x, avg |move| ${Number(r.avg_abs_reaction).toFixed(2)}%`).join('\n')}

And these regime-conditional patterns:
${regimeImpact.rows.slice(0, 8).map(r => `${r.theme}/${r.regime} → ${r.symbol}: ${Number(r.avg_return) >= 0 ? '+' : ''}${Number(r.avg_return).toFixed(2)}%, hit ${(Number(r.hit_rate)*100).toFixed(0)}%`).join('\n')}

Propose 5 ADDITIONAL symbols not in the data above that would likely react to the same event types. For each:
1. symbol: ticker
2. theme: which event theme
3. direction: long or short
4. reason: why this symbol would react (1 sentence)
5. confidence: 25-95

Respond in valid JSON: { "proposals": [...] }`;

  console.log('\n▶ 3. Candidate Expansion...');
  if (DRY_RUN) {
    console.log('  [DRY RUN] Prompt length:', expansionPrompt.length, 'chars');
  } else {
    console.log(`  Calling Claude (${MODEL})...`);
    const expansionResult = await callClaude(expansionPrompt);

    try {
      const parsed = JSON.parse(extractJson(expansionResult));
      if (parsed.proposals) {
        for (const p of parsed.proposals) {
          console.log(`  ${p.symbol} (${p.theme}/${p.direction}): ${p.reason?.slice(0, 60)} conf=${p.confidence}`);
          await client.query(`
            INSERT INTO codex_proposals (type, payload, status, source, created_at)
            VALUES ('symbol', $1, 'pending', 'claude-analysis', NOW())
            ON CONFLICT DO NOTHING
          `, [JSON.stringify(p)]);
        }
        console.log(`  ${parsed.proposals.length} symbol proposals saved`);
      }
    } catch (e) {
      console.warn('  Failed to parse expansion JSON:', e.message);
    }
  }

  console.log('\n  Codex from Analysis complete');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
