/**
 * Pattern Discovery Engine
 * Finds statistically significant news→asset price reactions
 * without requiring predefined themes or keywords.
 */

export interface DiscoveredLink {
  id: string;
  clusterFingerprint: string;  // normalized cluster descriptor
  symbol: string;
  horizonHours: number;
  avgReturnPct: number;
  sampleCount: number;
  winRate: number;
  tStat: number;
  direction: 'long' | 'short';
  firstSeen: string;
  lastSeen: string;
  samples: Array<{ timestamp: string; returnPct: number }>;
}

export interface ClusterFingerprint {
  id: string;
  topTerms: string[];        // TF-IDF top nouns (no predefined keywords)
  sentiment: number;          // -1 to +1
  sourceRegions: string[];
  sourceCount: number;
  intensity: number;
  rawTitle: string;
}

const MAX_SAMPLES_PER_LINK = 100;
const MAX_DISCOVERED_LINKS = 5000;

// Store for discovered patterns
const discoveredLinks = new Map<string, DiscoveredLink>();
const fingerprintHistory = new Map<string, ClusterFingerprint[]>();

/**
 * Build a fingerprint from a cluster without using predefined keywords.
 * Uses TF-IDF-like term extraction from the cluster title/text.
 */
export function buildFingerprint(cluster: {
  primaryTitle?: string;
  title?: string;
  primarySource?: string;
  sourceCount?: number;
  region?: string;
  isAlert?: boolean;
}): ClusterFingerprint {
  const title = String(cluster.primaryTitle || cluster.title || '').trim();
  // Extract meaningful terms (>3 chars, not stopwords)
  const stopwords = new Set(['the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','has','have','been','will','with','that','this','from','they','were','said','each','make','like','than','them','some','just','about','would','could','should','into','over','after','before','these','those','other','which','their','there','when','what','more','most','also','very','much','many','such','only','then','being','both','same','even','still','well','back','down','here','where','every','while','between','through','during','under','around','without','within','along','another','against','because','since','until','among','across','above','below','already','always','never','often','sometimes','usually','however','therefore','although','whether','either','neither','rather','quite','enough','perhaps','indeed','actually','certainly','probably','especially','particularly','generally','specifically','basically','essentially','simply','merely','nearly','almost','approximately','relatively','fairly']);
  const terms = title.toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w));

  // Count term frequency for this cluster
  const termFreq = new Map<string, number>();
  for (const term of terms) {
    termFreq.set(term, (termFreq.get(term) || 0) + 1);
  }
  const topTerms = [...termFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  // Simple sentiment from keyword presence
  const posWords = ['peace','deal','agreement','growth','rise','surge','gain','profit','recovery'];
  const negWords = ['war','attack','crisis','collapse','crash','threat','kill','destroy','sanction','block'];
  const posCount = terms.filter(t => posWords.includes(t)).length;
  const negCount = terms.filter(t => negWords.includes(t)).length;
  const sentiment = posCount === 0 && negCount === 0 ? 0 : (posCount - negCount) / Math.max(1, posCount + negCount);

  return {
    id: topTerms.slice(0, 3).join('-') || 'unknown',
    topTerms,
    sentiment,
    sourceRegions: cluster.region ? [cluster.region] : [],
    sourceCount: cluster.sourceCount || 1,
    intensity: cluster.isAlert ? 80 : 50,
    rawTitle: title.substring(0, 120),
  };
}

/**
 * Scan for lead-lag correlations between clusters and asset prices.
 * This is the core discovery function — no predefined rules needed.
 */
export function scanLeadLagCorrelations(args: {
  clusters: Array<{ primaryTitle?: string; title?: string; primarySource?: string; sourceCount?: number; region?: string; isAlert?: boolean; firstSeen?: string | Date }>;
  priceHistory: Map<string, Array<{ timestamp: number; price: number }>>;
  horizons: number[];  // hours to check: [6, 12, 24, 48, 72]
  currentTimestamp: string;
}): DiscoveredLink[] {
  const { clusters, priceHistory, horizons, currentTimestamp } = args;
  const currentTs = Date.parse(currentTimestamp);
  const newLinks: DiscoveredLink[] = [];

  for (const cluster of clusters) {
    const fp = buildFingerprint(cluster);
    const clusterTs = cluster.firstSeen
      ? (typeof cluster.firstSeen === 'string' ? Date.parse(cluster.firstSeen) : cluster.firstSeen.getTime())
      : currentTs;

    for (const [symbol, prices] of priceHistory) {
      // Find price at cluster time
      const entryPrice = findPriceNear(prices, clusterTs);
      if (!entryPrice) continue;

      for (const horizon of horizons) {
        const exitTs = clusterTs + horizon * 3600 * 1000;
        if (exitTs > currentTs) continue; // Can't look into future

        const exitPrice = findPriceNear(prices, exitTs);
        if (!exitPrice) continue;

        const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        const linkKey = `${fp.id}::${symbol}::${horizon}h`;

        // Update or create discovered link
        const existing = discoveredLinks.get(linkKey);
        if (existing) {
          existing.samples.push({ timestamp: currentTimestamp, returnPct });
          if (existing.samples.length > MAX_SAMPLES_PER_LINK) {
            existing.samples = existing.samples.slice(-MAX_SAMPLES_PER_LINK);
          }
          existing.sampleCount = existing.samples.length;
          existing.avgReturnPct = existing.samples.reduce((s, r) => s + r.returnPct, 0) / existing.samples.length;
          existing.winRate = existing.samples.filter(r => r.returnPct > 0).length / existing.samples.length;
          existing.lastSeen = currentTimestamp;
          // T-statistic
          const mean = existing.avgReturnPct;
          const variance = existing.samples.reduce((s, r) => s + (r.returnPct - mean) ** 2, 0) / Math.max(1, existing.samples.length - 1);
          existing.tStat = variance > 0 ? (mean / Math.sqrt(variance / existing.samples.length)) : 0;
          existing.direction = existing.avgReturnPct >= 0 ? 'long' : 'short';
        } else {
          const newLink: DiscoveredLink = {
            id: linkKey,
            clusterFingerprint: fp.id,
            symbol,
            horizonHours: horizon,
            avgReturnPct: returnPct,
            sampleCount: 1,
            winRate: returnPct > 0 ? 1 : 0,
            tStat: 0,
            direction: returnPct >= 0 ? 'long' : 'short',
            firstSeen: currentTimestamp,
            lastSeen: currentTimestamp,
            samples: [{ timestamp: currentTimestamp, returnPct }],
          };
          discoveredLinks.set(linkKey, newLink);
          newLinks.push(newLink);
        }
      }
    }
  }

  // Bound the discoveredLinks map to prevent unbounded growth
  if (discoveredLinks.size > MAX_DISCOVERED_LINKS) {
    const toRemove = Math.floor(discoveredLinks.size * 0.2);
    let removed = 0;
    for (const key of discoveredLinks.keys()) {
      if (removed >= toRemove) break;
      discoveredLinks.delete(key);
      removed++;
    }
  }

  return newLinks;
}

function findPriceNear(prices: Array<{ timestamp: number; price: number }>, targetTs: number): number | null {
  let best: { timestamp: number; price: number } | null = null;
  let bestDist = Infinity;
  for (const p of prices) {
    const dist = Math.abs(p.timestamp - targetTs);
    if (dist < bestDist && dist < 24 * 3600 * 1000) { // Within 24h
      best = p;
      bestDist = dist;
    }
  }
  return best?.price ?? null;
}

/**
 * Filter for statistically significant patterns only.
 */
export function getSignificantPatterns(minSamples = 3, minAbsTStat = 1.2): DiscoveredLink[] {
  return [...discoveredLinks.values()]
    .filter(link => link.sampleCount >= minSamples && Math.abs(link.tStat) >= minAbsTStat)
    .sort((a, b) => Math.abs(b.tStat) - Math.abs(a.tStat));
}

/**
 * Get all discovered links (for persistence/inspection).
 */
export function getAllDiscoveredLinks(): Map<string, DiscoveredLink> {
  return discoveredLinks;
}

/**
 * Find similar fingerprints in history.
 */
export function findSimilarFingerprints(fp: ClusterFingerprint, threshold = 0.5): ClusterFingerprint[] {
  const allFps = [...fingerprintHistory.values()].flat();
  return allFps.filter(other => {
    const commonTerms = fp.topTerms.filter(t => other.topTerms.includes(t)).length;
    const similarity = commonTerms / Math.max(1, Math.max(fp.topTerms.length, other.topTerms.length));
    return similarity >= threshold && other.id !== fp.id;
  });
}

/**
 * Register a cluster fingerprint in history.
 */
export function registerFingerprint(fp: ClusterFingerprint): void {
  const existing = fingerprintHistory.get(fp.id) || [];
  existing.push(fp);
  if (existing.length > 100) existing.shift();
  fingerprintHistory.set(fp.id, existing);
}

/**
 * Restore discovered links from persisted storage.
 */
export function restoreDiscoveredLinks(data: Record<string, DiscoveredLink>): void {
  for (const [key, link] of Object.entries(data)) {
    if (link.samples && link.samples.length > MAX_SAMPLES_PER_LINK) {
      link.samples = link.samples.slice(-MAX_SAMPLES_PER_LINK);
    }
    discoveredLinks.set(key, link);
  }
}

/**
 * Restore fingerprint history from persisted storage.
 */
export function restoreFingerprints(data: Record<string, ClusterFingerprint[]>): void {
  for (const [key, fps] of Object.entries(data)) {
    fingerprintHistory.set(key, fps);
  }
}

/**
 * Get all fingerprint history (for persistence).
 */
export function getAllFingerprints(): Map<string, ClusterFingerprint[]> {
  return fingerprintHistory;
}
