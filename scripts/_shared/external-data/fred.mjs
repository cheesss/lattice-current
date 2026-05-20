/*
 * FRED (Federal Reserve Economic Data) adapter.
 *
 * Free with API key. Adds macro/rates/credit context. Per-theme curated
 * series: rates for credit-sensitive themes, ISM/PMI for industrials,
 * unemployment + housing for consumer themes.
 *
 * Get a key:
 *   1. https://fred.stlouisfed.org/docs/api/api_key.html → "Request API Key"
 *   2. Free, instant, requires email
 *   3. Add to .env.local: FRED_API_KEY=your-32-char-key
 */

import { safeFetchJson, resolveEnvKey, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'fred',
  displayName: 'FRED (Federal Reserve)',
  keyEnvVar: 'FRED_API_KEY',
  signupUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html',
  subjectKinds: [SUBJECT_KINDS.THEME, SUBJECT_KINDS.SYMBOL],
  pricing: 'free-with-key',
  monthlyCost: 0,
  dataKinds: ['macro', 'rates', 'credit_spread', 'employment', 'housing'],
};

const THEME_SERIES = {
  'cloud-infrastructure': [
    { id: 'GS10', label: '10-Year Treasury Constant Maturity Rate' },
    { id: 'BAMLH0A0HYM2', label: 'High Yield Index Option-Adjusted Spread' },
    { id: 'NEWORDER', label: 'New Orders, Computer & Electronic Products' },
  ],
  'semiconductor': [
    { id: 'NEWORDER', label: 'New Orders, Computer & Electronic Products' },
    { id: 'GS10', label: '10-Year Treasury Constant Maturity Rate' },
    { id: 'BUSINV', label: 'Total Business Inventories' },
  ],
  'energy': [
    { id: 'DCOILWTICO', label: 'WTI Crude Oil Price' },
    { id: 'DCOILBRENTEU', label: 'Brent Crude Oil Price' },
    { id: 'DHHNGSP', label: 'Henry Hub Natural Gas Spot Price' },
  ],
  'renewable-energy': [
    { id: 'DHHNGSP', label: 'Henry Hub Natural Gas Spot Price' },
    { id: 'DCOILWTICO', label: 'WTI Crude Oil Price' },
  ],
  'macroeconomy': [
    { id: 'GS10', label: '10-Year Treasury Constant Maturity Rate' },
    { id: 'T10Y2Y', label: '10Y-2Y Treasury Spread' },
    { id: 'UNRATE', label: 'Unemployment Rate' },
    { id: 'CPIAUCSL', label: 'CPI All Urban Consumers' },
  ],
  'housing': [
    { id: 'CSUSHPISA', label: 'Case-Shiller US National Home Price Index' },
    { id: 'MORTGAGE30US', label: '30-Year Fixed Rate Mortgage' },
    { id: 'PERMIT', label: 'New Privately-Owned Housing Units Authorized' },
  ],
};

export function isAvailable() {
  return resolveEnvKey('FRED_API_KEY') !== null;
}

export async function loadFor(subject, opts = {}) {
  const apiKey = resolveEnvKey('FRED_API_KEY');
  if (!apiKey) {
    return { ok: false, errors: [{ kind: 'no_key', message: 'FRED_API_KEY not set.' }] };
  }
  const themeKey = subject?.kind === SUBJECT_KINDS.THEME ? subject.key : (opts.theme || subject?.theme);
  if (!themeKey) {
    return { ok: false, errors: [{ kind: 'no_theme', message: 'FRED adapter needs a theme key.' }] };
  }
  const series = THEME_SERIES[themeKey] || THEME_SERIES['macroeconomy'];
  const out = [];
  const errors = [];
  for (const s of series) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&api_key=${apiKey}&file_type=json&limit=12&sort_order=desc`;
    const r = await safeFetchJson(url);
    if (!r.ok) { errors.push({ kind: 'fetch_failed', id: s.id, error: r.error }); continue; }
    const obs = (r.json?.observations || []).filter((o) => o.value !== '.').slice(0, 6);
    out.push({
      id: s.id,
      label: s.label,
      latest: obs[0] ? { date: obs[0].date, value: Number(obs[0].value) } : null,
      series: obs.map((o) => ({ date: o.date, value: Number(o.value) })),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    ok: true,
    pack: {
      available: out.length > 0,
      themeKey,
      seriesCount: out.length,
      series: out,
    },
    errors,
  };
}
