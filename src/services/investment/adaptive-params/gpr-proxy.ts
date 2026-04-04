/**
 * gpr-proxy.ts — Real-time GPR-like index from RSS/GDELT news.
 *
 * The Geopolitical Risk Index (GPR) is derived from counting geopolitical
 * keywords in newspaper articles. Since the official GPR has publication lag,
 * this module builds a real-time proxy from our existing RSS/GDELT feeds.
 *
 * Methodology follows Caldara & Iacoviello (2022):
 * Count articles matching keyword set / total articles → normalize to [0, 1].
 *
 * IMPORTANT: Before using in production, validate correlation with official GPR
 * over the overlapping period (2021-2024). Target: Pearson r >= 0.7.
 */

// ---------------------------------------------------------------------------
// GPR keyword set (from Caldara & Iacoviello, 2022)
// ---------------------------------------------------------------------------

export const GPR_KEYWORDS: string[] = [
  'war',
  'military',
  'nuclear',
  'threat',
  'army',
  'troops',
  'conflict',
  'invasion',
  'missile',
  'sanctions',
  'terrorism',
  'attack',
  'bomb',
  'weapon',
  'airstrike',
  'escalation',
  'hostility',
  'coup',
  'insurgent',
  'militia',
];

const GPR_KEYWORD_SET = new Set(GPR_KEYWORDS.map(k => k.toLowerCase()));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GprProxyInput {
  title: string;
  publishedAt?: string | Date;
}

export interface GprProxyResult {
  /** GPR proxy value normalized to [0, 1] */
  gprProxy: number;
  /** Number of matching articles */
  matchCount: number;
  /** Total articles in window */
  totalCount: number;
  /** Raw ratio (match / total) */
  rawRatio: number;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute a GPR-like proxy from a set of recent articles.
 *
 * @param articles - Recent articles (e.g., from RSS feeds within a rolling window)
 * @param baselineRatio - Long-term average ratio (from historical GPR validation).
 *   Default 0.12 means ~12% of articles typically match GPR keywords.
 * @param maxRatio - Cap for normalization. Default 0.35 = extreme geopolitical period.
 */
export function computeGprProxy(
  articles: GprProxyInput[],
  baselineRatio: number = 0.12,
  maxRatio: number = 0.35,
): GprProxyResult {
  if (articles.length === 0) {
    return { gprProxy: 0, matchCount: 0, totalCount: 0, rawRatio: 0 };
  }

  let matchCount = 0;
  for (const article of articles) {
    const words = article.title.toLowerCase().split(/[\s,.\-:;!?'"()[\]{}]+/);
    for (const word of words) {
      if (GPR_KEYWORD_SET.has(word)) {
        matchCount++;
        break; // count each article only once
      }
    }
  }

  const rawRatio = matchCount / articles.length;

  // Normalize: subtract baseline, scale by range, clamp to [0, 1]
  const adjusted = (rawRatio - baselineRatio) / (maxRatio - baselineRatio);
  const gprProxy = Math.max(0, Math.min(1, adjusted));

  return {
    gprProxy,
    matchCount,
    totalCount: articles.length,
    rawRatio,
  };
}

/**
 * SQL to fetch historical GPR for correlation validation.
 */
export function buildGprValidationQuery(startDate: string, endDate: string): {
  text: string;
  values: string[];
} {
  return {
    text: `
      SELECT date::text, gpr_index
      FROM macro_gpr
      WHERE date >= $1::date AND date <= $2::date
      ORDER BY date
    `,
    values: [startDate, endDate],
  };
}
