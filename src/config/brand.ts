export const APP_BRAND = {
  name: 'Lattice Current',
  mark: 'LATTICE',
  descriptor: 'CURRENT',
  tagline: 'Signal OS for analysts, investors, and operators',
  workspaceKicker: 'Signal OS',
  liveFeedLabel: 'SIGNAL BUS',
  mapLabels: {
    full: 'Signal Field',
    tech: 'Builder Field',
    finance: 'Market Field',
    happy: 'Progress Atlas',
  },
  hubs: {
    analysis: 'Briefing Desk',
    codex: 'Research Desk',
    backtest: 'Replay Studio',
    ontology: 'Graph Studio',
  },
  variants: {
    full: { icon: 'G', label: 'Geo' },
    tech: { icon: 'B', label: 'Build' },
    finance: { icon: 'M', label: 'Markets' },
    happy: { icon: 'P', label: 'Progress' },
    commodity: { icon: 'S', label: 'Supply' },
  },
} as const;

export type BrandVariantKey = keyof typeof APP_BRAND.variants;
