export const COT_PRE_DATASETS = {
  tff: {
    resourceId: 'udgc-27he',
    dateField: 'report_date_as_yyyy_mm_dd',
    marketField: 'market_and_exchange_names',
    openInterestField: 'open_interest_all',
    longField: 'lev_money_positions_long',
    shortField: 'lev_money_positions_short',
  },
  disagg: {
    resourceId: '72hh-3qpy',
    dateField: 'report_date_as_yyyy_mm_dd',
    marketField: 'market_and_exchange_names',
    openInterestField: 'open_interest_all',
    longField: 'm_money_positions_long_all',
    shortField: 'm_money_positions_short_all',
  },
};

export const COT_ASSET_SPECS = [
  { asset: 'sp500', dataset: 'tff', patterns: ['E-MINI S&P 500'] },
  { asset: 'treasury_10y', dataset: 'tff', patterns: ['UST 10Y NOTE', '10-YEAR U.S. TREASURY NOTES'] },
  { asset: 'dollar', dataset: 'tff', patterns: ['U.S. DOLLAR INDEX'] },
  { asset: 'euro_fx', dataset: 'tff', patterns: ['EURO FX'] },
  { asset: 'gold', dataset: 'disagg', patterns: ['GOLD'] },
  { asset: 'oil', dataset: 'disagg', patterns: ['CRUDE OIL'] },
];

export const CBOE_PUTCALL_SOURCES = {
  totalRecent: 'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpc.csv',
  totalArchive: 'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpcarchive.csv',
};

export function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((value) => value.trim());
}

export function parseCsvTable(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

export function parseNumeric(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeUsDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

export function buildCotApiUrl(resourceId, columns, whereClause, limit = 50000) {
  const params = new URLSearchParams();
  params.set('$select', columns.join(','));
  params.set('$limit', String(limit));
  params.set('$order', 'report_date_as_yyyy_mm_dd ASC');
  if (whereClause) params.set('$where', whereClause);
  return `https://publicreporting.cftc.gov/resource/${resourceId}.json?${params.toString()}`;
}
