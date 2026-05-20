/**
 * File-backed JSON cache helpers + cache-key utilities for the event
 * dashboard API.
 *
 * Extracted from event-dashboard-api.mjs during the mega-file split pilot.
 * Pure helpers only — `resolveWithCache` stays in the main file because it
 * couples to `withMeta` and `buildJsonResponse` + `logger` (still living in
 * event-dashboard-api.mjs until signal-quality extraction).
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const CACHE_DIR = path.resolve('data', 'event-dashboard-cache');

export async function readJsonCache(name) {
  const filePath = path.join(CACHE_DIR, `${name}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJsonCache(name, payload) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(payload, null, 2));
}

export function hasRenderableData(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return Object.values(payload).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    if (typeof value === 'number') return value > 0;
    return false;
  });
}

export function toCacheToken(value) {
  const normalized = String(value ?? 'all')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'all';
}

export function buildCacheKey(prefix, ...parts) {
  return [prefix, ...parts.map((part) => toCacheToken(part))].join('--');
}

export function hasDynamicSinceParams(params) {
  if (!params || typeof params.keys !== 'function') return false;
  if (params.has('since')) return true;
  return Array.from(params.keys()).some((key) => String(key || '').startsWith('since_'));
}

export function buildSinceToken(params, keyPrefix = 'since') {
  const parts = [];
  for (const [key, value] of params.entries()) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}_`)) {
      parts.push(`${key}:${value}`);
    }
  }
  parts.sort();
  return parts.length > 0 ? parts.join('|') : 'none';
}
