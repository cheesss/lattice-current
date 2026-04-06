#!/usr/bin/env node
/**
 * import-gpr-epu.mjs — GPR (Geopolitical Risk Index) + EPU (Economic Policy Uncertainty) 임포트
 *
 * 소스:
 * - GPR: matteoiacoviello.com/gpr.htm → CSV (daily, 1985~)
 * - EPU: policyuncertainty.com → CSV (monthly, 1985~)
 *
 * Usage:
 *   node --import tsx scripts/import-gpr-epu.mjs --gpr data/gpr_daily.csv
 *   node --import tsx scripts/import-gpr-epu.mjs --epu data/epu_monthly.csv
 *   node --import tsx scripts/import-gpr-epu.mjs --gpr data/gpr_daily.csv --epu data/epu_monthly.csv
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const GPR_DDL = `
CREATE TABLE IF NOT EXISTS macro_gpr (
  date DATE NOT NULL PRIMARY KEY,
  gpr_index DOUBLE PRECISION,
  gpr_threats DOUBLE PRECISION,
  gpr_acts DOUBLE PRECISION
);
`;

const EPU_DDL = `
CREATE TABLE IF NOT EXISTS macro_epu (
  date DATE NOT NULL PRIMARY KEY,
  epu_index DOUBLE PRECISION NOT NULL
);
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { gpr: null, epu: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gpr') result.gpr = args[++i];
    if (args[i] === '--epu') result.epu = args[++i];
  }
  return result;
}

async function importGPR(client, filePath) {
  console.log(`[GPR] Importing from: ${filePath}`);
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');

  // Detect header
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('date') || header.includes('gpr');

  let inserted = 0;
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim().replace(/"/g, ''));
    if (parts.length < 2) continue;

    // Try different date formats: YYYY-MM-DD, MM/DD/YYYY, YYYYMMDD
    let date = parts[0];
    if (date.includes('/')) {
      const [m, d, y] = date.split('/');
      date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if (isNaN(Date.parse(date))) continue;

    const gprIndex = parseFloat(parts[1]) || null;
    const gprThreats = parts.length > 2 ? (parseFloat(parts[2]) || null) : null;
    const gprActs = parts.length > 3 ? (parseFloat(parts[3]) || null) : null;

    await client.query(`
      INSERT INTO macro_gpr (date, gpr_index, gpr_threats, gpr_acts)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (date) DO UPDATE SET
        gpr_index = EXCLUDED.gpr_index,
        gpr_threats = EXCLUDED.gpr_threats,
        gpr_acts = EXCLUDED.gpr_acts
    `, [date, gprIndex, gprThreats, gprActs]);
    inserted++;
  }

  console.log(`[GPR] Inserted/updated ${inserted} rows`);
  return inserted;
}

async function importEPU(client, filePath) {
  console.log(`[EPU] Importing from: ${filePath}`);
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('date') || header.includes('year') || header.includes('epu');

  let inserted = 0;
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim().replace(/"/g, ''));
    if (parts.length < 2) continue;

    // EPU format is often: Year, Month, EPU_value
    let date;
    if (parts.length >= 3 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      date = `${parts[0]}-${parts[1].padStart(2, '0')}-01`;
      var epuValue = parseFloat(parts[2]);
    } else {
      date = parts[0];
      if (date.includes('/')) {
        const [m, d, y] = date.split('/');
        date = `${y}-${m.padStart(2, '0')}-${(d || '01').padStart(2, '0')}`;
      }
      var epuValue = parseFloat(parts[1]);
    }

    if (isNaN(Date.parse(date)) || isNaN(epuValue)) continue;

    await client.query(`
      INSERT INTO macro_epu (date, epu_index) VALUES ($1, $2)
      ON CONFLICT (date) DO UPDATE SET epu_index = EXCLUDED.epu_index
    `, [date, epuValue]);
    inserted++;
  }

  console.log(`[EPU] Inserted/updated ${inserted} rows`);
  return inserted;
}

async function main() {
  const args = parseArgs();

  if (!args.gpr && !args.epu) {
    console.error('Usage: node --import tsx scripts/import-gpr-epu.mjs --gpr <file> --epu <file>');
    console.error('Download GPR from: https://www.matteoiacoviello.com/gpr.htm');
    console.error('Download EPU from: https://www.policyuncertainty.com/us_monthly.html');
    process.exit(1);
  }

  const client = new Client(PG_CONFIG);

  try {
    await client.connect();
    console.log('[GPR/EPU] Connected to NAS PostgreSQL');

    if (args.gpr) {
      await client.query(GPR_DDL);
      await importGPR(client, args.gpr);
      const c = await client.query('SELECT COUNT(*) as n, MIN(date) as min_d, MAX(date) as max_d FROM macro_gpr');
      console.log(`[GPR] DB: ${c.rows[0].n} rows, ${c.rows[0].min_d} ~ ${c.rows[0].max_d}`);
    }

    if (args.epu) {
      await client.query(EPU_DDL);
      await importEPU(client, args.epu);
      const c = await client.query('SELECT COUNT(*) as n, MIN(date) as min_d, MAX(date) as max_d FROM macro_epu');
      console.log(`[EPU] DB: ${c.rows[0].n} rows, ${c.rows[0].min_d} ~ ${c.rows[0].max_d}`);
    }

  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('[GPR/EPU] Fatal:', err); process.exit(1); });
