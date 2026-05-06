/*
 * Historical analogue retrieval.
 *
 * Phase 5: given the current 30-day Hawkes intensity profile of a theme,
 * find past 30-day windows whose profile most closely matches. The
 * narrator can then say "this looks like the September 2024 surge" or
 * "this matches the Q1 2017 hyperscaler buildout pattern."
 *
 * Method (simple but defensible):
 *   1. Pull the theme's full Hawkes time series (event_hawkes_intensity).
 *   2. Slice into rolling 30-day windows. For each window compute features:
 *        mean intensity, max intensity, surge count, dispersion.
 *   3. Compare each window to the most recent 30-day window using cosine
 *      similarity on the [mean, max, surge_count, dispersion] vector.
 *   4. Return top 3 analogues with their start date + similarity score.
 *
 * Limitations:
 *   - Hawkes-only similarity ignores macro regime (vix, yield) — the
 *     analogue is "attention pattern", not "macro context". A future
 *     iteration can add regime feature comparison.
 *   - For themes with < 90 days of history, returns empty.
 */

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function asArray(v) { return Array.isArray(v) ? v : []; }

async function many(client, sql, params = []) {
  return (await client.query(sql, params)).rows;
}

function profileWindow(rows) {
  if (!rows.length) return null;
  const intensities = rows.map((r) => num(r.hawkes_intensity) || 0);
  const sum = intensities.reduce((a, b) => a + b, 0);
  const mean = sum / intensities.length;
  const max = Math.max(...intensities, 0);
  const surge = rows.filter((r) => r.is_surge === true).length;
  const variance = intensities.length > 1
    ? intensities.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (intensities.length - 1)
    : 0;
  const stdev = Math.sqrt(variance);
  return { mean, max, surge, stdev, articleSum: rows.reduce((a, b) => a + (num(b.article_count) || 0), 0) };
}

function cosineSimilarity(a, b) {
  const va = [a.mean, a.max, a.surge, a.stdev];
  const vb = [b.mean, b.max, b.surge, b.stdev];
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < va.length; i += 1) {
    dot += va[i] * vb[i];
    na += va[i] * va[i];
    nb += vb[i] * vb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export async function loadThemeHistoricalAnalogues(client, themeKey, { lookbackDays = 365, windowDays = 30, topK = 3 } = {}) {
  if (!themeKey) return { available: false, analogues: [], reason: 'no theme key' };
  const series = await many(client, `
    SELECT event_date, hawkes_intensity, article_count, is_surge
    FROM event_hawkes_intensity
    WHERE theme = $1
      AND event_date >= (CURRENT_DATE - INTERVAL '${lookbackDays} days')::date
    ORDER BY event_date ASC
  `, [themeKey]).catch(() => []);
  if (series.length < windowDays * 2) {
    return { available: false, analogues: [], reason: `insufficient hawkes history (${series.length} days)` };
  }
  /* Build rolling windows */
  const byDate = new Map(series.map((r) => [String(r.event_date).slice(0, 10), r]));
  const dates = [...byDate.keys()].sort();
  const windows = [];
  for (let i = 0; i + windowDays <= dates.length; i += 1) {
    const startDate = dates[i];
    const endDate = dates[i + windowDays - 1];
    const slice = dates.slice(i, i + windowDays).map((d) => byDate.get(d)).filter(Boolean);
    const profile = profileWindow(slice);
    if (profile) windows.push({ startDate, endDate, profile });
  }
  if (windows.length < 2) return { available: false, analogues: [], reason: 'fewer than 2 windows' };
  const current = windows[windows.length - 1];
  const candidates = windows.slice(0, -windowDays); // exclude windows overlapping current
  if (!candidates.length) return { available: false, analogues: [], reason: 'no non-overlapping windows' };
  const ranked = candidates.map((w) => ({
    startDate: w.startDate,
    endDate: w.endDate,
    profile: w.profile,
    similarity: cosineSimilarity(current.profile, w.profile),
  })).filter((c) => c.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
  return {
    available: true,
    currentWindow: current,
    analogues: ranked,
    methodology: '30-day Hawkes intensity profile cosine similarity (mean/max/surge/stdev features)',
  };
}

/*
 * For each analogue, look up what canonical events fired in that window
 * to give the narrator a one-line context for each historical match.
 */
export async function tagAnalogueContext(client, themeKey, analogues) {
  if (!analogues?.length) return analogues;
  const out = [];
  for (const an of analogues) {
    const events = await many(client, `
      SELECT id, event_date, representative_title, article_count, source_count
      FROM canonical_events
      WHERE theme = $1
        AND event_date BETWEEN $2::date AND $3::date
      ORDER BY article_count DESC NULLS LAST
      LIMIT 3
    `, [themeKey, an.startDate, an.endDate]).catch(() => []);
    out.push({
      ...an,
      contextEvents: events.map((e) => ({
        id: e.id,
        date: String(e.event_date).slice(0, 10),
        title: e.representative_title,
        articles: num(e.article_count),
        sources: num(e.source_count),
      })),
    });
  }
  return out;
}

/*
 * Bundle additions.
 */
export function historicalAnaloguesToBundleAdditions(analogueResult) {
  if (!analogueResult?.available || !analogueResult.analogues.length) {
    return { metrics: [], extension: { historicalAnalogues: { available: false, reason: analogueResult?.reason || null } } };
  }
  return {
    metrics: [{
      metricId: 'MET-HIST-ANALOGUE-COUNT',
      kind: 'historical_analogue',
      name: 'historical_analogue_count',
      value: analogueResult.analogues.length,
      unit: 'analogues',
      metadata: {
        topSimilarity: analogueResult.analogues[0]?.similarity,
        methodology: analogueResult.methodology,
      },
    }],
    extension: {
      historicalAnalogues: {
        available: true,
        methodology: analogueResult.methodology,
        currentWindow: analogueResult.currentWindow,
        analogues: analogueResult.analogues,
      },
    },
  };
}
