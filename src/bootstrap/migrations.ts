/**
 * One-time localStorage migrations, extracted from App constructor.
 *
 * Each migration runs exactly once (guarded by a localStorage key).
 * New migrations should be appended to the list — they execute in order.
 */

import type { PanelConfig } from '@/types';
import {
  STORAGE_KEYS,
  SITE_VARIANT,
  ALL_PANELS,
  DEFAULT_PANELS,
  VARIANT_DEFAULTS,
  getEffectivePanelConfig,
} from '@/config';
import { computeDefaultDisabledSources, getLocaleBoostedSources, getTotalFeedCount } from '@/config/feeds';
import { loadFromStorage, saveToStorage } from '@/utils';

export interface MigrationContext {
  panelSettings: Record<string, PanelConfig>;
  panelOrderKey: string;
  panelSpansKey: string;
  currentVariant: string;
}

type MigrationFn = (ctx: MigrationContext) => void;

interface Migration {
  key: string;
  run: MigrationFn;
}

// ── Migration definitions ────────────────────────────────────────────────

/** v2.6: Rename legacy panel keys while preserving user preferences. */
function migratePanelKeyRenames(ctx: MigrationContext): void {
  const keyRenames: Array<[string, string]> = [
    ['live-youtube', 'live-webcams'],
    ['pinned-webcams', 'windy-webcams'],
  ];
  let migrated = false;
  for (const [legacyKey, nextKey] of keyRenames) {
    if (!ctx.panelSettings[legacyKey] || ctx.panelSettings[nextKey]) continue;
    ctx.panelSettings[nextKey] = {
      ...DEFAULT_PANELS[nextKey],
      ...ctx.panelSettings[legacyKey],
      name: DEFAULT_PANELS[nextKey]?.name ?? ctx.panelSettings[legacyKey].name,
    };
    delete ctx.panelSettings[legacyKey];
    migrated = true;
  }
  if (migrated) saveToStorage(STORAGE_KEYS.panels, ctx.panelSettings);
}

/** v1: Expose all panels to existing users (previously variant-gated). */
function migrateUnifiedPanels(ctx: MigrationContext): void {
  const variantDefaults = new Set(VARIANT_DEFAULTS[SITE_VARIANT] ?? []);
  for (const key of Object.keys(ALL_PANELS)) {
    if (!(key in ctx.panelSettings)) {
      ctx.panelSettings[key] = { ...getEffectivePanelConfig(key, SITE_VARIANT), enabled: variantDefaults.has(key) };
    }
  }
  saveToStorage(STORAGE_KEYS.panels, ctx.panelSettings);
}

/** v1.9: Reorder panels for existing users. */
function migratePanelOrder(ctx: MigrationContext): void {
  const savedOrder = localStorage.getItem(ctx.panelOrderKey);
  if (!savedOrder) return;
  try {
    const order: string[] = JSON.parse(savedOrder);
    const priorityPanels = ['insights', 'strategic-posture', 'cii', 'strategic-risk'];
    const filtered = order.filter(k => !priorityPanels.includes(k) && k !== 'live-news');
    const liveNewsIdx = order.indexOf('live-news');
    const newOrder = liveNewsIdx !== -1 ? ['live-news'] : [];
    newOrder.push(...priorityPanels.filter(p => order.includes(p)));
    newOrder.push(...filtered);
    localStorage.setItem(ctx.panelOrderKey, JSON.stringify(newOrder));
    console.log('[App] Migrated panel order to v1.9 layout');
  } catch {
    // Invalid saved order, will use defaults
  }
}

/** Tech variant: move insights panel to top (after live-news). */
function migrateTechInsightsTop(ctx: MigrationContext): void {
  if (ctx.currentVariant !== 'tech') return;
  const savedOrder = localStorage.getItem(ctx.panelOrderKey);
  if (!savedOrder) return;
  try {
    const order: string[] = JSON.parse(savedOrder);
    const filtered = order.filter(k => k !== 'insights' && k !== 'live-news');
    const newOrder: string[] = [];
    if (order.includes('live-news')) newOrder.push('live-news');
    if (order.includes('insights')) newOrder.push('insights');
    newOrder.push(...filtered);
    localStorage.setItem(ctx.panelOrderKey, JSON.stringify(newOrder));
    console.log('[App] Tech variant: Migrated insights panel to top');
  } catch {
    // Invalid saved order, will use defaults
  }
}

/** v1: Prune removed panel keys from stored settings and order. */
function migratePanelPrune(ctx: MigrationContext): void {
  const validKeys = new Set(Object.keys(ALL_PANELS));
  let pruned = false;
  for (const key of Object.keys(ctx.panelSettings)) {
    if (!validKeys.has(key) && key !== 'runtime-config') {
      delete ctx.panelSettings[key];
      pruned = true;
    }
  }
  if (pruned) saveToStorage(STORAGE_KEYS.panels, ctx.panelSettings);
  for (const orderKey of [ctx.panelOrderKey, ctx.panelOrderKey + '-bottom-set', ctx.panelOrderKey + '-bottom']) {
    try {
      const raw = localStorage.getItem(orderKey);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      const filtered = arr.filter((k: string) => validKeys.has(k));
      if (filtered.length !== arr.length) localStorage.setItem(orderKey, JSON.stringify(filtered));
    } catch { localStorage.removeItem(orderKey); }
  }
}

/** v2.5: Clear stale panel ordering and sizing state. */
function migrateLayoutReset(ctx: MigrationContext): void {
  const hadSavedOrder = !!localStorage.getItem(ctx.panelOrderKey);
  const hadSavedSpans = !!localStorage.getItem(ctx.panelSpansKey);
  if (hadSavedOrder || hadSavedSpans) {
    localStorage.removeItem(ctx.panelOrderKey);
    localStorage.removeItem(ctx.panelOrderKey + '-bottom');
    localStorage.removeItem(ctx.panelOrderKey + '-bottom-set');
    localStorage.removeItem(ctx.panelSpansKey);
    console.log('[App] Applied layout reset migration (v2.5): cleared panel order/spans');
  }
}

/** v3: Reduce default-enabled sources (full variant only). */
function migrateSourcesReduction(_ctx: MigrationContext): void {
  if (SITE_VARIANT !== 'full') return;
  const defaultDisabled = computeDefaultDisabledSources();
  saveToStorage(STORAGE_KEYS.disabledFeeds, defaultDisabled);
  const total = getTotalFeedCount();
  console.log(`[App] Sources reduction: ${defaultDisabled.length} disabled, ${total - defaultDisabled.length} enabled`);
}

/** per-locale: Additively enable locale-matched sources. */
function migrateLocaleBoost(_ctx: MigrationContext): void {
  if (SITE_VARIANT !== 'full') return;
  const userLang = ((navigator.language ?? 'en').split('-')[0] ?? 'en').toLowerCase();
  if (userLang === 'en') return;
  const boosted = getLocaleBoostedSources(userLang);
  if (boosted.size === 0) return;
  const current = loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []);
  const updated = current.filter(name => !boosted.has(name));
  saveToStorage(STORAGE_KEYS.disabledFeeds, updated);
  console.log(`[App] Locale boost (${userLang}): enabled ${current.length - updated.length} sources`);
}

// ── Migration registry (append-only, order matters) ──────────────────────

const MIGRATIONS: Migration[] = [
  { key: 'worldmonitor-panel-key-renames-v2.6', run: migratePanelKeyRenames },
  { key: 'worldmonitor-unified-panels-v1', run: migrateUnifiedPanels },
  { key: 'worldmonitor-panel-order-v1.9', run: migratePanelOrder },
  { key: 'worldmonitor-tech-insights-top-v1', run: migrateTechInsightsTop },
  { key: 'worldmonitor-panel-prune-v1', run: migratePanelPrune },
  { key: 'worldmonitor-layout-reset-v2.5', run: migrateLayoutReset },
  { key: 'worldmonitor-sources-reduction-v3', run: migrateSourcesReduction },
];

/**
 * Run all pending one-time migrations.
 * Each migration is guarded by a localStorage key — runs at most once.
 */
export function runMigrations(ctx: MigrationContext): void {
  for (const { key, run } of MIGRATIONS) {
    if (localStorage.getItem(key)) continue;
    try {
      run(ctx);
    } catch (e) {
      console.error(`[Migration] ${key} failed:`, e);
    }
    localStorage.setItem(key, 'done');
  }

  // Locale boost uses a dynamic key (per-language)
  const userLang = ((navigator.language ?? 'en').split('-')[0] ?? 'en').toLowerCase();
  const localeKey = `worldmonitor-locale-boost-${userLang}`;
  if (userLang !== 'en' && !localStorage.getItem(localeKey)) {
    try { migrateLocaleBoost(ctx); } catch (e) { console.error('[Migration] locale-boost failed:', e); }
    localStorage.setItem(localeKey, 'done');
  }
}
