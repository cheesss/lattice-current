#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  return {
    apply,
    dryRun: !apply,
  };
}

export function normalizeApprovalUrl(value) {
  return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
}

export function hostForUrl(value) {
  try {
    return new URL(String(value || '').trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function newestFirst(a, b) {
  return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    || Number(b.id || 0) - Number(a.id || 0);
}

function hasRegisteredAndSeeded(reasoning) {
  return /registered and seeded\s+\d+\s+articles/i.test(String(reasoning || ''));
}

function hasSeededZero(reasoning) {
  return /registered and seeded\s+0\s+articles/i.test(String(reasoning || ''));
}

function hasBelowThresholdReason(reasoning) {
  return /quality\s+0(?:\.0+)?\s+below threshold/i.test(String(reasoning || ''));
}

function hasProbeRejectReason(reasoning) {
  return /probe\s+reject/i.test(String(reasoning || ''))
    || /feed not found/i.test(String(reasoning || ''))
    || /below threshold/i.test(String(reasoning || ''));
}

function hasRepairSuccessReason(reasoning) {
  return /source-repaired|auto-repair|selected\s+https?:\/\//i.test(String(reasoning || ''));
}

function ageHoursFromNow(value, now = new Date()) {
  const ts = Date.parse(value || '');
  const nowTs = now instanceof Date ? now.getTime() : Date.parse(now || '');
  if (!Number.isFinite(ts) || !Number.isFinite(nowTs)) return null;
  return Math.max(0, (nowTs - ts) / 36e5);
}

function isTemporaryVerificationApproval(approval) {
  const text = [
    approval.payload?.name,
    approval.payload?.url,
    approval.reasoning,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return text.includes('temporary')
    || text.includes('click test')
    || text.includes('accept test')
    || hostForUrl(approval.payload?.url) === 'example.com';
}

export function planApprovalQueueCleanup({ approvals = [], activeSources = [], now = new Date() } = {}) {
  const activeUrls = new Set(activeSources.map((source) => normalizeApprovalUrl(source.url)).filter(Boolean));
  const activeHosts = new Map();
  for (const source of activeSources) {
    const host = hostForUrl(source.url);
    if (host && !activeHosts.has(host)) activeHosts.set(host, source.url);
  }

  const updates = [];
  const updateIds = new Set();
  const addUpdate = (approval, status, note) => {
    const id = Number(approval.id);
    if (!Number.isFinite(id) || updateIds.has(id)) return;
    updateIds.add(id);
    updates.push({
      id,
      fromStatus: approval.status,
      toStatus: status,
      note,
      url: approval.payload?.url || '',
      name: approval.payload?.name || '',
    });
  };

  for (const approval of approvals) {
    if (!['pending', 'needs-fix', 'executed'].includes(String(approval.status || '').toLowerCase())) continue;
    if (isTemporaryVerificationApproval(approval)) {
      addUpdate(approval, 'rejected', 'cleanup: rejected temporary verification approval row');
    }
  }

  for (const approval of approvals) {
    if (approval.status !== 'executed') continue;
    const url = normalizeApprovalUrl(approval.payload?.url);
    const host = hostForUrl(approval.payload?.url);
    const hasActiveSource = activeUrls.has(url) || (host && activeHosts.has(host));
    if (hasBelowThresholdReason(approval.reasoning) && !hasRegisteredAndSeeded(approval.reasoning)) {
      addUpdate(approval, 'needs-fix', 'cleanup: executed low-quality source was re-opened as needs-fix');
      continue;
    }
    if (hasSeededZero(approval.reasoning) && !hasActiveSource) {
      addUpdate(approval, 'needs-fix', 'cleanup: executed source seeded zero articles and no active registry source was found');
    }
  }

  for (const approval of approvals) {
    if (String(approval.status || '').toLowerCase() !== 'needs-fix') continue;
    const url = normalizeApprovalUrl(approval.payload?.url);
    const host = hostForUrl(approval.payload?.url);
    const hasActiveSource = activeUrls.has(url) || (host && activeHosts.has(host));
    const ageHours = ageHoursFromNow(approval.created_at, now);
    if (
      !hasActiveSource
      && Number(ageHours || 0) >= 96
      && hasProbeRejectReason(approval.reasoning)
      && !hasRepairSuccessReason(approval.reasoning)
    ) {
      addUpdate(approval, 'rejected', 'cleanup: stale needs-fix source had no passing repair candidate after 96h');
    }
  }

  const plannedStatusById = new Map(updates.map((update) => [update.id, update.toStatus]));
  const openByUrl = new Map();
  for (const approval of approvals) {
    const effectiveStatus = plannedStatusById.get(Number(approval.id)) || String(approval.status || '').toLowerCase();
    if (!['pending', 'needs-fix'].includes(effectiveStatus)) continue;
    const url = normalizeApprovalUrl(approval.payload?.url);
    if (!url) continue;
    const bucket = openByUrl.get(url) || [];
    bucket.push(approval);
    openByUrl.set(url, bucket);
  }

  for (const [url, bucket] of openByUrl.entries()) {
    const sorted = bucket.slice().sort(newestFirst);
    const host = hostForUrl(url);
    const activeUrl = activeUrls.has(url) ? url : activeHosts.get(host);
    if (activeUrl) {
      for (const approval of sorted) {
        addUpdate(approval, 'rejected', `cleanup: superseded by active source registry ${activeUrl}`);
      }
      continue;
    }

    const [keeper, ...duplicates] = sorted;
    for (const approval of duplicates) {
      addUpdate(approval, 'rejected', `cleanup: duplicate open source approval; latest retained as #${keeper.id}`);
    }
  }

  return updates.sort((a, b) => a.id - b.id);
}

async function readActiveSources() {
  const registryPath = path.resolve('data', 'persistent-cache', 'source-registry%3Av1.json');
  if (!existsSync(registryPath)) return [];
  const parsed = JSON.parse(await readFile(registryPath, 'utf8'));
  const discoveredSources = parsed?.data?.discoveredSources;
  return Array.isArray(discoveredSources)
    ? discoveredSources.filter((source) => source.status === 'active')
    : [];
}

async function main() {
  const { apply, dryRun } = parseArgs();
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    const { rows: approvals } = await client.query(`
      SELECT id, action_type, payload, status, reasoning, created_at, reviewed_at, reviewer
      FROM approval_queue
      WHERE action_type = 'add-rss'
      ORDER BY id
    `);
    const activeSources = await readActiveSources();
    const updates = planApprovalQueueCleanup({ approvals, activeSources });
    const audit = {
      dryRun,
      generatedAt: new Date().toISOString(),
      approvalCount: approvals.length,
      activeSourceCount: activeSources.length,
      updateCount: updates.length,
      updates,
    };
    await mkdir(path.resolve('data', 'audits'), { recursive: true });
    const auditPath = path.resolve('data', 'audits', `source-approval-cleanup-${Date.now()}.json`);
    await writeFile(auditPath, JSON.stringify(audit, null, 2));

    if (apply && updates.length) {
      await client.query('BEGIN');
      try {
        for (const update of updates) {
          await client.query(
            `
              UPDATE approval_queue
              SET status = $2,
                  reviewed_at = NOW(),
                  reviewer = 'codex-source-approval-cleanup',
                  reasoning = CASE
                    WHEN COALESCE(reasoning, '') = '' THEN $3
                    WHEN reasoning LIKE '%' || E'\n' || $3 THEN reasoning
                    ELSE reasoning || E'\n' || $3
                  END
              WHERE id = $1
            `,
            [update.id, update.toStatus, update.note],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(JSON.stringify({
      ok: true,
      dryRun,
      applied: apply,
      updateCount: updates.length,
      auditPath,
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
