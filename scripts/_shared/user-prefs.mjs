/**
 * User preferences (S-Tier C1).
 *
 * Single-user mode storage at data/user-prefs.json. When auth + multi-tenant
 * lands, this becomes a per-user row in DB; for now a flat JSON file scoped
 * by user id (default = 'default').
 *
 * Distinct from settings.html / settings-main.ts which is the DESKTOP
 * runtime config (Tauri secrets, Ollama models, feature flags). This module
 * tracks USER preferences that apply to the dashboard UX:
 *
 *   language          'en' | 'ko'
 *   defaultLane       'all' | 'validated' | 'pending' | 'watch' | 'noise'
 *   alerts            { validatedSignalThreshold, opsCriticalEnabled, ... }
 *   refreshIntervalMs how often dashboard polls (10..600 sec)
 *   showOnboarding    boolean — re-show the onboarding tour on next load
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PREFS_PATH = path.resolve('data', 'user-prefs.json');
const PREFS_VERSION = 1;

const DEFAULT_PREFS = {
  language: 'en',
  defaultLane: 'all',
  alerts: {
    validatedSignalThreshold: 1,
    opsCriticalEnabled: true,
    staleNotifyMinutes: 30,
  },
  refreshIntervalMs: 60_000,
  showOnboarding: false,
  watchlistTags: [],
  updatedAt: null,
};

const VALID_LANGS = new Set(['en', 'ko']);
const VALID_LANES = new Set(['all', 'validated', 'pending', 'watch', 'noise']);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function readPrefsFile() {
  if (!existsSync(PREFS_PATH)) return { version: PREFS_VERSION, users: {} };
  try {
    const raw = await readFile(PREFS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: PREFS_VERSION, users: {} };
    if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
    return parsed;
  } catch {
    return { version: PREFS_VERSION, users: {} };
  }
}

async function writePrefsFile(file) {
  await mkdir(path.dirname(PREFS_PATH), { recursive: true });
  await writeFile(PREFS_PATH, JSON.stringify(file, null, 2), 'utf8');
}

export async function getUserPrefs(userId = 'default') {
  const file = await readPrefsFile();
  const stored = file.users[userId] || {};
  return { ...DEFAULT_PREFS, ...stored };
}

/**
 * Validate + merge incoming partial prefs onto the stored ones.
 * Returns the merged result. Unknown keys are dropped silently.
 */
export async function setUserPrefs(userId = 'default', partial = {}) {
  if (!partial || typeof partial !== 'object') {
    throw new Error('user-prefs: partial must be an object');
  }
  const file = await readPrefsFile();
  const current = { ...DEFAULT_PREFS, ...(file.users[userId] || {}) };
  const next = { ...current };

  if (partial.language !== undefined) {
    const lang = String(partial.language).toLowerCase();
    if (VALID_LANGS.has(lang)) next.language = lang;
  }
  if (partial.defaultLane !== undefined) {
    const lane = String(partial.defaultLane).toLowerCase();
    if (VALID_LANES.has(lane)) next.defaultLane = lane;
  }
  if (partial.refreshIntervalMs !== undefined) {
    next.refreshIntervalMs = clampInt(partial.refreshIntervalMs, 10_000, 600_000, current.refreshIntervalMs);
  }
  if (partial.showOnboarding !== undefined) {
    next.showOnboarding = Boolean(partial.showOnboarding);
  }
  if (partial.alerts && typeof partial.alerts === 'object') {
    const a = { ...current.alerts };
    if (partial.alerts.validatedSignalThreshold !== undefined) {
      a.validatedSignalThreshold = clampInt(partial.alerts.validatedSignalThreshold, 0, 100, a.validatedSignalThreshold);
    }
    if (partial.alerts.opsCriticalEnabled !== undefined) {
      a.opsCriticalEnabled = Boolean(partial.alerts.opsCriticalEnabled);
    }
    if (partial.alerts.staleNotifyMinutes !== undefined) {
      a.staleNotifyMinutes = clampInt(partial.alerts.staleNotifyMinutes, 5, 1440, a.staleNotifyMinutes);
    }
    next.alerts = a;
  }
  if (Array.isArray(partial.watchlistTags)) {
    next.watchlistTags = partial.watchlistTags
      .map((t) => String(t).trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 32);
  }

  next.updatedAt = new Date().toISOString();
  file.version = PREFS_VERSION;
  file.users[userId] = next;
  await writePrefsFile(file);
  return next;
}

export async function resetUserPrefs(userId = 'default') {
  const file = await readPrefsFile();
  delete file.users[userId];
  await writePrefsFile(file);
  return { ...DEFAULT_PREFS };
}
