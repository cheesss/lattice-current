/*
 * World Bank Indicators API adapter.
 *
 * Free, no key required. Adds long-horizon macro context: country/region
 * GDP, infrastructure investment, ICT/internet metrics, fixed-broadband
 * subscriptions — useful for theme reports that need a global structural
 * frame ("US data-center investment is X% of global infrastructure spend").
 *
 * Each theme has a curated set of indicator codes. Themes outside the
 * curated set return ok=true with empty pack (no error — just no relevant
 * macro indicators).
 */

import { safeFetchJson, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'world-bank',
  displayName: 'World Bank Indicators',
  keyEnvVar: null,
  signupUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-developer-information-overview',
  subjectKinds: [SUBJECT_KINDS.THEME],
  pricing: 'free',
  monthlyCost: 0,
  dataKinds: ['macro_indicators', 'country_series', 'global_aggregates'],
};

/* Curated indicator map per theme. Indicator codes from
 * https://data.worldbank.org/indicator. Each value is a 1-3 indicator
 * series we'll fetch for the world (WLD) aggregate. */
const THEME_INDICATORS = {
  'cloud-infrastructure': [
    { code: 'IT.NET.BBND.P2', label: 'Fixed broadband subscriptions per 100 people' },
    { code: 'IT.NET.USER.ZS', label: 'Internet users (% of population)' },
    { code: 'GB.XPD.RSDV.GD.ZS', label: 'R&D expenditure (% of GDP)' },
  ],
  'ai-ml': [
    { code: 'GB.XPD.RSDV.GD.ZS', label: 'R&D expenditure (% of GDP)' },
    { code: 'IP.PAT.RESD', label: 'Patent applications, residents' },
  ],
  'semiconductor': [
    { code: 'GB.XPD.RSDV.GD.ZS', label: 'R&D expenditure (% of GDP)' },
    { code: 'IP.PAT.RESD', label: 'Patent applications, residents' },
  ],
  'renewable-energy': [
    { code: 'EG.FEC.RNEW.ZS', label: 'Renewable energy share of total final consumption (%)' },
    { code: 'EG.ELC.RNEW.ZS', label: 'Renewable electricity output (% of total)' },
  ],
  'energy': [
    { code: 'EG.USE.PCAP.KG.OE', label: 'Energy use per capita (kg of oil equivalent)' },
    { code: 'EG.IMP.CONS.ZS', label: 'Energy imports, net (% of energy use)' },
  ],
};

export function isAvailable() { return true; }

export async function loadFor(subject, opts = {}) {
  const themeKey = subject?.kind === SUBJECT_KINDS.THEME ? subject.key : (opts.theme || subject?.theme);
  if (!themeKey) {
    return { ok: false, errors: [{ kind: 'no_theme', message: 'World Bank adapter needs a theme key.' }] };
  }
  const indicators = THEME_INDICATORS[themeKey];
  if (!indicators) {
    return { ok: true, pack: { available: false, reason: `no curated indicator set for theme "${themeKey}"`, themeKey }, errors: [] };
  }
  /* Fetch each indicator for WLD (world aggregate), latest 5 years */
  const series = [];
  const errors = [];
  for (const ind of indicators) {
    const url = `https://api.worldbank.org/v2/country/WLD/indicator/${ind.code}?format=json&date=2018:2024&per_page=10`;
    const r = await safeFetchJson(url);
    if (!r.ok) { errors.push({ kind: 'fetch_failed', code: ind.code, error: r.error }); continue; }
    const rows = (r.json?.[1] || []).filter((row) => row.value != null).slice(0, 6);
    series.push({
      code: ind.code,
      label: ind.label,
      country: 'World (aggregate)',
      observations: rows.map((row) => ({ date: row.date, value: row.value })),
      latest: rows[0] ? { date: rows[0].date, value: rows[0].value } : null,
    });
    /* Rate-limit polite */
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    ok: true,
    pack: {
      available: series.length > 0,
      themeKey,
      indicators: series,
    },
    errors,
  };
}
