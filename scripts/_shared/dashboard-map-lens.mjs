/**
 * Map lens filtering + anchor resolution for event-dashboard-api.
 *
 * Extracted from event-dashboard-api.mjs during the 2026-04-18 mega-file
 * split pilot. Pure, side-effect-free — can be unit-tested without DB
 * fixtures. No runtime dependencies on the rest of the dashboard API.
 */

export const MAP_LENS_FILTER_TERMS = {
  all: [],
  conflict: ['conflict', 'war', 'defense', 'military', 'drone', 'sanction', 'security', 'iran', 'israel', 'ukraine', 'russia'],
  macro: ['macro', 'macroeconomics', 'fiscal', 'inflation', 'rates', 'liquidity', 'yield', 'monetary', 'budget', 'trade'],
  tech: ['technology', 'technology-general', 'ai', 'cloud', 'robotics', 'semiconductor', 'cyber', 'quantum', 'science'],
  energy: ['energy', 'oil', 'gas', 'lng', 'clean-energy', 'renewable', 'power', 'electricity', 'grid'],
  climate: ['climate', 'wildfire', 'water', 'agriculture', 'weather', 'heat', 'resilience', 'environment'],
};

export const MAP_LENS_ANCHORS = [
  { id: 'iran', lat: 35.6892, lon: 51.389, terms: ['iran', 'tehran', 'persian gulf', 'hormuz'], filters: ['conflict', 'energy'] },
  { id: 'israel', lat: 31.7683, lon: 35.2137, terms: ['israel', 'gaza', 'tel aviv', 'jerusalem'], filters: ['conflict', 'energy'] },
  { id: 'ukraine', lat: 50.4501, lon: 30.5234, terms: ['ukraine', 'kyiv', 'kiev', 'donbas', 'crimea'], filters: ['conflict', 'energy'] },
  { id: 'russia', lat: 55.7558, lon: 37.6173, terms: ['russia', 'moscow', 'kremlin'], filters: ['conflict', 'energy'] },
  { id: 'taiwan', lat: 25.033, lon: 121.5654, terms: ['taiwan', 'tsmc', 'strait', 'taipei'], filters: ['tech', 'conflict'] },
  { id: 'seoul', lat: 37.5665, lon: 126.978, terms: ['korea', 'seoul', 'semiconductor', 'memory chip'], filters: ['tech'] },
  { id: 'tokyo', lat: 35.6762, lon: 139.6503, terms: ['japan', 'tokyo'], filters: ['tech', 'macro'] },
  { id: 'silicon-valley', lat: 37.3875, lon: -122.0575, terms: ['ai', 'cloud', 'data center', 'nvidia', 'silicon valley'], filters: ['tech'] },
  { id: 'london', lat: 51.5072, lon: -0.1276, terms: ['uk', 'britain', 'london', 'budget', 'gilts'], filters: ['macro'] },
  { id: 'washington', lat: 38.9072, lon: -77.0369, terms: ['us', 'federal reserve', 'treasury', 'washington', 'congress'], filters: ['macro', 'tech'] },
  { id: 'dubai', lat: 25.2048, lon: 55.2708, terms: ['shipping', 'suez', 'red sea', 'middle east', 'energy', 'oil'], filters: ['energy', 'conflict'] },
  { id: 'singapore', lat: 1.3521, lon: 103.8198, terms: ['shipping', 'strait', 'container', 'freight', 'logistics'], filters: ['energy', 'macro', 'tech'] },
  { id: 'santiago', lat: -33.4489, lon: -70.6693, terms: ['lithium', 'copper', 'critical minerals'], filters: ['energy', 'climate', 'tech'] },
  { id: 'amazon', lat: -3.4653, lon: -62.2159, terms: ['climate', 'wildfire', 'amazon', 'deforestation'], filters: ['climate'] },
  { id: 'australia', lat: -35.2809, lon: 149.13, terms: ['weather', 'wildfire', 'heat', 'water stress'], filters: ['climate', 'energy'] },
];

export const TRANSMISSION_TARGETS = {
  commodity: { lat: 25.2048, lon: 55.2708, label: 'Commodity markets' },
  equity: { lat: 40.7128, lon: -74.006, label: 'Equity markets' },
  currency: { lat: 51.5072, lon: -0.1276, label: 'FX markets' },
  rates: { lat: 38.8951, lon: -77.0364, label: 'Rates markets' },
  country: { lat: 48.8566, lon: 2.3522, label: 'Country exposure' },
  'supply-chain': { lat: 1.3521, lon: 103.8198, label: 'Supply-chain hubs' },
};

export function normalizeLensFilter(value) {
  const normalized = String(value || 'all').trim().toLowerCase();
  return Object.hasOwn(MAP_LENS_FILTER_TERMS, normalized) ? normalized : 'all';
}

export function normalizeLensText(...values) {
  return values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

export function matchesLensFilter(filter, text) {
  if (filter === 'all') return true;
  return MAP_LENS_FILTER_TERMS[filter].some((term) => text.includes(term));
}

export function inferMapLensAnchor(title, theme, filter = 'all') {
  const text = normalizeLensText(title, theme);
  const direct = MAP_LENS_ANCHORS.find((anchor) => anchor.terms.some((term) => text.includes(term)));
  if (direct) return direct;
  if (filter !== 'all') {
    return MAP_LENS_ANCHORS.find((anchor) => anchor.filters.includes(filter)) || null;
  }
  return MAP_LENS_ANCHORS[0] || null;
}
