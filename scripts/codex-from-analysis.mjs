#!/usr/bin/env node
/**
 * codex-from-analysis.mjs — 분석 엔진 결과를 직접 Codex에 전달
 *
 * 백테스팅(replay) 우회. 이벤트 분석 엔진의 결과를 기반으로:
 * 1. 민감도 매트릭스에서 유의미한 패턴 추출
 * 2. 자동 매핑된 종목 + 트렌드 데이터 포함
 * 3. Codex에 테마 생성 요청
 * 4. Codex에 종목 확장 요청
 *
 * Usage:
 *   node --import tsx scripts/codex-from-analysis.mjs
 *   node --import tsx scripts/codex-from-analysis.mjs --dry-run   # Codex 호출 없이 프롬프트만 출력
 */

import pg from 'pg';
import { spawn } from 'child_process';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log('═══ Codex from Analysis Engine ═══\n');

  // ── 1. Build evidence from analysis tables ──
  console.log('▶ 1. 분석 엔진에서 evidence 수집...');

  // Top sensitivity pairs
  const sensitivity = await client.query(`
    SELECT theme, symbol, avg_return, hit_rate, sample_size
    FROM stock_sensitivity_matrix WHERE horizon = '2w' AND sample_size >= 1000
    ORDER BY ABS(avg_return) DESC LIMIT 15
  `);

  // Auto-mapped symbols
  const autoMapped = await client.query(`
    SELECT theme, symbol, avg_abs_reaction, correlation
    FROM auto_theme_symbols ORDER BY correlation DESC LIMIT 20
  `);

  // Regime impacts
  const regimeImpact = await client.query(`
    SELECT theme, symbol, regime, avg_return, hit_rate, regime_multiplier
    FROM regime_conditional_impact WHERE horizon = '2w' AND sample_size >= 100
    ORDER BY ABS(avg_return) DESC LIMIT 15
  `);

  // Best what-if strategies
  const whatif = await client.query(`
    SELECT theme, symbol, direction, sharpe_ratio, hit_rate, total_return_pct
    FROM whatif_simulations WHERE horizon = '2w' AND sharpe_ratio > 1.0
    ORDER BY sharpe_ratio DESC LIMIT 10
  `);

  // Tech trends
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

  // Format evidence for Codex
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

  // ── 2. Theme Generation Prompt ──
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
    console.log('  Calling Codex...');
    const themeResult = await callCodex(themePrompt);
    console.log('\n  Codex Theme Response:');
    console.log(themeResult);

    // Parse and save
    try {
      const parsed = JSON.parse(extractJson(themeResult));
      if (parsed.themes) {
        for (const theme of parsed.themes) {
          console.log(`\n  ✓ Theme: ${theme.id} — ${theme.label}`);
          console.log(`    Confidence: ${theme.confidence}`);
          console.log(`    Thesis: ${theme.thesis?.slice(0, 100)}`);
          console.log(`    Assets: ${(theme.assets || []).map(a => a.symbol + ':' + a.direction).join(', ')}`);
        }
      }
    } catch (e) {
      console.log('  Failed to parse theme JSON:', e.message);
    }
  }

  // ── 3. Candidate Expansion Prompt ──
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
    console.log('  Calling Codex...');
    const expansionResult = await callCodex(expansionPrompt);
    console.log('\n  Codex Expansion Response:');
    console.log(expansionResult);

    try {
      const parsed = JSON.parse(extractJson(expansionResult));
      if (parsed.proposals) {
        for (const p of parsed.proposals) {
          console.log(`  ✓ ${p.symbol} (${p.theme}/${p.direction}): ${p.reason?.slice(0, 60)} conf=${p.confidence}`);
        }
      }
    } catch (e) {
      console.log('  Failed to parse expansion JSON:', e.message);
    }
  }

  console.log('\n✅ Codex from Analysis complete');
  await client.end();
}

function callCodex(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--full-auto'];
    if (process.env.CODEX_MODEL?.trim()) args.push('--model', process.env.CODEX_MODEL.trim());
    // Pass prompt via stdin (dash means read from stdin)
    args.push('-');

    const command = process.env.CODEX_BIN || process.env.APPDATA + '/npm/codex.cmd';
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000,
      env: { ...process.env },
      shell: true,
    });

    // Write prompt to stdin
    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); process.stderr.write('.'); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      process.stderr.write('\n');
      if (code !== 0) {
        reject(new Error(`Codex exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        let lastMessage = '';
        for (const line of stdout.split(/\r?\n/)) {
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message' && typeof parsed.item.text === 'string') {
              lastMessage = parsed.item.text.trim();
            }
          } catch { /* not JSON line */ }
        }
        resolve(lastMessage || stdout);
      }
    });
    child.on('error', reject);
  });
}

function extractJson(text) {
  // Find JSON block in text (may be wrapped in ```json ... ```)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  return jsonMatch ? jsonMatch[1].trim() : text;
}

main().catch(e => { console.error(e); process.exit(1); });
