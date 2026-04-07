import { createHash } from 'node:crypto';

const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'are', 'as', 'at',
  'be', 'been', 'but', 'by', 'can', 'could', 'for', 'from', 'had', 'has',
  'have', 'in', 'into', 'is', 'it', 'its', 'more', 'new', 'not', 'of',
  'on', 'or', 'our', 'over', 'said', 'say', 'says', 'than', 'that', 'the',
  'their', 'them', 'there', 'these', 'they', 'this', 'those', 'to', 'was',
  'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'year', 'years',
]);

export function normalizeDiscoveryText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeDiscoveryText(value) {
  return normalizeDiscoveryText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function parseEmbeddingVector(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  }
  const text = String(rawValue || '').trim();
  if (!text) return [];
  return text
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return 0;
  }
  const dimension = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < dimension; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function averageEmbedding(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) return [];
  const dimension = vectors[0]?.length || 0;
  if (dimension <= 0) return [];
  const sum = new Array(dimension).fill(0);
  let count = 0;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimension) continue;
    count += 1;
    for (let index = 0; index < dimension; index += 1) {
      sum[index] += Number(vector[index] || 0);
    }
  }
  if (count === 0) return [];
  return sum.map((value) => value / count);
}

export function buildDocumentFrequencies(documents) {
  const frequencies = new Map();
  for (const document of documents) {
    const seen = new Set(tokenizeDiscoveryText(document));
    for (const token of seen) {
      frequencies.set(token, Number(frequencies.get(token) || 0) + 1);
    }
  }
  return frequencies;
}

export function extractTopKeywordsFromDocuments(documents, documentFrequencies, limit = 10) {
  const totalDocuments = Math.max(1, documents.length);
  const scores = new Map();
  for (const document of documents) {
    const tokens = tokenizeDiscoveryText(document);
    const counts = new Map();
    for (const token of tokens) {
      counts.set(token, Number(counts.get(token) || 0) + 1);
    }
    const denominator = Math.max(1, tokens.length);
    for (const [token, tf] of counts.entries()) {
      const df = Number(documentFrequencies.get(token) || 1);
      const idf = Math.log((1 + totalDocuments) / (1 + df)) + 1;
      scores.set(token, Number(scores.get(token) || 0) + (tf / denominator) * idf);
    }
  }
  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function buildMonthlyCounts(items) {
  const counts = {};
  for (const item of items) {
    const month = String(item?.publishedAt || '').slice(0, 7);
    if (!month || month.length !== 7) continue;
    counts[month] = Number(counts[month] || 0) + 1;
  }
  return counts;
}

export function computeMomentum(monthlyCounts, recentWindow = 6, previousWindow = 6) {
  const months = Object.keys(monthlyCounts).sort();
  const ordered = months.map((month) => Number(monthlyCounts[month] || 0));
  const recent = ordered.slice(-recentWindow);
  const previous = ordered.slice(-(recentWindow + previousWindow), -recentWindow);
  const recentAverage = recent.length > 0
    ? recent.reduce((sum, value) => sum + value, 0) / recent.length
    : 0;
  const previousAverage = previous.length > 0
    ? previous.reduce((sum, value) => sum + value, 0) / previous.length
    : 0;
  const ratio = previousAverage > 0
    ? recentAverage / previousAverage
    : recentAverage > 0 ? Number.POSITIVE_INFINITY : 0;
  return {
    ratio,
    recentAverage,
    previousAverage,
    recentTotal: recent.reduce((sum, value) => sum + value, 0),
    previousTotal: previous.reduce((sum, value) => sum + value, 0),
  };
}

export function computeSourceDiversity(items) {
  return new Set(items.map((item) => String(item?.source || '').trim().toLowerCase()).filter(Boolean)).size;
}

const SOURCE_TYPE_BY_SOURCE = Object.freeze({
  arxiv: 'research',
  guardian: 'publisher_tier1',
  nyt: 'publisher_tier1',
  'new-york-times': 'publisher_tier1',
  hackernews: 'community',
  'rss-feed': 'aggregator',
  'gdelt-doc': 'aggregator',
  'gdelt-agg': 'aggregator',
});

const SOURCE_TYPE_WEIGHTS = Object.freeze({
  research: 0.92,
  publisher_tier1: 0.84,
  publisher_tier2: 0.74,
  aggregator: 0.62,
  community: 0.52,
  default: 0.6,
});

function roundMetric(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(digits));
}

export function classifyDiscoverySource(source) {
  const normalized = String(source || '').trim().toLowerCase();
  return SOURCE_TYPE_BY_SOURCE[normalized] || 'default';
}

export function computeSourceQuality(items) {
  const rows = Array.isArray(items) ? items : [];
  const totalItems = rows.length;
  if (totalItems <= 0) {
    return {
      sourceQualityScore: 0,
      distinctSourceCount: 0,
      distinctSourceTypeCount: 0,
      effectiveSourceCount: 0,
      weightedCoverage: 0,
      breakdown: {
        totalItems: 0,
        distinctSources: [],
        sourceTypeCounts: {},
        sourceCounts: {},
        sourceWeights: {},
      },
    };
  }

  const sourceCounts = new Map();
  const sourceTypeCounts = new Map();
  const sourceWeights = new Map();

  for (const item of rows) {
    const source = String(item?.source || 'unknown').trim().toLowerCase() || 'unknown';
    const sourceType = classifyDiscoverySource(source);
    const sourceWeight = Number(SOURCE_TYPE_WEIGHTS[sourceType] || SOURCE_TYPE_WEIGHTS.default);
    sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
    sourceTypeCounts.set(sourceType, Number(sourceTypeCounts.get(sourceType) || 0) + 1);
    sourceWeights.set(source, sourceWeight);
  }

  let hhi = 0;
  let weightedCoverageNumerator = 0;
  for (const [source, count] of sourceCounts.entries()) {
    const share = count / totalItems;
    const weight = Number(sourceWeights.get(source) || SOURCE_TYPE_WEIGHTS.default);
    hhi += share * share;
    weightedCoverageNumerator += share * weight;
  }

  const effectiveSourceCount = hhi > 0 ? 1 / hhi : 0;
  const distinctSourceCount = sourceCounts.size;
  const distinctSourceTypeCount = sourceTypeCounts.size;
  const weightedCoverage = weightedCoverageNumerator;
  const effectiveSourceFactor = Math.min(1, effectiveSourceCount / 4);
  const breadthFactor = Math.min(1, distinctSourceTypeCount / 3);
  const finalScore = (
    weightedCoverage * 0.5
    + effectiveSourceFactor * 0.3
    + breadthFactor * 0.2
  );

  return {
    sourceQualityScore: roundMetric(finalScore),
    distinctSourceCount,
    distinctSourceTypeCount,
    effectiveSourceCount: roundMetric(effectiveSourceCount),
    weightedCoverage: roundMetric(weightedCoverage),
    breakdown: {
      totalItems,
      distinctSources: Array.from(sourceCounts.keys()).sort(),
      sourceTypeCounts: Object.fromEntries(Array.from(sourceTypeCounts.entries()).sort(([left], [right]) => left.localeCompare(right))),
      sourceCounts: Object.fromEntries(Array.from(sourceCounts.entries()).sort(([left], [right]) => left.localeCompare(right))),
      sourceWeights: Object.fromEntries(Array.from(sourceWeights.entries()).sort(([left], [right]) => left.localeCompare(right))),
    },
  };
}

export function computeCohesion(items, centroid) {
  if (!Array.isArray(items) || items.length === 0 || !Array.isArray(centroid) || centroid.length === 0) {
    return 0;
  }
  const similarities = items
    .map((item) => cosineSimilarity(item.embedding, centroid))
    .filter((value) => Number.isFinite(value));
  if (similarities.length === 0) return 0;
  return similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
}

export function pickRepresentativeItems(items, centroid, limit = 5) {
  return [...items]
    .map((item) => ({
      ...item,
      centroidSimilarity: cosineSimilarity(item.embedding, centroid),
    }))
    .sort((left, right) => right.centroidSimilarity - left.centroidSimilarity)
    .slice(0, limit);
}

export function deriveTopicId(keywords) {
  const basis = Array.isArray(keywords) ? keywords.join('|') : String(keywords || '');
  return `dt-${createHash('sha256').update(basis).digest('hex').slice(0, 12)}`;
}

export function chooseClusterCount(itemCount) {
  const rough = Math.sqrt(Math.max(1, itemCount) / 50);
  return Math.min(100, Math.max(20, Math.round(rough)));
}

export function runKMeans(items, clusterCount, maxIterations = 25) {
  const usable = items.filter((item) => Array.isArray(item?.embedding) && item.embedding.length > 0);
  if (usable.length === 0) return [];
  const k = Math.min(clusterCount, usable.length);
  const centroids = [];
  for (let index = 0; index < k; index += 1) {
    const itemIndex = Math.floor((index * usable.length) / k);
    centroids.push([...usable[itemIndex].embedding]);
  }

  const assignments = new Array(usable.length).fill(0);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = 0;
    for (let itemIndex = 0; itemIndex < usable.length; itemIndex += 1) {
      const item = usable[itemIndex];
      let bestCluster = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
        const score = cosineSimilarity(item.embedding, centroids[centroidIndex]);
        if (score > bestScore) {
          bestScore = score;
          bestCluster = centroidIndex;
        }
      }
      if (assignments[itemIndex] !== bestCluster) {
        assignments[itemIndex] = bestCluster;
        changed += 1;
      }
    }
    if (changed === 0) break;

    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
      const clusterItems = usable.filter((_, itemIndex) => assignments[itemIndex] === centroidIndex);
      if (clusterItems.length === 0) continue;
      centroids[centroidIndex] = averageEmbedding(clusterItems.map((item) => item.embedding));
    }
  }

  return centroids.map((centroid, centroidIndex) => ({
    centroid,
    items: usable.filter((_, itemIndex) => assignments[itemIndex] === centroidIndex),
  })).filter((cluster) => cluster.items.length > 0);
}
