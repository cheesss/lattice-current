
/**
 * Mock implementation of country geometry/codes mapping.
 */
export function nameToCountryCode(name: string): string | null {
  const map: Record<string, string> = {
    'united states': 'US',
    'usa': 'US',
    'iran': 'IR',
    'israel': 'IL',
    'china': 'CN',
    'russia': 'RU',
    'germany': 'DE',
    'united kingdom': 'GB',
    'uk': 'GB',
    'japan': 'JP',
    'south korea': 'KR',
  };
  return map[name.toLowerCase()] || null;
}

export function getCountryNameByCode(code: string): string {
  const map: Record<string, string> = {
    'US': 'United States',
    'IR': 'Iran',
    'IL': 'Israel',
    'CN': 'China',
    'RU': 'Russia',
    'DE': 'Germany',
    'GB': 'United Kingdom',
    'JP': 'Japan',
    'KR': 'South Korea',
  };
  return map[code.toUpperCase()] || code;
}

export function getCountryAtCoordinates(lat: number, lon: number): { code: string; name: string } | null {
  let code: string | null = null;
  // Very simplified bounding boxes for key regions
  if (lat > 24 && lat < 49 && lon > -125 && lon < -66) code = 'US';
  else if (lat > 25 && lat < 39 && lon > 44 && lon < 63) code = 'IR';
  else if (lat > 29 && lat < 34 && lon > 34 && lon < 36) code = 'IL';
  
  if (!code) return null;
  return { code, name: getCountryNameByCode(code) };
}

export const ME_STRIKE_BOUNDS = {
  latMin: 20,
  latMax: 45,
  lonMin: 30,
  lonMax: 70,
};

export function resolveCountryFromBounds(lat: number, lon: number, _bounds?: any): string | null {
  return getCountryAtCoordinates(lat, lon)?.code || null;
}

export function getCountryBbox(code: string): [number, number, number, number] | null {
  const map: Record<string, [number, number, number, number]> = {
    'US': [-125, 24, -66, 49],
    'IR': [44, 25, 63, 39],
    'IL': [34, 29, 36, 34],
  };
  return map[code.toUpperCase()] || null;
}

export function ensureISO2(code: string): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (c.length === 2) return c;
  if (c.length === 3) return iso3ToIso2Code(c);
  return nameToCountryCode(code);
}

export function iso3ToIso2Code(iso3: string): string | null {
  const map: Record<string, string> = {
    'USA': 'US',
    'RUS': 'RU',
    'CHN': 'CN',
    'UKR': 'UA',
    'IRN': 'IR',
    'ISR': 'IL',
    'TUR': 'TR',
    'SAU': 'SA',
    'GBR': 'GB',
    'DEU': 'DE',
    'FRA': 'FR',
    'JPN': 'JP',
    'KOR': 'KR',
  };
  return map[iso3.toUpperCase()] || null;
}

export function matchCountryNamesInText(text: string): string[] {
  const matched = new Set<string>();
  const map: Record<string, string> = {
    'united states': 'US',
    'usa': 'US',
    'russia': 'RU',
    'china': 'CN',
    'ukraine': 'UA',
    'iran': 'IR',
    'israel': 'IL',
    'turkey': 'TR',
    'saudi arabia': 'SA',
    'united kingdom': 'GB',
    'uk': 'GB',
    'germany': 'DE',
    'france': 'FR',
    'japan': 'JP',
    'south korea': 'KR',
  };
  for (const [name, code] of Object.entries(map)) {
    if (text.includes(name)) matched.add(code);
  }
  return Array.from(matched);
}

export function getCountryCentroid(code: string): [number, number] | null {
  const b = getCountryBbox(code);
  if (!b) return null;
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

export function hasCountryGeometry(code: string): boolean {
  return !!getCountryBbox(code);
}

export function isCoordinateInCountry(lat: number, lon: number, code: string): boolean {
  const b = getCountryBbox(code);
  if (!b) return false;
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

export async function getCountriesGeoJson(): Promise<any> {
  return { type: 'FeatureCollection', features: [] };
}

export async function preloadCountryGeometry(): Promise<void> {
  return Promise.resolve();
}
