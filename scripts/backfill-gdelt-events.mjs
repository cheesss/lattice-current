#!/usr/bin/env node
/**
 * backfill-gdelt-events.mjs
 * GDELT 2.0 Event raw CSV → 일별 국가×CAMEO 집계 → NAS PostgreSQL
 *
 * 사용법:
 *   node scripts/backfill-gdelt-events.mjs --from 2020-01 --to 2025-12
 *   node scripts/backfill-gdelt-events.mjs --from 2024-06 --to 2024-06  # 단일 월
 *
 * 동작:
 *   1. GDELT masterfile에서 15분 단위 export CSV URL 목록 조회
 *   2. 각 파일 다운로드 → 메모리에서 집계 → 원본 삭제
 *   3. 일별 집계를 NAS gdelt_daily_agg에 UPSERT
 *
 * 환경변수:
 *   PG_HOST, PG_PORT, PG_PASSWORD
 */

import pg from 'pg';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

import { SIGNAL_CAMEO_ROOT_SET } from './_shared/gdelt-cameo.mjs';
import { resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

const PG_CONFIG = resolveNasPgConfig();

// GDELT 2.0 masterfile list URL
const MASTERFILE_URL = 'http://data.gdeltproject.org/gdeltv2/masterfilelist.txt';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { from: '2020-01', to: '2025-12' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) result.from = args[++i];
    if (args[i] === '--to' && args[i + 1]) result.to = args[++i];
  }
  return result;
}

function readZipCsvContent(zipPath) {
  try {
    return execFileSync('unzip', ['-p', zipPath], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 15_000,
    });
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
    const script = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}')`,
      'try {',
      '  $entry = $zip.Entries | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Name) } | Select-Object -First 1',
      '  if (-not $entry) { throw "Zip archive has no file entries." }',
      '  $reader = New-Object System.IO.StreamReader($entry.Open())',
      '  try { [Console]::Out.Write($reader.ReadToEnd()) } finally { $reader.Dispose() }',
      '} finally { $zip.Dispose() }',
    ].join('; ');
    return execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 15_000,
    });
  }
}

/**
 * Get list of GDELT export CSV URLs for the date range.
 * Uses masterfile-translation.txt for older files.
 * For efficiency, we pick ONE file per day (the midnight file).
 * But we aggregate ALL files for accuracy.
 */
async function getExportUrls(fromYM, toYM) {
  console.log('GDELT masterfile 다운로드 중...');

  // Parse date range
  const [fy, fm] = fromYM.split('-').map(Number);
  const [ty, tm] = toYM.split('-').map(Number);
  const fromDate = new Date(fy, fm - 1, 1);
  const toDate = new Date(ty, tm, 0); // last day of toMonth

  const fromStr = `${fy}${String(fm).padStart(2, '0')}01`;
  const toStr = `${ty}${String(tm).padStart(2, '0')}${String(toDate.getDate()).padStart(2, '0')}`;

  // Download masterfile (large, ~100MB)
  // Instead, use the daily URL pattern directly
  // GDELT 2.0 URL pattern: http://data.gdeltproject.org/gdeltv2/YYYYMMDDHHMMSS.export.CSV.zip
  // We'll generate URLs for midnight (000000) of each day
  const urls = [];
  const current = new Date(fromDate);
  while (current <= toDate) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    const dateStr = `${y}${m}${d}`;
    // Use 3 files per day for better coverage: 000000, 080000, 160000
    for (const time of ['000000', '080000', '160000']) {
      urls.push({
        url: `http://data.gdeltproject.org/gdeltv2/${dateStr}${time}.export.CSV.zip`,
        date: `${y}-${m}-${d}`,
        dateStr,
      });
    }
    current.setDate(current.getDate() + 1);
  }

  console.log(`URL 생성: ${urls.length}개 (${urls.length / 3}일 × 3파일/일)`);
  return urls;
}

/**
 * Download and parse a single GDELT export CSV, return aggregated rows.
 */
async function downloadAndAggregate(url) {
  const tmpPath = join(tmpdir(), `gdelt_${Date.now()}.csv.zip`);

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return null; // file may not exist for some timestamps

    const buffer = await resp.arrayBuffer();
    const { Readable } = await import('stream');

    // Decompress zip in memory using unzipper or manual approach
    // GDELT zips contain a single CSV file
    // Use Node's built-in zlib (but zip ≠ gzip, need to handle zip format)

    // Simple approach: write to tmp, use child process to unzip
    writeFileSync(tmpPath, Buffer.from(buffer));
    const csvContent = readZipCsvContent(tmpPath);

    // Parse and aggregate
    const agg = {}; // key: "date|country|cameoRoot" → accumulator
    const lines = csvContent.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length < 61) continue;

      const day = cols[1]; // YYYYMMDD
      const eventRootCode = cols[28]; // 2-digit CAMEO root
      const goldstein = parseFloat(cols[30]);
      const numMentions = parseInt(cols[31]) || 0;
      const numSources = parseInt(cols[32]) || 0;
      const numArticles = parseInt(cols[33]) || 0;
      const avgTone = parseFloat(cols[34]);
      const actionGeoCC = cols[53]; // 2-letter country code

      if (!day || !eventRootCode || !actionGeoCC) continue;
      if (!SIGNAL_CAMEO_ROOT_SET.has(eventRootCode.slice(0, 2))) continue;
      if (isNaN(goldstein) || isNaN(avgTone)) continue;

      const dateFormatted = `${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`;
      const key = `${dateFormatted}|${actionGeoCC.slice(0,3)}|${eventRootCode.slice(0,2)}`;

      if (!agg[key]) {
        agg[key] = {
          date: dateFormatted,
          country: actionGeoCC.slice(0,3),
          cameo_root: eventRootCode.slice(0,2),
          event_count: 0,
          goldstein_sum: 0,
          tone_sum: 0,
          mentions: 0,
          sources: 0,
          articles: 0
        };
      }
      const a = agg[key];
      a.event_count++;
      a.goldstein_sum += goldstein;
      a.tone_sum += avgTone;
      a.mentions += numMentions;
      a.sources += numSources;
      a.articles += numArticles;
    }

    return Object.values(agg);
  } catch (e) {
    return null;
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

/**
 * Merge file-level aggregations into day-level accumulator
 */
function mergeInto(dayAgg, fileRows) {
  if (!fileRows) return;
  for (const row of fileRows) {
    const key = `${row.date}|${row.country}|${row.cameo_root}`;
    if (!dayAgg[key]) {
      dayAgg[key] = { ...row };
    } else {
      const a = dayAgg[key];
      a.event_count += row.event_count;
      a.goldstein_sum += row.goldstein_sum;
      a.tone_sum += row.tone_sum;
      a.mentions += row.mentions;
      a.sources += row.sources;
      a.articles += row.articles;
    }
  }
}

async function upsertDayAgg(pgClient, dayAgg) {
  const rows = Object.values(dayAgg);
  if (rows.length === 0) return 0;

  // Batch upsert 100 rows at a time
  const BATCH = 100;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const r of batch) {
      const avgGoldstein = r.event_count > 0 ? r.goldstein_sum / r.event_count : 0;
      const avgTone = r.event_count > 0 ? r.tone_sum / r.event_count : 0;
      placeholders.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8})`);
      values.push(r.date, r.country, r.cameo_root, r.event_count, avgGoldstein, avgTone, r.mentions, r.sources, r.articles);
      idx += 9;
    }

    await pgClient.query(`
      INSERT INTO gdelt_daily_agg (date, country, cameo_root, event_count, avg_goldstein, avg_tone, num_mentions, num_sources, num_articles)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (date, country, cameo_root) DO UPDATE SET
        event_count = gdelt_daily_agg.event_count + EXCLUDED.event_count,
        avg_goldstein = (gdelt_daily_agg.avg_goldstein * gdelt_daily_agg.event_count + EXCLUDED.avg_goldstein * EXCLUDED.event_count)
                        / NULLIF(gdelt_daily_agg.event_count + EXCLUDED.event_count, 0),
        avg_tone = (gdelt_daily_agg.avg_tone * gdelt_daily_agg.event_count + EXCLUDED.avg_tone * EXCLUDED.event_count)
                   / NULLIF(gdelt_daily_agg.event_count + EXCLUDED.event_count, 0),
        num_mentions = gdelt_daily_agg.num_mentions + EXCLUDED.num_mentions,
        num_sources = gdelt_daily_agg.num_sources + EXCLUDED.num_sources,
        num_articles = gdelt_daily_agg.num_articles + EXCLUDED.num_articles
    `, values);
    upserted += batch.length;
  }

  return upserted;
}

async function main() {
  const { from, to } = parseArgs();
  console.log(`GDELT 이벤트 집계 수집: ${from} ~ ${to}`);

  const urls = await getExportUrls(from, to);
  const pgClient = new Client(PG_CONFIG);
  await pgClient.connect();

  let totalUpserted = 0;
  let filesProcessed = 0;
  let filesFailed = 0;
  let currentDay = '';
  let dayAgg = {};

  for (let i = 0; i < urls.length; i++) {
    const { url, date } = urls[i];

    // When day changes, flush accumulated aggregation
    if (date !== currentDay && currentDay !== '') {
      const count = await upsertDayAgg(pgClient, dayAgg);
      totalUpserted += count;
      dayAgg = {};
    }
    currentDay = date;

    const fileRows = await downloadAndAggregate(url);
    if (fileRows) {
      mergeInto(dayAgg, fileRows);
      filesProcessed++;
    } else {
      filesFailed++;
    }

    // Rate limit: ~2 req/sec
    await sleep(500);

    if ((i + 1) % 30 === 0 || i === urls.length - 1) {
      const pct = Math.floor(((i + 1) / urls.length) * 100);
      console.log(`  ${date} 진행: ${i + 1}/${urls.length} (${pct}%) 파일처리=${filesProcessed} 실패=${filesFailed} DB행=${totalUpserted}`);
    }
  }

  // Flush last day
  if (Object.keys(dayAgg).length > 0) {
    const count = await upsertDayAgg(pgClient, dayAgg);
    totalUpserted += count;
  }

  // Final stats
  const countResult = await pgClient.query('SELECT COUNT(*) FROM gdelt_daily_agg');
  console.log(`\n완료. 파일=${filesProcessed} 실패=${filesFailed} NAS행=${countResult.rows[0].count}`);

  await pgClient.end();
}

main().catch(e => { console.error(e); process.exit(1); });
