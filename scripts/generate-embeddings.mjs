#!/usr/bin/env node
/**
 * generate-embeddings.mjs
 * NAS articles 테이블에서 embedding IS NULL인 기사를 배치로 처리
 * Ollama nomic-embed-text → pgvector 저장
 *
 * 사용법:
 *   node scripts/generate-embeddings.mjs
 *   node scripts/generate-embeddings.mjs --batch 50   # 배치 크기 조정
 *   node scripts/generate-embeddings.mjs --limit 1000 # 최대 N건만 처리
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig, resolveOllamaEmbedConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;

const PG_CONFIG = resolveNasPgConfig();
let OLLAMA = null;

function getOllamaConfig() {
  if (!OLLAMA) OLLAMA = resolveOllamaEmbedConfig();
  return OLLAMA;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { batch: 50, limit: 0, strict: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) result.batch = parseInt(args[++i]);
    if (args[i] === '--limit' && args[i + 1]) result.limit = parseInt(args[++i]);
    if (args[i] === '--strict') result.strict = true;
  }
  return result;
}

async function checkOllamaAvailable() {
  try {
    const config = getOllamaConfig();
    const tagsUrl = new URL(config.endpoint);
    tagsUrl.pathname = '/api/tags';
    tagsUrl.search = '';
    const response = await fetch(tagsUrl, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { ok: false, error: `Ollama health ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || 'Ollama unavailable') };
  }
}

async function getEmbeddings(texts) {
  const config = getOllamaConfig();
  const resp = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, input: texts }),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.embeddings;
}

function toVectorString(arr) {
  return '[' + arr.join(',') + ']';
}

async function main() {
  const { batch, limit, strict } = parseArgs();
  const ollamaHealth = await checkOllamaAvailable();
  if (!ollamaHealth.ok) {
    console.log(`embedding-refresh skipped: ${ollamaHealth.error}`);
    if (strict) process.exitCode = 1;
    return;
  }

  const pgClient = new Client(PG_CONFIG);
  await pgClient.connect();

  // Count total pending
  const totalResult = await pgClient.query('SELECT COUNT(*) FROM articles WHERE embedding IS NULL');
  const totalPending = Number(totalResult.rows[0].count);
  const target = limit > 0 ? Math.min(limit, totalPending) : totalPending;
  console.log(`임베딩 대기: ${totalPending}건, 처리 목표: ${target}건, 배치: ${batch}건`);

  let processed = 0;
  const startTime = Date.now();

  while (processed < target) {
    const remaining = Math.min(batch, target - processed);
    const rows = await pgClient.query(
      'SELECT id, title, summary FROM articles WHERE embedding IS NULL ORDER BY id LIMIT $1',
      [remaining]
    );
    if (rows.rows.length === 0) break;

    // Build text inputs: "title. summary"
    const texts = rows.rows.map(r => {
      const text = (r.title || '') + '. ' + (r.summary || '');
      return text.slice(0, 2000); // nomic-embed-text max ~8192 tokens, truncate for safety
    });

    const embeddings = await getEmbeddings(texts);

    // Update each row
    for (let i = 0; i < rows.rows.length; i++) {
      await pgClient.query(
        'UPDATE articles SET embedding = $1 WHERE id = $2',
        [toVectorString(embeddings[i]), rows.rows[i].id]
      );
    }

    processed += rows.rows.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (processed / elapsed * 60).toFixed(0);
    const pct = Math.floor((processed / target) * 100);
    process.stderr.write(`\r  ${processed}/${target} (${pct}%) ${elapsed}s elapsed, ~${rate}건/분`);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n\n완료: ${processed}건 임베딩 생성, ${totalElapsed}초 소요`);

  // Verify
  const doneResult = await pgClient.query('SELECT COUNT(*) FROM articles WHERE embedding IS NOT NULL');
  const nullResult = await pgClient.query('SELECT COUNT(*) FROM articles WHERE embedding IS NULL');
  console.log(`임베딩 완료: ${doneResult.rows[0].count}건, 미완료: ${nullResult.rows[0].count}건`);

  await pgClient.end();
}

main().catch(e => { console.error(e); process.exit(1); });
