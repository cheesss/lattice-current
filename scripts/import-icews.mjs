#!/usr/bin/env node
/**
 * import-icews.mjs — ICEWS (Integrated Crisis Early Warning System) 데이터 임포트
 *
 * ICEWS는 CAMEO 코딩 기반 구조화 정치 이벤트 데이터.
 * Harvard Dataverse에서 다운로드한 TSV 파일을 NAS에 적재.
 *
 * 용도: labeled_outcomes 보강 + event-resolver 앵커 (학습 전용, 라이브 불가)
 *
 * Usage:
 *   node --import tsx scripts/import-icews.mjs --file data/icews-2021-2024.tsv
 *   node --import tsx scripts/import-icews.mjs --file data/icews.tsv --since 2021-01-01
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

// ---------------------------------------------------------------------------
// CAMEO → Theme mapping
// ---------------------------------------------------------------------------

const CAMEO_THEME_MAP = {
  // Material conflict (15-20)
  '15': 'conflict',   // Exhibit force posture
  '17': 'conflict',   // Coerce
  '18': 'conflict',   // Assault
  '19': 'conflict',   // Fight
  '20': 'conflict',   // Use unconventional mass violence
  // Verbal conflict
  '12': 'conflict',   // Reject
  '13': 'conflict',   // Threaten
  '14': 'conflict',   // Protest
  // Cooperation
  '05': 'politics',   // Diplomatic cooperation
  '06': 'politics',   // Material cooperation
  '07': 'politics',   // Provide aid
  '08': 'economy',    // Yield
  // Verbal cooperation
  '01': 'politics',   // Make public statement
  '02': 'politics',   // Appeal
  '03': 'politics',   // Express intent to cooperate
  '04': 'politics',   // Consult
  // Demands/restrictions
  '09': 'economy',    // Investigate
  '10': 'economy',    // Demand
  '11': 'economy',    // Disapprove
  '16': 'conflict',   // Reduce relations
};

const ICEWS_DDL = `
CREATE TABLE IF NOT EXISTS icews_events (
  id SERIAL PRIMARY KEY,
  event_date DATE NOT NULL,
  cameo_code TEXT,
  cameo_root TEXT,
  source_country TEXT,
  target_country TEXT,
  source_actor TEXT,
  target_actor TEXT,
  intensity DOUBLE PRECISION,
  event_text TEXT,
  theme_mapped TEXT,
  UNIQUE(event_date, cameo_code, source_actor, target_actor, event_text)
);
CREATE INDEX IF NOT EXISTS idx_icews_date ON icews_events (event_date);
CREATE INDEX IF NOT EXISTS idx_icews_theme ON icews_events (theme_mapped);
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { file: null, since: '2021-01-01' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') result.file = args[++i];
    if (args[i] === '--since') result.since = args[++i];
  }
  return result;
}

async function importICEWS(client, filePath, sinceDate) {
  console.log(`[ICEWS] Importing from: ${filePath}`);
  console.log(`[ICEWS] Filtering events since: ${sinceDate}`);

  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');

  // ICEWS TSV format: Event ID, Event Date, Source Name, Source Sectors, Source Country,
  // Event Text, CAMEO Code, Intensity, Target Name, Target Sectors, Target Country, ...
  const header = lines[0].split('\t').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  const dateIdx = header.findIndex(h => h.includes('event_date') || h === 'date');
  const cameoIdx = header.findIndex(h => h.includes('cameo') || h.includes('code'));
  const srcCountryIdx = header.findIndex(h => h.includes('source_country'));
  const tgtCountryIdx = header.findIndex(h => h.includes('target_country'));
  const srcActorIdx = header.findIndex(h => h.includes('source_name') || h.includes('source_actor'));
  const tgtActorIdx = header.findIndex(h => h.includes('target_name') || h.includes('target_actor'));
  const intensityIdx = header.findIndex(h => h.includes('intensity'));
  const textIdx = header.findIndex(h => h.includes('event_text') || h.includes('text'));

  if (dateIdx < 0 || cameoIdx < 0) {
    console.error('[ICEWS] Cannot find required columns (event_date, cameo_code)');
    console.error('[ICEWS] Found columns:', header.join(', '));
    return 0;
  }

  const sinceTime = new Date(sinceDate).getTime();
  let inserted = 0;
  let skipped = 0;
  const batchSize = 500;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t').map(c => c.trim());
    const dateStr = cols[dateIdx] || '';
    const eventDate = new Date(dateStr);
    if (isNaN(eventDate.getTime()) || eventDate.getTime() < sinceTime) {
      skipped++;
      continue;
    }

    const cameoCode = cols[cameoIdx] || '';
    const cameoRoot = cameoCode.slice(0, 2);
    const theme = CAMEO_THEME_MAP[cameoRoot] || null;

    const intensity = intensityIdx >= 0 ? (parseFloat(cols[intensityIdx]) || 0) : 0;
    const srcCountry = srcCountryIdx >= 0 ? (cols[srcCountryIdx] || '') : '';
    const tgtCountry = tgtCountryIdx >= 0 ? (cols[tgtCountryIdx] || '') : '';
    const srcActor = srcActorIdx >= 0 ? (cols[srcActorIdx] || '').slice(0, 200) : '';
    const tgtActor = tgtActorIdx >= 0 ? (cols[tgtActorIdx] || '').slice(0, 200) : '';
    const eventText = textIdx >= 0 ? (cols[textIdx] || '').slice(0, 500) : '';

    try {
      await client.query(`
        INSERT INTO icews_events (event_date, cameo_code, cameo_root, source_country, target_country, source_actor, target_actor, intensity, event_text, theme_mapped)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (event_date, cameo_code, source_actor, target_actor, event_text) DO NOTHING
      `, [dateStr, cameoCode, cameoRoot, srcCountry, tgtCountry, srcActor, tgtActor, intensity, eventText, theme]);
      inserted++;
    } catch (err) {
      // Skip duplicates or malformed rows
      skipped++;
    }

    if (inserted % 10000 === 0 && inserted > 0) {
      console.log(`  [ICEWS] ${inserted} inserted, ${skipped} skipped...`);
    }
  }

  console.log(`[ICEWS] Done: ${inserted} inserted, ${skipped} skipped`);
  return inserted;
}

async function main() {
  const args = parseArgs();

  if (!args.file) {
    console.error('Usage: node --import tsx scripts/import-icews.mjs --file <tsv-file>');
    console.error('Download from: https://dataverse.harvard.edu/dataverse/icews');
    process.exit(1);
  }

  const client = new Client(PG_CONFIG);
  try {
    await client.connect();
    console.log('[ICEWS] Connected to NAS PostgreSQL');
    await client.query(ICEWS_DDL);
    await importICEWS(client, args.file, args.since);

    // Summary
    const summary = await client.query(`
      SELECT theme_mapped, COUNT(*) as n
      FROM icews_events
      WHERE theme_mapped IS NOT NULL
      GROUP BY theme_mapped
      ORDER BY n DESC
    `);
    console.log('\n[ICEWS] Theme distribution:');
    for (const r of summary.rows) {
      console.log(`  ${(r.theme_mapped || 'unmapped').padEnd(12)} ${r.n}`);
    }

    const total = await client.query('SELECT COUNT(*) as n, MIN(event_date) as min_d, MAX(event_date) as max_d FROM icews_events');
    console.log(`\n[ICEWS] Total: ${total.rows[0].n} events, ${total.rows[0].min_d} ~ ${total.rows[0].max_d}`);
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('[ICEWS] Fatal:', err); process.exit(1); });
