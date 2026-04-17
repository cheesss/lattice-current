/**
 * Shared accessor for market-quote-symbols.json. One source of truth for
 * symbols required by nowcast training + inference. See the JSON file for
 * the canonical layout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(HERE, 'market-quote-symbols.json');

let cached = null;

function load() {
  if (cached) return cached;
  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export function getCoreSnapshots() {
  return [...load().coreSnapshots];
}

export function getNowcastFeatureMap() {
  const { nowcastFeatures } = load();
  const out = {};
  for (const [target, symbols] of Object.entries(nowcastFeatures)) {
    out[target] = [...symbols];
  }
  return out;
}

export function getNowcastFeatureSymbols(target) {
  const map = load().nowcastFeatures;
  const syms = map[target];
  if (!syms) throw new Error(`unknown nowcast target: ${target}`);
  return [...syms];
}

/**
 * Union of coreSnapshots and every nowcast feature symbol, de-duplicated and
 * sorted deterministically. This is the canonical set that the daemon refresh
 * should poll and that bootstrap + coverage audit should verify.
 */
export function getAllRequiredSymbols() {
  const data = load();
  const set = new Set(data.coreSnapshots);
  for (const syms of Object.values(data.nowcastFeatures)) {
    for (const s of syms) set.add(s);
  }
  return Array.from(set).sort();
}

export function getSignalMappings() {
  return { ...load().signalMappings };
}
