export interface VariantMeta {
  title: string;
  description: string;
  keywords: string;
  url: string;
  siteName: string;
  shortName: string;
  subject: string;
  classification: string;
  categories: string[];
  features: string[];
}

export const VARIANT_META: { full: VariantMeta; [k: string]: VariantMeta } = {
  full: {
    title: 'Lattice Current - Signal OS for live risk, markets, and infrastructure',
    description: 'A live signal workspace for analysts and operators working across geopolitical risk, markets, infrastructure, and decision support.',
    keywords: 'signal workspace, geopolitical intelligence, market intelligence, infrastructure risk, replay analysis, decision support, analyst operating system, live signals, cross-asset intelligence',
    url: '/',
    siteName: 'Lattice Current',
    shortName: 'LatticeCurrent',
    subject: 'Live signal operating system for risk, markets, and infrastructure',
    classification: 'Analyst Workspace, Signal OS, Decision Support',
    categories: ['news', 'productivity'],
    features: [
      'Live signal aggregation',
      'Cross-asset market tracking',
      'Infrastructure and logistics monitoring',
      'Conflict and country-risk mapping',
      'Replay and walk-forward analysis',
      'Decision support briefs',
      'Coverage and data quality operations',
    ],
  },
  tech: {
    title: 'Lattice Current | Build Lens',
    description: 'Track AI labs, startups, cyber shifts, product launches, and infrastructure from the builder side.',
    keywords: 'builder lens, AI labs, startup ecosystem, cyber, product launches, cloud infrastructure, funding rounds, build signals',
    url: '/',
    siteName: 'Lattice Current',
    shortName: 'LatticeBuild',
    subject: 'Builder-side signal workspace for AI, cyber, and startups',
    classification: 'Builder Workspace, Innovation Intelligence',
    categories: ['news', 'business'],
    features: [
      'AI lab tracking',
      'Startup ecosystem mapping',
      'Cyber and policy watch',
      'Cloud and datacenter monitoring',
      'Funding and product launch intelligence',
      'Service reliability watch',
    ],
  },
  happy: {
    title: 'Lattice Current | Progress Lens',
    description: 'Follow resilience, human progress, climate wins, and constructive long-horizon signals.',
    keywords: 'progress lens, resilience, climate wins, human progress, constructive signals, long horizon',
    url: '/',
    siteName: 'Lattice Current',
    shortName: 'LatticeProgress',
    subject: 'Long-horizon progress, resilience, and positive compounding signals',
    classification: 'Progress Workspace, Long-Horizon Tracker',
    categories: ['news', 'lifestyle'],
    features: [
      'Progress tracking',
      'Science breakthrough feed',
      'Resilience and conservation signals',
      'Renewable energy dashboard',
      'Constructive long-horizon briefs',
    ],
  },
  finance: {
    title: 'Lattice Current | Markets Lens',
    description: 'Track global markets, macro shifts, commodities, crypto, and replay-backed allocation signals.',
    keywords: 'markets lens, macro, commodities, crypto, replay analysis, allocation signals, financial intelligence',
    url: '/',
    siteName: 'Lattice Current',
    shortName: 'LatticeMarkets',
    subject: 'Market and macro signal workspace',
    classification: 'Markets Workspace, Allocation Intelligence',
    categories: ['finance', 'news'],
    features: [
      'Cross-asset market tracking',
      'Macro and central bank watch',
      'Commodity and crypto signals',
      'Replay-backed investment workflows',
      'Exposure and regime diagnostics',
      'Market radar signals',
    ],
  },
  commodity: {
    title: 'Lattice Current | Supply Lens',
    description: 'Track chokepoints, ports, mining, processing, and trade flows across the supply layer.',
    keywords: 'supply lens, chokepoints, ports, mining, processing, trade flows, commodity logistics',
    url: '/',
    siteName: 'Lattice Current',
    shortName: 'LatticeSupply',
    subject: 'Supply-layer intelligence for resources and logistics',
    classification: 'Supply Workspace, Resource Intelligence',
    categories: ['finance', 'business'],
    features: [
      'Mining and processing visibility',
      'Port and chokepoint tracking',
      'Trade flow analysis',
      'Logistics infrastructure watch',
      'Commodity market context',
    ],
  },
};
