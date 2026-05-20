/**
 * Source concentration metrics for article clusters.
 *
 * - HHI (Herfindahl-Hirschman Index): sum of squared shares. Range 0..1.
 *   1.0 = one source dominates (no diversity).
 *   1/n = perfect evenness across n sources.
 *   > 0.5 → wire-dominated or single-publisher cluster.
 *
 * - effectiveSourceCount: 1 / HHI. A cluster with HHI=0.5 has the diversity
 *   of exactly 2 evenly-balanced sources regardless of surface count.
 *
 * Prefer publisher_group over raw source string so multilingual duplicates
 * (EuroNews en/fr/de) collapse to a single effective voice. Wire-flagged
 * articles are optionally collapsed into a single wire bucket.
 */

/**
 * Compute (HHI, effectiveSourceCount, wireDominated) for a set of articles.
 *
 * @param {Array<{publisher_group?: string, source?: string, wire_source?: string}>} articles
 * @param {{ collapseWire?: boolean, wireDominatedThreshold?: number }} options
 */
export function computeSourceConcentration(articles, options = {}) {
  const { collapseWire = true, wireDominatedThreshold = 0.5 } = options;
  const counts = new Map();

  for (const article of articles || []) {
    const wire = article.wire_source || article.wireSource || null;
    const bucket = collapseWire && wire
      ? `wire:${wire}`
      : article.publisher_group || article.publisherGroup || article.source || 'unknown';
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }

  const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    return { hhi: null, effectiveSourceCount: 0, wireDominated: false, bucketCount: 0, topShare: null };
  }

  let hhi = 0;
  let topShare = 0;
  let wireShare = 0;
  for (const [bucket, n] of counts.entries()) {
    const share = n / total;
    hhi += share * share;
    if (share > topShare) topShare = share;
    if (bucket.startsWith('wire:')) wireShare += share;
  }

  return {
    hhi: Number(hhi.toFixed(4)),
    effectiveSourceCount: Number((1 / hhi).toFixed(2)),
    wireDominated: wireShare > wireDominatedThreshold,
    bucketCount: counts.size,
    topShare: Number(topShare.toFixed(4)),
    wireShare: Number(wireShare.toFixed(4)),
  };
}

/**
 * Back-compat helper: compute the legacy canonical_events.source_diversity
 * metric (unique_sources / total_articles) using publisher_group when
 * available. Stays in [0, 1] range like the existing column.
 */
export function computeLegacyDiversity(articles) {
  if (!Array.isArray(articles) || !articles.length) return 0;
  const buckets = new Set();
  for (const article of articles) {
    buckets.add(article.publisher_group || article.publisherGroup || article.source || 'unknown');
  }
  return Number((buckets.size / articles.length).toFixed(3));
}
