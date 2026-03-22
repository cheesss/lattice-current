
/**
 * Mock implementation of focal point detector.
 */
export const focalPointDetector = {
  getCountryUrgencyMap(): Map<string, 'critical' | 'elevated' | 'normal' | 'low'> {
    const map = new Map<string, 'critical' | 'elevated' | 'normal' | 'low'>();
    map.set('UA', 'critical');
    map.set('IR', 'critical');
    map.set('IL', 'critical');
    map.set('RU', 'elevated');
    map.set('CN', 'elevated');
    return map;
  },
  
  getCountryUrgency(code: string): 'critical' | 'elevated' | 'normal' | 'low' {
    const map = this.getCountryUrgencyMap();
    return map.get(code) || 'low';
  },

  getFocalPointForCountry(code: string): { lat: number; lon: number; displayName: string; newsMentions: number; urgency: string } | null {
    const map: Record<string, { lat: number; lon: number; displayName: string; newsMentions: number; urgency: string }> = {
      'UA': { lat: 48.3794, lon: 31.1656, displayName: 'Ukraine', newsMentions: 125, urgency: 'critical' },
      'IR': { lat: 32.4279, lon: 53.6880, displayName: 'Iran', newsMentions: 88, urgency: 'critical' },
      'IL': { lat: 31.0461, lon: 34.8516, displayName: 'Israel', newsMentions: 92, urgency: 'critical' },
      'SY': { lat: 34.8021, lon: 38.9968, displayName: 'Syria', newsMentions: 45, urgency: 'elevated' },
      'TW': { lat: 23.6978, lon: 120.9605, displayName: 'Taiwan', newsMentions: 74, urgency: 'elevated' },
    };
    return map[code.toUpperCase()] || null;
  },

  getNewsCorrelationContext(countries: string[]): string {
    return countries.map(c => `${c} correlation high`).join(', ');
  },

  analyze(_clusters: any[], _signals: any): any {
    return {
      focalPoints: [],
      aiContext: '',
      timestamp: new Date(),
      topCountries: [],
      topCompanies: [],
    };
  }
};
