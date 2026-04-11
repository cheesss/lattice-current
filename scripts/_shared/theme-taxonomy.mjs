const CATEGORY_LABELS = {
  technology: 'Technology',
  science: 'Science',
  macro: 'Macro',
  geopolitics: 'Geopolitics',
  environment: 'Environment',
  society: 'Society',
  health: 'Health',
};

export const THEME_TAXONOMY_VERSION = '2026-04-07';
export const TREND_AGGREGATION_PERIODS = Object.freeze(['week', 'month', 'quarter', 'year']);

export const THEME_TAXONOMY = {
  'technology-general': {
    label: 'Technology',
    category: 'technology',
    parentTheme: null,
    lifecycleHint: 'mainstream',
    keywords: ['technology', 'software', 'computing', 'platform', 'digital infrastructure'],
  },
  'ai-ml': {
    label: 'AI / Machine Learning',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'mainstream',
    keywords: ['ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'foundation model', 'inference', 'agentic'],
  },
  semiconductor: {
    label: 'Semiconductor',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'mainstream',
    keywords: ['semiconductor', 'chip', 'foundry', 'tsmc', 'nvidia', 'wafer', 'fab', 'logic node', 'hbm'],
  },
  'quantum-computing': {
    label: 'Quantum Computing',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'emerging',
    keywords: ['quantum computing', 'qubit', 'quantum processor', 'quantum error correction', 'quantum advantage', 'quantum algorithm', 'ion trap'],
  },
  space: {
    label: 'Space Economy',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'growing',
    keywords: ['spacex', 'rocket', 'satellite', 'starlink', 'lunar', 'mars mission', 'launch vehicle', 'space economy', 'space station'],
  },
  'robotics-automation': {
    label: 'Robotics / Automation',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'growing',
    keywords: ['robotics', 'automation', 'robot', 'humanoid', 'factory automation', 'industrial robot', 'autonomous system'],
  },
  cybersecurity: {
    label: 'Cybersecurity',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'mainstream',
    keywords: ['cybersecurity', 'ransomware', 'zero day', 'breach', 'cyber attack', 'infosec', 'identity security'],
  },
  'cloud-infrastructure': {
    label: 'Cloud Infrastructure',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'mainstream',
    keywords: ['cloud', 'data center', 'hyperscaler', 'kubernetes', 'serverless', 'gpu cluster', 'edge computing'],
  },
  'developer-platforms': {
    label: 'Developer Platforms',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'growing',
    keywords: ['github', 'developer tool', 'devops', 'platform engineering', 'software tooling', 'sdk', 'open source maintainer'],
  },
  'autonomous-mobility': {
    label: 'Autonomous Mobility',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'growing',
    keywords: ['self driving', 'autonomous vehicle', 'robotaxi', 'lidar', 'adass', 'ev platform', 'autonomous mobility'],
  },
  'optical-computing': {
    label: 'Optical Computing',
    category: 'technology',
    parentTheme: 'technology-general',
    lifecycleHint: 'nascent',
    keywords: ['optical computing', 'silicon photonics', 'photonic chip', 'photonic processor', 'co packaged optics'],
  },

  'science-general': {
    label: 'Science',
    category: 'science',
    parentTheme: null,
    lifecycleHint: 'mainstream',
    keywords: ['science', 'research breakthrough', 'laboratory', 'scientific study'],
  },
  biotech: {
    label: 'Biotech',
    category: 'science',
    parentTheme: 'science-general',
    lifecycleHint: 'growing',
    keywords: ['biotech', 'gene therapy', 'crispr', 'mrna', 'cell therapy', 'genomics', 'protein engineering', 'clinical trial'],
  },
  'materials-science': {
    label: 'Materials Science',
    category: 'science',
    parentTheme: 'science-general',
    lifecycleHint: 'emerging',
    keywords: ['materials science', 'solid state battery', 'advanced materials', 'graphene', 'perovskite', 'superconductor'],
  },
  'brain-computer-interface': {
    label: 'Brain Computer Interface',
    category: 'science',
    parentTheme: 'science-general',
    lifecycleHint: 'nascent',
    keywords: ['brain computer interface', 'bci', 'neural implant', 'neuralink', 'brain signal decoding'],
  },
  'fusion-energy': {
    label: 'Fusion Energy',
    category: 'science',
    parentTheme: 'science-general',
    lifecycleHint: 'emerging',
    keywords: ['fusion', 'tokamak', 'stellarator', 'fusion ignition', 'fusion reactor'],
  },

  macroeconomics: {
    label: 'Macroeconomics',
    category: 'macro',
    parentTheme: null,
    lifecycleHint: 'mainstream',
    keywords: ['economy', 'growth', 'gdp', 'recession', 'macro', 'business cycle'],
  },
  'monetary-policy': {
    label: 'Monetary Policy',
    category: 'macro',
    parentTheme: 'macroeconomics',
    lifecycleHint: 'mainstream',
    keywords: ['fed', 'ecb', 'rate cut', 'rate hike', 'central bank', 'monetary policy', 'fomc', 'yield curve'],
  },
  'fiscal-policy': {
    label: 'Fiscal Policy',
    category: 'macro',
    parentTheme: 'macroeconomics',
    lifecycleHint: 'mainstream',
    keywords: ['stimulus', 'budget bill', 'fiscal policy', 'deficit', 'government spending', 'tax credit'],
  },
  'trade-globalization': {
    label: 'Trade / Globalization',
    category: 'macro',
    parentTheme: 'macroeconomics',
    lifecycleHint: 'growing',
    keywords: ['trade war', 'tariff', 'export control', 'reshoring', 'supply agreement', 'globalization', 'nearshoring'],
  },
  'inflation-costs': {
    label: 'Inflation / Costs',
    category: 'macro',
    parentTheme: 'macroeconomics',
    lifecycleHint: 'mainstream',
    keywords: ['inflation', 'cpi', 'ppi', 'wage inflation', 'input costs', 'cost pressure'],
  },

  geopolitics: {
    label: 'Geopolitics',
    category: 'geopolitics',
    parentTheme: null,
    lifecycleHint: 'mainstream',
    keywords: ['geopolitics', 'sovereignty', 'alliances', 'state visit', 'security bloc'],
  },
  conflict: {
    label: 'Conflict',
    category: 'geopolitics',
    parentTheme: 'geopolitics',
    lifecycleHint: 'mainstream',
    keywords: ['war', 'missile', 'drone strike', 'military conflict', 'battlefield', 'ceasefire', 'troops'],
  },
  diplomacy: {
    label: 'Diplomacy',
    category: 'geopolitics',
    parentTheme: 'geopolitics',
    lifecycleHint: 'mainstream',
    keywords: ['summit', 'diplomacy', 'negotiation', 'treaty', 'foreign minister', 'state visit'],
  },
  sanctions: {
    label: 'Sanctions / Controls',
    category: 'geopolitics',
    parentTheme: 'geopolitics',
    lifecycleHint: 'growing',
    keywords: ['sanction', 'export control', 'blacklist', 'restriction', 'trade restriction'],
  },
  'supply-chain-security': {
    label: 'Supply Chain Security',
    category: 'geopolitics',
    parentTheme: 'geopolitics',
    lifecycleHint: 'growing',
    keywords: ['supply chain', 'critical minerals', 'shipping disruption', 'port closure', 'logistics bottleneck'],
  },
  'defense-industrial': {
    label: 'Defense Industrial',
    category: 'geopolitics',
    parentTheme: 'geopolitics',
    lifecycleHint: 'growing',
    keywords: ['defense contractor', 'munitions', 'procurement', 'fighter jet', 'air defense', 'naval build'],
  },

  'environment-general': {
    label: 'Environment',
    category: 'environment',
    parentTheme: null,
    lifecycleHint: 'mainstream',
    keywords: ['environment', 'sustainability', 'ecology'],
  },
  'clean-energy': {
    label: 'Clean Energy',
    category: 'environment',
    parentTheme: 'environment-general',
    lifecycleHint: 'growing',
    keywords: ['solar', 'wind', 'battery storage', 'renewable', 'clean energy', 'grid storage', 'smr'],
  },
  'climate-change': {
    label: 'Climate Change',
    category: 'environment',
    parentTheme: 'environment-general',
    lifecycleHint: 'mainstream',
    keywords: ['climate change', 'warming', 'carbon', 'climate risk', 'emissions', 'decarbonization'],
  },
  'resource-scarcity': {
    label: 'Resource Scarcity',
    category: 'environment',
    parentTheme: 'environment-general',
    lifecycleHint: 'growing',
    keywords: ['lithium', 'rare earth', 'copper shortage', 'water scarcity', 'critical minerals', 'resource scarcity'],
  },
  'food-agriculture': {
    label: 'Food / Agriculture',
    category: 'environment',
    parentTheme: 'environment-general',
    lifecycleHint: 'growing',
    keywords: ['agriculture', 'crop', 'fertilizer', 'food security', 'precision agriculture', 'seed technology'],
  },

  'society-general': {
    label: 'Society',
    category: 'society',
    parentTheme: null,
    lifecycleHint: 'mainstream',
    keywords: ['society', 'social trend', 'consumer behavior', 'population'],
  },
  demographics: {
    label: 'Demographics',
    category: 'society',
    parentTheme: 'society-general',
    lifecycleHint: 'mainstream',
    keywords: ['aging population', 'birth rate', 'population decline', 'demographic shift', 'population growth'],
  },
  migration: {
    label: 'Migration',
    category: 'society',
    parentTheme: 'society-general',
    lifecycleHint: 'growing',
    keywords: ['migration', 'refugee', 'border crossings', 'immigration policy', 'migrant labor'],
  },
  urbanization: {
    label: 'Urbanization',
    category: 'society',
    parentTheme: 'society-general',
    lifecycleHint: 'growing',
    keywords: ['urbanization', 'smart city', 'housing shortage', 'urban mobility', 'megacity'],
  },
  'labor-future': {
    label: 'Future of Work',
    category: 'society',
    parentTheme: 'society-general',
    lifecycleHint: 'growing',
    keywords: ['remote work', 'automation labor', 'knowledge worker', 'productivity software', 'skills shortage'],
  },
  inequality: {
    label: 'Inequality',
    category: 'society',
    parentTheme: 'society-general',
    lifecycleHint: 'mainstream',
    keywords: ['inequality', 'wealth gap', 'housing affordability', 'cost of living'],
  },

  'health-general': {
    label: 'Health',
    category: 'health',
    parentTheme: null,
    lifecycleHint: 'mainstream',
    keywords: ['healthcare', 'health system', 'public health'],
  },
  'public-health': {
    label: 'Public Health',
    category: 'health',
    parentTheme: 'health-general',
    lifecycleHint: 'mainstream',
    keywords: ['pandemic', 'public health', 'disease outbreak', 'vaccine rollout', 'infectious disease'],
  },
  'aging-longevity': {
    label: 'Aging / Longevity',
    category: 'health',
    parentTheme: 'health-general',
    lifecycleHint: 'emerging',
    keywords: ['longevity', 'anti aging', 'age reversal', 'geroscience', 'healthy lifespan'],
  },
  'mental-health': {
    label: 'Mental Health',
    category: 'health',
    parentTheme: 'health-general',
    lifecycleHint: 'growing',
    keywords: ['mental health', 'depression', 'anxiety', 'psychedelic therapy', 'digital therapeutics'],
  },
};

export const LEGACY_THEME_MAP = {
  tech: 'technology-general',
  economy: 'macroeconomics',
  politics: 'geopolitics',
  conflict: 'conflict',
  energy: 'clean-energy',
};

const DISCOVERY_TOPIC_PATTERN = /^dt-[a-z0-9]+$/i;
const NOISE_DISCOVERY_PATTERNS = Object.freeze([
  { flag: 'sports', pattern: /\b(football|soccer|basketball|baseball|tennis|cricket|golf|cup match|league table|premier league|champions league|mlb|nba|nfl|nhl|fifa|uefa)\b/i },
  { flag: 'entertainment', pattern: /\b(box office|movie trailer|red carpet|celebrity|music awards|album release|tv series|streaming chart)\b/i },
  { flag: 'commodity-headline', pattern: /\b(oil prices jump|gold prices jump|stocks rise|stocks fall|market closes|shares higher|shares lower)\b/i },
  { flag: 'protest-burst', pattern: /\b(protest|demonstration|marchers|court-action|campus encampment|rally)\b/i },
]);

const DISCOVERY_TOPIC_NOISE_PATTERNS = [
  {
    reason: 'sports-noise',
    pattern: /\b(football|soccer|cup match|cup final|premier league|la liga|serie a|bundesliga|uefa|fifa|goalkeeper|striker|midfielder|tennis|nba|mlb|nfl|nhl|cricket|rugby|golf tournament|race result|match result|scoreline|penalty shootout)\b/i,
  },
  {
    reason: 'celebrity-entertainment-noise',
    pattern: /\b(box office|celebrity|red carpet|album release|movie premiere|reality show|tv ratings|showbiz|entertainment news)\b/i,
  },
  {
    reason: 'local-crime-noise',
    pattern: /\b(police blotter|local shooting|robbery|homicide investigation|suspect arrested|traffic collision)\b/i,
  },
];

const TREND_TRACKER_THEME_OVERRIDES = {
  'ai-ml': {
    aliases: ['ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'genai'],
    representativeSymbols: ['NVDA', 'AMD', 'MSFT', 'GOOGL', 'SMH'],
  },
  semiconductor: {
    aliases: ['chips', 'chipmakers', 'semiconductors'],
    representativeSymbols: ['SMH', 'SOXX', 'NVDA', 'AMD', 'AVGO', 'TSM'],
  },
  'quantum-computing': {
    aliases: ['quantum', 'qubit', 'quantum hardware'],
    representativeSymbols: ['IONQ', 'RGTI', 'QBTS', 'IBM'],
  },
  space: {
    aliases: ['space economy', 'space/satellite', 'satellite', 'orbital'],
    representativeSymbols: ['RKLB', 'ITA', 'IRDM', 'PL'],
  },
  'robotics-automation': {
    aliases: ['robotics', 'automation', 'humanoid robotics', 'drone/robotics'],
    representativeSymbols: ['BOTZ', 'IRBO', 'ISRG', 'TER'],
  },
  cybersecurity: {
    aliases: ['cyber', 'cyber security', 'digital security'],
    representativeSymbols: ['CIBR', 'CRWD', 'PANW', 'ZS'],
  },
  'cloud-infrastructure': {
    aliases: ['cloud', 'cloud infrastructure', 'data center'],
    representativeSymbols: ['MSFT', 'AMZN', 'SNOW', 'ANET'],
  },
  'developer-platforms': {
    aliases: ['developer tools', 'devops', 'developer infrastructure'],
    representativeSymbols: ['MSFT', 'GTLB', 'DDOG'],
  },
  'autonomous-mobility': {
    aliases: ['self driving', 'autonomous vehicle', 'robotaxi'],
    representativeSymbols: ['TSLA', 'NVDA', 'MBLY'],
  },
  'optical-computing': {
    aliases: ['silicon photonics', 'photonic computing'],
    representativeSymbols: ['LITE', 'COHR', 'MRVL'],
  },
  biotech: {
    aliases: ['biotech/gene', 'gene therapy', 'genomics', 'crispr'],
    representativeSymbols: ['XBI', 'IBB', 'CRSP', 'VRTX'],
  },
  'materials-science': {
    aliases: ['advanced materials', 'new materials', 'solid state battery'],
    representativeSymbols: ['MP', 'ALB', 'ATI'],
  },
  'brain-computer-interface': {
    aliases: ['bci', 'brain computer interface', 'neural interface'],
    representativeSymbols: ['MDT', 'NVDA'],
  },
  'fusion-energy': {
    aliases: ['fusion', 'nuclear fusion'],
    representativeSymbols: ['URA', 'CCJ', 'BWXT'],
  },
  'clean-energy': {
    aliases: ['renewable', 'renewable energy', 'solar', 'wind energy'],
    representativeSymbols: ['ICLN', 'TAN', 'FSLR'],
  },
  'resource-scarcity': {
    aliases: ['critical minerals', 'water scarcity', 'resource constraint'],
    representativeSymbols: ['DBA', 'MOO', 'ALB', 'FCX'],
  },
  'public-health': {
    aliases: ['public health', 'pandemic', 'infectious disease'],
    representativeSymbols: ['PFE', 'MRNA', 'JNJ'],
  },
  'aging-longevity': {
    aliases: ['longevity', 'anti aging', 'geroscience'],
    representativeSymbols: ['ARKG', 'LLY', 'PFE'],
  },
};

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeThemeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

export function isDiscoveryTopicKey(value) {
  return DISCOVERY_TOPIC_PATTERN.test(String(value || '').trim());
}

export const looksLikeDiscoveryTopic = isDiscoveryTopicKey;

export function isLegacyThemeKey(value) {
  return Object.prototype.hasOwnProperty.call(LEGACY_THEME_MAP, normalizeThemeKey(value));
}

export const isLegacyTheme = isLegacyThemeKey;

export function isCanonicalThemeKey(value) {
  return Boolean(THEME_TAXONOMY[normalizeThemeKey(value)]);
}

export const isCanonicalTheme = isCanonicalThemeKey;

export function listParentThemes() {
  return Object.entries(THEME_TAXONOMY)
    .filter(([, config]) => !config.parentTheme)
    .map(([theme]) => theme);
}

export const CANONICAL_PARENT_THEME_KEYS = Object.freeze(listParentThemes());

export function isCanonicalParentTheme(value) {
  return CANONICAL_PARENT_THEME_KEYS.includes(normalizeThemeKey(value));
}

export function listChildThemes(parentTheme) {
  const canonicalParent = mapThemeToTaxonomy(parentTheme);
  if (canonicalParent === 'unknown') return [];
  return Object.entries(THEME_TAXONOMY)
    .filter(([, config]) => config.parentTheme === canonicalParent)
    .map(([theme]) => buildEnrichedThemeConfig(theme))
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-/.+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getThemeConfig(theme) {
  const normalized = normalizeThemeKey(theme);
  return THEME_TAXONOMY[normalized] || null;
}

function buildEnrichedThemeConfig(themeKey) {
  const config = getThemeConfig(themeKey);
  if (!config) return null;
  const overrides = TREND_TRACKER_THEME_OVERRIDES[themeKey] || {};
  return {
    key: themeKey,
    ...config,
    aliases: unique([themeKey, config.label, ...(overrides.aliases || [])]),
    representativeSymbols: unique(overrides.representativeSymbols || []),
    themeType: config.parentTheme ? 'subtheme' : 'parent',
    categoryLabel: CATEGORY_LABELS[config.category] || config.category,
    supportedPeriods: TREND_AGGREGATION_PERIODS,
  };
}

export function listTaxonomyThemes({ includeParents = true } = {}) {
  return Object.entries(THEME_TAXONOMY)
    .filter(([, config]) => includeParents || Boolean(config.parentTheme))
    .map(([key]) => buildEnrichedThemeConfig(key))
    .filter(Boolean);
}

export function mapThemeToTaxonomy(theme) {
  const normalized = normalizeThemeKey(theme);
  if (THEME_TAXONOMY[normalized]) return normalized;
  if (LEGACY_THEME_MAP[normalized]) return LEGACY_THEME_MAP[normalized];
  return 'unknown';
}

export function getCanonicalParentTheme(theme) {
  const normalized = normalizeThemeKey(theme);
  if (isDiscoveryTopicKey(normalized)) return null;
  const mappedTheme = mapThemeToTaxonomy(normalized);
  if (mappedTheme !== 'unknown') {
    return THEME_TAXONOMY[mappedTheme]?.parentTheme || mappedTheme;
  }
  const ranked = rankThemesForText(normalized, { includeParents: true, limit: 1 });
  if (ranked[0]?.theme) {
    const resolved = resolveThemeTaxonomy(ranked[0].theme);
    return resolved.parentTheme || resolved.themeKey || null;
  }
  return null;
}

function isGenericBucketTheme(theme) {
  const normalized = normalizeThemeKey(theme);
  return normalized.endsWith('-general');
}

export function resolveThemeTaxonomy(theme) {
  const sourceTheme = typeof theme === 'string' ? theme.trim() : '';
  const mappedTheme = mapThemeToTaxonomy(sourceTheme);
  if (mappedTheme === 'unknown') {
    return {
      sourceTheme,
      themeKey: null,
      themeLabel: null,
      themeType: null,
      parentTheme: null,
      parentThemeLabel: null,
      category: null,
      categoryLabel: null,
      lifecycleHint: null,
      taxonomyVersion: THEME_TAXONOMY_VERSION,
      aggregationPath: Object.freeze([]),
      supportedPeriods: TREND_AGGREGATION_PERIODS,
    };
  }

  const config = buildEnrichedThemeConfig(mappedTheme);
  const parentConfig = config?.parentTheme ? buildEnrichedThemeConfig(config.parentTheme) : null;
  return {
    sourceTheme,
    themeKey: config?.key || null,
    themeLabel: config?.label || null,
    themeType: config?.themeType || null,
    parentTheme: parentConfig?.key || config?.key || null,
    parentThemeLabel: parentConfig?.label || config?.label || null,
    category: config?.category || null,
    categoryLabel: config?.categoryLabel || null,
    lifecycleHint: config?.lifecycleHint || null,
    taxonomyVersion: THEME_TAXONOMY_VERSION,
    aggregationPath: parentConfig ? Object.freeze([parentConfig.key, config.key]) : Object.freeze([config.key]),
    supportedPeriods: TREND_AGGREGATION_PERIODS,
  };
}

export function listTrendTrackerThemes() {
  return Object.keys(TREND_TRACKER_THEME_OVERRIDES)
    .map((themeKey) => buildEnrichedThemeConfig(themeKey))
    .filter(Boolean);
}

function keywordScore(text, keyword) {
  if (!text || !keyword) return 0;
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) return 0;
  if (!text.includes(normalizedKeyword)) return 0;
  return normalizedKeyword.includes(' ') ? 1.25 : 0.8;
}

function buildThemeScore(config, text) {
  let score = 0;
  const matchedKeywords = [];
  for (const keyword of config.keywords || []) {
    const contribution = keywordScore(text, keyword);
    if (contribution > 0) {
      score += contribution;
      matchedKeywords.push(keyword);
    }
  }
  return {
    score,
    matchedKeywords: unique(matchedKeywords),
  };
}

export function rankThemesForText(text, { includeParents = false, limit = 6 } = {}) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return [];
  return listTaxonomyThemes({ includeParents })
    .map((theme) => {
      const scored = buildThemeScore(theme, normalizedText);
      return {
        theme: theme.key,
        label: theme.label,
        category: theme.category,
        parentTheme: theme.parentTheme,
        lifecycleHint: theme.lifecycleHint,
        score: scored.score,
        matchedKeywords: scored.matchedKeywords,
      };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.theme.localeCompare(right.theme))
    .slice(0, limit);
}

export function classifyArticleAgainstTaxonomy({
  title = '',
  source = '',
  keywords = [],
  embeddingTheme = '',
  embeddingSimilarity = 0,
} = {}) {
  const keywordList = Array.isArray(keywords)
    ? keywords.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const combinedText = [title, source, ...keywordList].join(' ');
  const ranked = rankThemesForText(combinedText, { includeParents: false, limit: 8 });
  const mappedEmbedding = mapThemeToTaxonomy(embeddingTheme);
  const embeddingConfig = getThemeConfig(mappedEmbedding);

  const boosted = ranked.map((row) => {
    let score = row.score;
    if (mappedEmbedding !== 'unknown' && row.theme === mappedEmbedding) {
      score += 1.5 + Math.max(0, Number(embeddingSimilarity || 0));
    } else if (embeddingConfig?.parentTheme && row.parentTheme === embeddingConfig.parentTheme) {
      score += 0.45;
    }
    return { ...row, score };
  }).sort((left, right) => right.score - left.score || left.theme.localeCompare(right.theme));

  const best = boosted[0] || null;
  const fallbackTheme = mappedEmbedding !== 'unknown' ? mappedEmbedding : null;
  const bestConfig = best ? getThemeConfig(best.theme) : null;
  const bestScoreThreshold = bestConfig && isGenericBucketTheme(best.theme) ? 1.8 : 1.2;
  const fallbackThemeAllowed = fallbackTheme && (
    !isGenericBucketTheme(fallbackTheme)
    || Number(embeddingSimilarity || 0) >= 0.72
  );
  const finalTheme = best?.score >= bestScoreThreshold
    ? best.theme
    : fallbackThemeAllowed ? fallbackTheme : null;
  const finalConfig = getThemeConfig(finalTheme);
  if (!finalConfig) {
    return {
      theme: 'unknown',
      parentTheme: null,
      category: null,
      lifecycleHint: null,
      matchedKeywords: [],
      confidence: Number.isFinite(Number(embeddingSimilarity)) ? Number(embeddingSimilarity) : 0,
      candidates: boosted,
    };
  }

  const rawConfidence = best?.score
    ? Math.min(0.97, 0.28 + (best.score / 5))
    : Math.max(0.4, Math.min(0.92, Number(embeddingSimilarity || 0)));

  return {
    theme: finalTheme,
    parentTheme: finalConfig.parentTheme || finalTheme,
    category: finalConfig.category,
    lifecycleHint: finalConfig.lifecycleHint,
    matchedKeywords: unique(best?.matchedKeywords || []),
    confidence: rawConfidence,
    candidates: boosted,
  };
}

export function assessDiscoveryTopicAlignment({
  topicId = '',
  label = '',
  keywords = [],
  parentTheme = '',
  category = '',
  articleCount = 0,
  momentum = 0,
  novelty = 0,
  sourceQualityScore = 0,
  researchMomentum = 0,
} = {}) {
  const keywordList = Array.isArray(keywords)
    ? keywords.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const joinedText = [label, parentTheme, category, ...keywordList].join(' ');
  const normalizedText = normalizeText(joinedText);
  const noiseFlags = NOISE_DISCOVERY_PATTERNS
    .filter(({ pattern }) => pattern.test(normalizedText))
    .map(({ flag }) => flag);
  const ranked = rankThemesForText(joinedText, { includeParents: false, limit: 5 });
  const best = ranked[0] || null;
  const mappedParent = getCanonicalParentTheme(parentTheme);
  const mappedCategory = resolveThemeTaxonomy(mappedParent || '').category;
  const bestConfig = best ? getThemeConfig(best.theme) : null;
  const bestScoreThreshold = bestConfig && isGenericBucketTheme(best.theme) ? 1.8 : 1.2;
  const canonicalTheme = best?.score >= bestScoreThreshold
    ? best.theme
    : (isCanonicalThemeKey(parentTheme) && !isGenericBucketTheme(parentTheme) ? normalizeThemeKey(parentTheme) : null);
  const canonicalParentTheme = getCanonicalParentTheme(canonicalTheme || parentTheme);
  const canonicalMeta = canonicalTheme
    ? resolveThemeTaxonomy(canonicalTheme)
    : resolveThemeTaxonomy(canonicalParentTheme || '');
  const structuralScore = (
    Math.min(1, toFiniteNumber(articleCount, 0) / 45) * 0.22
    + Math.min(1, Math.max(0, toFiniteNumber(momentum, 0) - 1) / 1.5) * 0.22
    + Math.min(1, Math.max(0, toFiniteNumber(novelty, 0))) * 0.16
    + Math.min(1, Math.max(0, toFiniteNumber(sourceQualityScore, 0))) * 0.2
    + Math.min(1, Math.max(0, toFiniteNumber(researchMomentum, 0))) * 0.08
    + Math.min(1, (best?.score || 0) / 3) * 0.12
  );
  const hasCanonicalPath = Boolean(canonicalParentTheme && canonicalParentTheme !== 'unknown');
  const operatorVisible = noiseFlags.length === 0
    && hasCanonicalPath
    && (
      best?.score >= 1.2
      || structuralScore >= 0.48
      || toFiniteNumber(articleCount, 0) >= 30
    );
  const disposition = noiseFlags.length > 0
    ? 'suppress'
    : operatorVisible && (best?.score >= 1.75 || structuralScore >= 0.68)
      ? 'promote'
      : operatorVisible
        ? 'track'
        : 'suppress';

  return {
    topicId: String(topicId || '').trim(),
    canonicalTheme: canonicalTheme || null,
    canonicalParentTheme: canonicalParentTheme || null,
    canonicalCategory: canonicalMeta.category || mappedCategory || null,
    matchedKeywords: unique(best?.matchedKeywords || []),
    ranking: ranked,
    noiseFlags,
    structuralScore: Number(structuralScore.toFixed(4)),
    operatorVisible,
    disposition,
  };
}

export function evaluateDiscoveryTopicPromotion(payload = {}) {
  const assessment = assessDiscoveryTopicAlignment(payload);
  const suppressionReason = assessment.noiseFlags.length > 0
    ? assessment.noiseFlags.join(',')
    : assessment.operatorVisible
      ? null
      : 'taxonomy-mismatch';
  const resolvedMeta = resolveThemeTaxonomy(
    assessment.canonicalTheme || assessment.canonicalParentTheme || '',
  );
  const topScore = Number(assessment.ranking?.[0]?.score || 0);
  return {
    canonicalTheme: assessment.canonicalTheme,
    canonicalParentTheme: assessment.canonicalParentTheme,
    canonicalCategory: assessment.canonicalCategory,
    promotionState: assessment.disposition === 'promote'
      ? 'canonical'
      : assessment.disposition === 'track'
        ? 'watch'
        : 'suppressed',
    suppressionReason,
    qualityFlags: assessment.noiseFlags,
    operatorVisible: assessment.operatorVisible,
    ranking: assessment.ranking,
    matchedKeywords: assessment.matchedKeywords,
    structuralScore: assessment.structuralScore,
    lifecycleHint: resolvedMeta.lifecycleHint || null,
    confidence: Number(Math.min(0.97, 0.28 + (topScore / 5)).toFixed(4)),
    taxonomyVersion: THEME_TAXONOMY_VERSION,
  };
}

export function listThemeFamilies() {
  const families = new Map();
  for (const [key, config] of Object.entries(THEME_TAXONOMY)) {
    const parent = config.parentTheme || key;
    const bucket = families.get(parent) || {
      parentTheme: parent,
      parentLabel: CATEGORY_LABELS[config.category] || config.label,
      category: config.category,
      subThemes: [],
    };
    if (config.parentTheme) {
      bucket.subThemes.push({
        theme: key,
        label: config.label,
        lifecycleHint: config.lifecycleHint,
      });
    }
    families.set(parent, bucket);
  }
  return Array.from(families.values());
}
