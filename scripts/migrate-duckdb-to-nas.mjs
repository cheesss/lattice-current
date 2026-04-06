#!/usr/bin/env node
/**
 * migrate-duckdb-to-nas.mjs
 * DuckDB historical data → NAS PostgreSQL 마이그레이션
 *
 * 사용법:
 *   node scripts/migrate-duckdb-to-nas.mjs
 *   node scripts/migrate-duckdb-to-nas.mjs --table datasets
 *   node scripts/migrate-duckdb-to-nas.mjs --table raw_items
 *   node scripts/migrate-duckdb-to-nas.mjs --table replay_frames
 *   node scripts/migrate-duckdb-to-nas.mjs --dry-run
 */

import Database from '@duckdb/node-api';
import pg from 'pg';
import { resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

const DUCKDB_PATH = './data/historical/intelligence-history.duckdb';

const PG_CONFIG = resolveNasPgConfig();

const TABLE_MAP = {
  datasets:      { duck: 'historical_datasets',      pg: 'datasets' },
  raw_items:     { duck: 'historical_raw_items',      pg: 'raw_items' },
  replay_frames: { duck: 'historical_replay_frames',  pg: 'replay_frames' },
};

const BATCH_SIZE = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { table: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--table' && args[i + 1]) result.table = args[++i];
    if (args[i] === '--dry-run') result.dryRun = true;
  }
  return result;
}

async function getColumnNames(duckConn, tableName) {
  const r = await duckConn.runAndReadAll(`DESCRIBE "${tableName}"`);
  return r.getRows().map(row => row[0]);
}

async function migrateTable(duckConn, pgClient, key, dryRun) {
  const { duck, pg: pgTable } = TABLE_MAP[key];
  console.log(`\n${'='.repeat(60)}`);
  console.log(`마이그레이션: ${duck} → ${pgTable}`);

  const columns = await getColumnNames(duckConn, duck);
  const countResult = await duckConn.runAndReadAll(`SELECT COUNT(*) FROM "${duck}"`);
  const totalRows = Number(countResult.getRows()[0][0]);
  console.log(`  컬럼: ${columns.join(', ')}`);
  console.log(`  총 행: ${totalRows.toLocaleString()}`);

  if (dryRun) {
    console.log('  [DRY RUN] 스킵');
    return 0;
  }

  // Check how many already exist in PG
  const existingResult = await pgClient.query(`SELECT COUNT(*) FROM ${pgTable}`);
  const existingCount = Number(existingResult.rows[0].count);
  if (existingCount === totalRows) {
    console.log(`  이미 ${existingCount}건 존재 — 스킵`);
    return existingCount;
  }
  if (existingCount > 0) {
    console.log(`  기존 ${existingCount}건 존재 — UPSERT 모드`);
  }

  const colList = columns.map(c => `"${c}"`).join(', ');
  const primaryKey = columns[0];
  const updateSet = columns.slice(1).map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

  let migrated = 0;
  let offset = 0;

  while (offset < totalRows) {
    const batchResult = await duckConn.runAndReadAll(
      `SELECT * FROM "${duck}" LIMIT ${BATCH_SIZE} OFFSET ${offset}`
    );
    const rows = batchResult.getRows();
    if (rows.length === 0) break;

    // Build multi-row VALUES for batch insert
    const allValues = [];
    const valueClauses = [];
    let paramIdx = 1;
    for (const row of rows) {
      const rowPlaceholders = columns.map(() => `$${paramIdx++}`);
      valueClauses.push(`(${rowPlaceholders.join(', ')})`);
      for (const v of row) {
        allValues.push(typeof v === 'bigint' ? Number(v) : v);
      }
    }

    const batchSQL = `INSERT INTO ${pgTable} (${colList}) VALUES ${valueClauses.join(', ')}
      ON CONFLICT ("${primaryKey}") DO UPDATE SET ${updateSet}`;
    await pgClient.query(batchSQL, allValues);
    migrated += rows.length;

    offset += rows.length;
    const pct = Math.floor((offset / totalRows) * 100);
    process.stderr.write(`\r  진행: ${offset.toLocaleString()}/${totalRows.toLocaleString()} (${pct}%)`);
  }

  console.log(`\n  완료: ${migrated.toLocaleString()}건 마이그레이션`);
  return migrated;
}

async function main() {
  const { table, dryRun } = parseArgs();
  const tables = table ? [table] : Object.keys(TABLE_MAP);

  console.log('DuckDB → NAS PostgreSQL 마이그레이션');
  console.log(`대상: ${tables.join(', ')}${dryRun ? ' [DRY RUN]' : ''}`);

  const duckDb = await Database.DuckDBInstance.create(DUCKDB_PATH);
  const duckConn = await duckDb.connect();
  const pgClient = new Client(PG_CONFIG);
  await pgClient.connect();

  let totalMigrated = 0;
  for (const key of tables) {
    if (!TABLE_MAP[key]) {
      console.log(`알 수 없는 테이블: ${key}`);
      continue;
    }
    totalMigrated += await migrateTable(duckConn, pgClient, key, dryRun);
  }

  // Verification
  console.log(`\n${'='.repeat(60)}`);
  console.log('검증:');
  for (const key of tables) {
    if (!TABLE_MAP[key]) continue;
    const duckCount = await duckConn.runAndReadAll(`SELECT COUNT(*) FROM "${TABLE_MAP[key].duck}"`);
    const pgCount = await pgClient.query(`SELECT COUNT(*) FROM ${TABLE_MAP[key].pg}`);
    const dc = Number(duckCount.getRows()[0][0]);
    const pc = Number(pgCount.rows[0].count);
    const match = dc === pc ? '✅' : '❌';
    console.log(`  ${TABLE_MAP[key].pg}: DuckDB=${dc} NAS=${pc} ${match}`);
  }

  await pgClient.end();
  console.log(`\n총 ${totalMigrated.toLocaleString()}건 처리 완료`);
}

main().catch(e => { console.error(e); process.exit(1); });
