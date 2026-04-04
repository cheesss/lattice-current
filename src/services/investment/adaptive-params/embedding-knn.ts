/**
 * embedding-knn.ts — Non-parametric outcome prediction using article embedding similarity.
 *
 * Leverages pgvector cosine similarity search on 60k article embeddings
 * to predict hit probability and expected return for new events.
 * No training required — uses labeled outcomes of nearest neighbors directly.
 */

export interface KNNPrediction {
  hitProbability: number;
  expectedReturn: number;
  confidence: number;
  neighborCount: number;
  avgSimilarity: number;
}

export interface EmbeddingKNNConfig {
  topK: number;
  minSimilarity: number;
  timeDecayHalfLifeDays: number;
  horizonFilter: string | null;
}

export const DEFAULT_KNN_CONFIG: EmbeddingKNNConfig = {
  topK: 20,
  minSimilarity: 0.25,
  timeDecayHalfLifeDays: 365,
  horizonFilter: '2w',
};

export interface KNNNeighbor {
  articleId: number;
  similarity: number;
  publishedAt: string;
  hitRate: number;
  avgReturn: number;
  outcomeCount: number;
}

/**
 * Build the pgvector KNN query for similar articles.
 * The caller is responsible for executing this against a pg.Client.
 */
export function buildKNNQuery(
  embeddingParamIndex: number,
  temporalBarrier: string,
  config: EmbeddingKNNConfig = DEFAULT_KNN_CONFIG,
): { text: string; values: (string | number)[] } {
  return {
    text: `
      WITH nearest AS (
        SELECT
          a.id AS article_id,
          1 - (a.embedding <=> $${embeddingParamIndex}::vector) AS similarity,
          a.published_at
        FROM articles a
        WHERE a.embedding IS NOT NULL
          AND a.published_at < $${embeddingParamIndex + 1}::timestamptz
          AND (1 - (a.embedding <=> $${embeddingParamIndex}::vector)) >= $${embeddingParamIndex + 2}
        ORDER BY a.embedding <=> $${embeddingParamIndex}::vector
        LIMIT $${embeddingParamIndex + 3}
      )
      SELECT
        n.article_id,
        n.similarity,
        n.published_at,
        AVG(lo.hit::int)::float AS hit_rate,
        AVG(lo.forward_return_pct)::float AS avg_return,
        COUNT(lo.id)::int AS outcome_count
      FROM nearest n
      LEFT JOIN labeled_outcomes lo ON lo.article_id = n.article_id
        ${config.horizonFilter ? `AND lo.horizon = $${embeddingParamIndex + 4}` : ''}
      GROUP BY n.article_id, n.similarity, n.published_at
      HAVING COUNT(lo.id) > 0
      ORDER BY n.similarity DESC
    `,
    values: config.horizonFilter
      ? [temporalBarrier, config.minSimilarity, config.topK, config.horizonFilter]
      : [temporalBarrier, config.minSimilarity, config.topK],
  };
}

/**
 * Compute KNN prediction from neighbor results.
 * Uses time-decay weighted voting: weight = similarity * exp(-decay * days_since).
 */
export function computeKNNPrediction(
  neighbors: KNNNeighbor[],
  referenceTimestamp: string,
  config: EmbeddingKNNConfig = DEFAULT_KNN_CONFIG,
): KNNPrediction {
  if (neighbors.length === 0) {
    return { hitProbability: 0.5, expectedReturn: 0, confidence: 0, neighborCount: 0, avgSimilarity: 0 };
  }

  const refTime = new Date(referenceTimestamp).getTime();
  const decayRate = 0.693 / (config.timeDecayHalfLifeDays * 24 * 60 * 60 * 1000);

  let weightedHitSum = 0;
  let weightedReturnSum = 0;
  let weightSum = 0;
  let simSum = 0;

  for (const neighbor of neighbors) {
    const neighborTime = new Date(neighbor.publishedAt).getTime();
    const ageMs = Math.max(0, refTime - neighborTime);
    const timeDecay = Math.exp(-decayRate * ageMs);
    const weight = neighbor.similarity * timeDecay * Math.sqrt(neighbor.outcomeCount);

    weightedHitSum += weight * neighbor.hitRate;
    weightedReturnSum += weight * neighbor.avgReturn;
    weightSum += weight;
    simSum += neighbor.similarity;
  }

  if (weightSum < 1e-10) {
    return { hitProbability: 0.5, expectedReturn: 0, confidence: 0, neighborCount: neighbors.length, avgSimilarity: simSum / neighbors.length };
  }

  const hitProbability = clamp(weightedHitSum / weightSum, 0, 1);
  const expectedReturn = weightedReturnSum / weightSum;
  const avgSimilarity = simSum / neighbors.length;
  const confidence = clamp(Math.min(neighbors.length / 10, 1) * avgSimilarity, 0, 1);

  return { hitProbability, expectedReturn, confidence, neighborCount: neighbors.length, avgSimilarity };
}

/**
 * Convert rag-retriever's SimilarCase[] to a KNNPrediction.
 * Bridge between the existing RAG infrastructure and the ML ensemble.
 */
export function knnPredictionFromRagCases(
  cases: Array<{
    similarity: number;
    publishedAt: Date;
    outcomes: Array<{ returnPct: number; hit: boolean; horizon: string }>;
  }>,
  referenceTimestamp: string,
  horizon: string = '2w',
): KNNPrediction {
  if (cases.length === 0) {
    return { hitProbability: 0.5, expectedReturn: 0, confidence: 0, neighborCount: 0, avgSimilarity: 0 };
  }

  const refTime = new Date(referenceTimestamp).getTime();
  const halfLifeMs = 365 * 24 * 60 * 60 * 1000;
  const decayRate = 0.693 / halfLifeMs;

  let weightedHitSum = 0;
  let weightedReturnSum = 0;
  let weightSum = 0;
  let simSum = 0;
  let validCases = 0;

  for (const c of cases) {
    const relevantOutcomes = c.outcomes.filter(o => o.horizon === horizon);
    if (relevantOutcomes.length === 0) continue;

    const hitRate = relevantOutcomes.filter(o => o.hit).length / relevantOutcomes.length;
    const avgReturn = relevantOutcomes.reduce((s, o) => s + o.returnPct, 0) / relevantOutcomes.length;

    const ageMs = Math.max(0, refTime - c.publishedAt.getTime());
    const timeDecay = Math.exp(-decayRate * ageMs);
    const weight = c.similarity * timeDecay;

    weightedHitSum += weight * hitRate;
    weightedReturnSum += weight * avgReturn;
    weightSum += weight;
    simSum += c.similarity;
    validCases++;
  }

  if (weightSum < 1e-10 || validCases === 0) {
    return { hitProbability: 0.5, expectedReturn: 0, confidence: 0, neighborCount: cases.length, avgSimilarity: simSum / Math.max(1, cases.length) };
  }

  return {
    hitProbability: clamp(weightedHitSum / weightSum, 0, 1),
    expectedReturn: weightedReturnSum / weightSum,
    confidence: clamp(Math.min(validCases / 10, 1) * (simSum / cases.length), 0, 1),
    neighborCount: validCases,
    avgSimilarity: simSum / cases.length,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
