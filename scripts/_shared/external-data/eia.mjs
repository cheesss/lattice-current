/*
 * EIA (US Energy Information Administration) adapter.
 *
 * Free with API key. Adds energy/electricity/petroleum/natural-gas data.
 * Critical for energy / cloud-infrastructure (data-center power) / EV /
 * grid themes.
 *
 * Get a key:
 *   1. https://www.eia.gov/opendata/register.php
 *   2. Free, instant, requires email
 *   3. Add to .env.local: EIA_API_KEY=your-40-char-key
 */

import { safeFetchJson, resolveEnvKey, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'eia',
  displayName: 'EIA (Energy Information Administration)',
  keyEnvVar: 'EIA_API_KEY',
  signupUrl: 'https://www.eia.gov/opendata/register.php',
  subjectKinds: [SUBJECT_KINDS.THEME],
  pricing: 'free-with-key',
  monthlyCost: 0,
  dataKinds: ['energy', 'electricity', 'natural_gas', 'petroleum', 'coal', 'renewable'],
};

const THEME_SERIES = {
  'cloud-infrastructure': [
    /* Data centers consume ~2% of US electricity; growing fast. */
    { route: 'electricity/retail-sales/data', frequency: 'monthly', data: ['sales'], facets: { sectorid: ['COM'], stateid: ['US'] }, label: 'US Commercial Sector Electricity Sales' },
  ],
  'data-center-infrastructure': [
    { route: 'electricity/retail-sales/data', frequency: 'monthly', data: ['sales'], facets: { sectorid: ['COM'], stateid: ['US'] }, label: 'US Commercial Sector Electricity Sales' },
  ],
  'ai-ml': [
    { route: 'electricity/retail-sales/data', frequency: 'monthly', data: ['sales'], facets: { sectorid: ['COM'], stateid: ['US'] }, label: 'US Commercial Sector Electricity Sales' },
  ],
  'ai-machine-learning': [
    { route: 'electricity/retail-sales/data', frequency: 'monthly', data: ['sales'], facets: { sectorid: ['COM'], stateid: ['US'] }, label: 'US Commercial Sector Electricity Sales' },
  ],
  'energy': [
    { route: 'petroleum/pri/spt/data', frequency: 'weekly', data: ['value'], facets: { series: ['RWTC'] }, label: 'WTI Spot Price' },
    { route: 'natural-gas/pri/sum/data', frequency: 'weekly', data: ['value'], facets: { series: ['RNGWHHD'] }, label: 'Henry Hub Spot Price' },
  ],
  'renewable-energy': [
    { route: 'electricity/electric-power-operational-data/data', frequency: 'monthly', data: ['generation'], facets: { fueltypeid: ['SUN', 'WND'] }, label: 'US Solar + Wind Generation' },
  ],
  'electric-vehicles': [
    { route: 'electricity/retail-sales/data', frequency: 'monthly', data: ['sales'], facets: { sectorid: ['TRA'], stateid: ['US'] }, label: 'US Transportation Sector Electricity Sales' },
  ],
};

export function isAvailable() {
  return resolveEnvKey('EIA_API_KEY') !== null;
}

export async function loadFor(subject, opts = {}) {
  const apiKey = resolveEnvKey('EIA_API_KEY');
  if (!apiKey) return { ok: false, errors: [{ kind: 'no_key', message: 'EIA_API_KEY not set.' }] };
  const themeKey = subject?.kind === SUBJECT_KINDS.THEME ? subject.key : (opts.theme || subject?.theme);
  if (!themeKey) return { ok: false, errors: [{ kind: 'no_theme', message: 'EIA adapter needs a theme key.' }] };
  const queries = THEME_SERIES[themeKey];
  if (!queries) return { ok: true, pack: { available: false, reason: `no curated EIA series for theme "${themeKey}"`, themeKey }, errors: [] };
  const out = [];
  const errors = [];
  for (const q of queries) {
    const params = new URLSearchParams({
      api_key: apiKey,
      frequency: q.frequency,
      'data[0]': q.data[0],
      length: '12',
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
    });
    for (const [k, vs] of Object.entries(q.facets || {})) {
      for (const v of vs) params.append(`facets[${k}][]`, v);
    }
    const url = `https://api.eia.gov/v2/${q.route}?${params.toString()}`;
    const r = await safeFetchJson(url);
    if (!r.ok) { errors.push({ kind: 'fetch_failed', route: q.route, error: r.error }); continue; }
    const data = r.json?.response?.data || [];
    out.push({
      label: q.label,
      route: q.route,
      latest: data[0] || null,
      series: data.slice(0, 6),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    ok: true,
    pack: { available: out.length > 0, themeKey, series: out },
    errors,
  };
}
