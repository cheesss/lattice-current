#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isLowValueGoogleNewsSource,
  lowValueGoogleNewsReason,
} from './_shared/google-news-source-policy.mjs';

const DEFAULT_REGISTRY_PATH = path.resolve('data', 'persistent-cache', 'source-registry%3Av1.json');

function parseArgs(argv = process.argv.slice(2)) {
  return {
    registry: argv.includes('--registry') ? argv[argv.indexOf('--registry') + 1] : DEFAULT_REGISTRY_PATH,
    apply: argv.includes('--apply'),
  };
}

function getSources(payload) {
  const sources = payload?.data?.discoveredSources;
  return Array.isArray(sources) ? sources : [];
}

export async function planLowValueGoogleNewsQuarantine(registryPath = DEFAULT_REGISTRY_PATH) {
  const parsed = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  const sources = getSources(parsed);
  const updates = [];
  for (const source of sources) {
    const status = String(source?.status || '').toLowerCase();
    if (!['active', 'approved', 'draft'].includes(status)) continue;
    if (!isLowValueGoogleNewsSource({
      url: source.url,
      feedName: source.feedName,
      category: source.category,
      theme: source.category,
      topics: source.topics,
    })) {
      continue;
    }
    updates.push({
      id: source.id,
      fromStatus: source.status,
      toStatus: 'quarantined',
      feedName: source.feedName,
      url: source.url,
      reason: lowValueGoogleNewsReason(source),
    });
  }
  return { parsed, updates };
}

export async function quarantineLowValueGoogleNewsSources(options = {}) {
  const registryPath = options.registry || DEFAULT_REGISTRY_PATH;
  const apply = Boolean(options.apply);
  const { parsed, updates } = await planLowValueGoogleNewsQuarantine(registryPath);
  if (apply && updates.length > 0) {
    const byId = new Map(updates.map((update) => [update.id, update]));
    parsed.data.discoveredSources = getSources(parsed).map((source) => {
      const update = byId.get(source.id);
      if (!update) return source;
      return {
        ...source,
        status: update.toStatus,
        quarantineReason: update.reason,
        updatedAt: Date.now(),
      };
    });
    await fs.writeFile(registryPath, JSON.stringify(parsed, null, 2), 'utf8');
  }
  return {
    ok: true,
    applied: apply,
    updateCount: updates.length,
    updates,
  };
}

async function main() {
  const summary = await quarantineLowValueGoogleNewsSources(parseArgs());
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
