import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateMetaModelTrust } from '../scripts/_shared/event-intelligence-builder.mjs';

const inferSource = readFileSync(new URL('../scripts/meta-model-infer.mjs', import.meta.url), 'utf-8');
const seedSource = readFileSync(new URL('../scripts/migrations/seed-theme-symbols-curation.mjs', import.meta.url), 'utf-8');
const healthSource = readFileSync(new URL('../scripts/_shared/event-intelligence-builder.mjs', import.meta.url), 'utf-8');
const incrementalEngineSource = readFileSync(new URL('../scripts/incremental-event-engine-fast.mjs', import.meta.url), 'utf-8');
const autoPipelineSource = readFileSync(new URL('../scripts/auto-pipeline.mjs', import.meta.url), 'utf-8');
const rssBackfillSource = readFileSync(new URL('../scripts/backfill-active-rss-sources.mjs', import.meta.url), 'utf-8');

test('meta-model inference fills pair-level gaps instead of event-level gaps', () => {
  assert.match(inferSource, /event, symbol, horizon, model_version/);
  assert.match(inferSource, /missing_pairs AS/);
  assert.match(inferSource, /AND mp\.symbol = ats\.symbol/);
  assert.match(inferSource, /AND mp\.horizon = h\.horizon/);
  assert.match(inferSource, /feature_computed_at/);
  assert.match(inferSource, /mp\.created_at < ce\.feature_computed_at/);
  assert.match(inferSource, /ON CONFLICT \(canonical_event_id, symbol, horizon, model_version\) DO UPDATE SET/);
  assert.match(inferSource, /alpha_prob = EXCLUDED\.alpha_prob/);
  assert.doesNotMatch(inferSource, /WHERE mp\.canonical_event_id = ef\.canonical_event_id\s+AND mp\.model_version = \$1\s+\)/);
});

test('meta-model inference self-heals theme-symbol coverage before querying pending events', () => {
  assert.match(inferSource, /ensureCuratedThemeSymbols/);
  assert.match(inferSource, /seeded curated theme-symbol fallbacks/);
  assert.match(seedSource, /export const CURATED_THEME_SYMBOL_MAPPINGS/);
  assert.match(seedSource, /export async function ensureCuratedThemeSymbols/);
  assert.match(seedSource, /ON CONFLICT \(theme, symbol\) DO NOTHING/);
});

test('auto-pipeline preserves curated symbol fallbacks after replacing auto symbols', () => {
  assert.match(autoPipelineSource, /TRUNCATE auto_theme_symbols RESTART IDENTITY/);
  assert.match(autoPipelineSource, /ensureCuratedThemeSymbols/);
  assert.match(autoPipelineSource, /fallbackInserted/);
});

test('dashboard meta-model health reports pipeline freshness and symbol coverage', () => {
  assert.match(healthSource, /pipelineFreshness/);
  assert.match(healthSource, /symbolCoverage/);
  assert.match(healthSource, /activeModel/);
  assert.match(healthSource, /purged_wf_aggregate/);
  assert.match(healthSource, /worstEce/);
  assert.match(healthSource, /event_features lag latest article date/);
  assert.match(healthSource, /featureLagDays/);
  assert.match(healthSource, /latestFeatureArticleDateKey/);
  assert.match(healthSource, /featureStaleEventCount/);
  assert.match(healthSource, /recent event_features rows are stale/);
  assert.match(healthSource, /recentCreatedCount/);
  assert.match(healthSource, /recentEventPredictionCount/);
  assert.match(healthSource, /latestPredictedArticleDateKey/);
  assert.match(healthSource, /countBasis: 'created_at'/);
  assert.match(healthSource, /recent themes have symbol mappings/);
  assert.match(healthSource, /loadMetaModelCalibrationSidecar/);
  assert.match(healthSource, /promotionGates/);
  assert.match(healthSource, /effectiveMetrics/);
  assert.match(healthSource, /predictionStaleCount/);
  assert.match(healthSource, /WITH current_universe AS/);
  assert.match(healthSource, /mp\.model_version = \$1/);
  assert.match(healthSource, /const trust = evaluateMetaModelTrust\(\{\s*hasEval: haveEval,\s*hasPredictions: havePredictions,/);
});

test('hot-events model trust uses active current universe stale checks', () => {
  const probeStart = healthSource.indexOf('async function probeModelTrust');
  const probeBlock = healthSource.slice(probeStart, probeStart + 2600);
  assert.notEqual(probeStart, -1);
  assert.match(probeBlock, /target_model AS/);
  assert.match(probeBlock, /promotion_state = 'active'/);
  assert.match(probeBlock, /current_universe AS/);
  assert.match(probeBlock, /auto_theme_symbols/);
  assert.match(probeBlock, /ce\.event_date >= NOW\(\)::date - INTERVAL '14 days'/);
  assert.match(probeBlock, /mp\.model_version = \(SELECT model_version FROM target_model\)/);
  assert.match(probeBlock, /mp\.symbol = cu\.symbol/);
  assert.match(probeBlock, /mp\.horizon = cu\.horizon/);
  assert.doesNotMatch(probeBlock, /FROM model_predictions mp\s+JOIN latest_features/);
});

test('calibrated active model can be operationally ok while raw worst split stays visible', () => {
  const trust = evaluateMetaModelTrust({
    hasEval: true,
    hasPredictions: true,
    latestEval: {
      brierScore: 0.216,
      worstBrierScore: 0.242,
      ece: 0.099,
      worstEce: 0.144,
      top20Precision: 0.25,
      sampleCount: 92_000,
    },
    recentPredictions: { total: 1000, recentCount: 100 },
    pipelineFreshness: {
      featureLagDays: 0,
      featureStaleEventCount: 0,
      predictionStaleCount: 0,
      articles24h: 300,
    },
    symbolCoverage: { coveragePct: 1 },
    calibration: {
      postMetrics: { brier: 0.247, ece: 0.059 },
      preMetrics: { brier: 0.267, ece: 0.102 },
      validationN: 5000,
    },
  });

  assert.equal(trust.level, 'ok');
  assert.equal(trust.healthStatus, 'ok');
  assert.equal(trust.effectiveMetrics.calibrated, true);
  assert.equal(trust.effectiveMetrics.ece, 0.059);
  assert.match(trust.notes[0], /operational ECE/);
  assert.ok(trust.gates.some((gate) => gate.name === 'effective-ece' && gate.status === 'pass'));
});

test('incremental event engine uses SQL date keys instead of UTC-shifted JS dates', () => {
  assert.match(incrementalEngineSource, /to_char\(a\.published_at::date, 'YYYY-MM-DD'\) as event_date_key/);
  assert.match(incrementalEngineSource, /to_char\(ce\.event_date, 'YYYY-MM-DD'\) as event_date_key/);
  assert.match(incrementalEngineSource, /repairCanonicalEventDates/);
  assert.match(incrementalEngineSource, /EVENT_ENGINE_REPAIR_DAYS/);
  assert.match(incrementalEngineSource, /SKIP_CONTROLS/);
  assert.doesNotMatch(incrementalEngineSource, /art\.event_date\.toISOString\(\)\.slice\(0, 10\)/);
  assert.doesNotMatch(incrementalEngineSource, /evt\.event_date\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(rssBackfillSource, /to_char\(a\.published_at::date, 'YYYY-MM-DD'\) AS event_date_key/);
  assert.doesNotMatch(rssBackfillSource, /row\.event_date\.toISOString\(\)\.slice\(0, 10\)/);
});

test('incremental event engine refreshes stale event feature rows', () => {
  assert.match(incrementalEngineSource, /FEATURE_REFRESH_DAYS/);
  assert.match(incrementalEngineSource, /ce\.event_date >= NOW\(\)::date - \(\$1::int \* INTERVAL '1 day'\)/);
  assert.match(incrementalEngineSource, /COALESCE\(ce\.article_count, -1\) <> COALESCE\(ef\.article_count, -1\)/);
  assert.match(incrementalEngineSource, /ON CONFLICT \(canonical_event_id\) DO UPDATE SET/);
  assert.match(incrementalEngineSource, /article_count = EXCLUDED\.article_count/);
});
