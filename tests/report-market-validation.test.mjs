import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportMarketValidation,
  classifyMarketValidationRows,
} from '../scripts/_shared/report-market-validation.mjs';

test('market validation engine classifies decision, screening, weak, and missing tiers', () => {
  const decision = classifyMarketValidationRows([{
    symbol: 'MSFT',
    eventWindow: '5d',
    relativeReturnPct: 3.2,
    tStat: 2.2,
    sampleSize: 80,
    eventCount: 6,
    controls: ['matched_controls', 'macro_regime_matched_controls'],
    validationStatus: 'validated',
  }]);
  const screening = classifyMarketValidationRows([{
    symbol: 'MSFT',
    eventWindow: '5d',
    tStat: 1.4,
    sampleSize: 60,
    eventCount: 3,
    controls: ['matched_controls', 'factor_controls'],
    validationStatus: 'validated',
  }]);
  const weak = classifyMarketValidationRows([{
    symbol: 'MSFT',
    eventWindow: '1d',
    tStat: 0.8,
    sampleSize: 8,
    eventCount: 1,
    controls: ['n_controls=8'],
    validationStatus: 'screened',
  }]);
  const missing = classifyMarketValidationRows([]);

  assert.equal(decision.tier, 'decision_grade');
  assert.equal(decision.evidenceUse, 'promotion_candidate');
  assert.equal(screening.tier, 'screening_grade');
  assert.equal(screening.evidenceUse, 'supporting_context');
  assert.equal(weak.tier, 'weak_screen');
  assert.equal(weak.evidenceUse, 'weak_noise');
  assert.equal(missing.tier, 'missing');
});

test('market validation loads local event_uplift rows with controlled market providers', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          symbol: 'MSFT',
          horizon: '5d',
          event_count: 7,
          n_controls: 120,
          avg_uplift_pct: 2.5,
          aggregate_t_stat: 2.4,
          evidence_grade: 'E2',
          latest_event_date: '2026-05-01',
          themes: ['ai-ml'],
        }],
      };
    },
  };
  const profile = await buildReportMarketValidation(client, {
    reportId: 'RPT-ai',
    bundle: {
      subject: { key: 'ai-ml', display: 'AI / Machine Learning', type: 'theme' },
      symbols: ['MSFT'],
    },
  });

  assert.equal(profile.tier, 'decision_grade');
  assert.equal(profile.localRowCount, 1);
  assert.match(calls[0].sql, /event_uplift/);
  assert.match(calls[0].sql, /canonical_event_id/);
  assert.deepEqual(calls[0].params[1], ['MSFT']);
});

test('market validation uses resolved report issuer universe and reports missing uplift reason', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM event_uplift/i.test(sql)) return { rows: [] };
      if (/FROM canonical_events/i.test(sql)) return { rows: [{ event_candidate_count: 4 }] };
      return { rows: [] };
    },
  };
  const profile = await buildReportMarketValidation(client, {
    reportId: 'RPT-srm',
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: '16776',
        subjectType: 'cross_theme_candidate',
        displayName: 'solid rocket motor capacity',
        metadata: {
          themes: ['defense-industrial', 'space'],
          discovery: {
            triggerTerms: ['Aerojet Rocketdyne', 'Northrop Grumman rocket motor'],
          },
        },
      },
    },
  });

  assert.equal(profile.tier, 'missing');
  assert.equal(profile.missingReason, 'no_event_uplift_rows');
  assert.equal(profile.nextAction.includes('repair-recent-event-uplift'), true);
  assert.deepEqual(profile.issuerUniverse.sort(), ['LHX', 'NOC']);
  assert.deepEqual(calls[0].params[1].sort(), ['LHX', 'NOC']);
});

test('market validation falls back to report-scoped market quote controls when event_uplift is sparse', async () => {
  const quoteRows = [];
  const start = Date.UTC(2026, 0, 1);
  const eventIndexes = new Set([20, 40, 60, 80, 100]);
  const eventDates = [...eventIndexes].map((idx) => new Date(start + idx * 86400000).toISOString().slice(0, 10));
  const symbols = ['MSFT', 'SPY', 'QQQ', 'XLI', 'XLU'];
  for (let i = 0; i < 125; i += 1) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    for (const symbol of symbols) {
      const benchmark = symbol !== 'MSFT';
      const eventLift = benchmark ? 0 : [...eventIndexes].some((idx) => i > idx && i <= idx + 5) ? 4 : 0;
      quoteRows.push({
        symbol,
        trade_date: date,
        price: 100 + (benchmark ? i * 0.01 : i * 0.02) + eventLift,
      });
    }
  }
  const client = {
    async query(sql) {
      if (/FROM event_uplift/i.test(sql)) return { rows: [] };
      if (/SELECT DISTINCT ce\.event_date/i.test(sql)) {
        return {
          rows: eventDates.map((event_date) => ({
            event_date,
            representative_title: 'interconnection study capacity queue backlog',
            event_rows: 1,
          })),
        };
      }
      if (/FROM market_quotes/i.test(sql)) return { rows: quoteRows };
      if (/COUNT\(\*\)::int AS event_candidate_count/i.test(sql)) return { rows: [{ event_candidate_count: eventDates.length }] };
      return { rows: [] };
    },
  };

  const profile = await buildReportMarketValidation(client, {
    reportId: 'RPT-grid',
    bundle: {
      subject: {
        type: 'theme',
        key: 'grid-power',
        display: 'interconnection study capacity',
        metadata: { themes: ['ai-ml', 'clean-energy'] },
      },
      symbols: ['MSFT'],
    },
  }, { lookbackDays: 365 });

  assert.notEqual(profile.tier, 'missing', JSON.stringify(profile));
  assert.equal(profile.eventUpliftRowCount, 0);
  assert.equal(profile.marketQuoteRowCount, 1);
  assert.equal(profile.rows[0].metadata.marketValidationSource, 'market_quotes_report_event_controls');
  assert.equal(profile.rows[0].eventCount >= 5, true, JSON.stringify(profile.rows[0]));
  assert.equal(profile.rows[0].sampleSize >= 30, true, JSON.stringify(profile.rows[0]));
});

test('strict endogenous market validation does not fall back to broad theme rows without direct issuer bridge', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM event_uplift/i.test(sql)) throw new Error('strict candidate-only report must not query broad event_uplift rows');
      if (/FROM canonical_events/i.test(sql)) return { rows: [{ event_candidate_count: 7 }] };
      return { rows: [] };
    },
  };
  const profile = await buildReportMarketValidation(client, {
    reportId: 'RPT-strict-candidate-only',
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: 'endogenous-adjacent-clean-energy-generated-approved-supplier-qualification-lead-time',
        subjectType: 'cross_theme_candidate',
        displayName: 'approved-supplier qualification lead time',
        metadata: {
          themes: ['clean-energy'],
          discoveryNamespace: 'strict_endogenous_adjacent',
        },
      },
      metadata: {
        strictEndogenous: true,
        discoveryNamespace: 'strict_endogenous_adjacent',
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [{
                symbol: 'ETN',
                issuerName: 'Eaton',
                status: 'candidate',
                role: 'equipment_supplier',
                sourceTypes: ['theme_ontology'],
              }, {
                symbol: 'PWR',
                issuerName: 'Quanta Services',
                status: 'candidate',
                role: 'service_or_epc',
                sourceTypes: ['theme_ontology'],
              }],
            },
          },
        },
      },
      marketReactions: [{
        symbol: 'AMD',
        eventWindow: '1w',
        tStat: 5.2,
        sampleSize: 120,
        eventCount: 10,
        controls: ['matched_controls', 'macro_regime_matched_controls'],
        validationStatus: 'validated',
      }],
    },
  });

  assert.equal(profile.tier, 'missing');
  assert.equal(profile.missingReason, 'no_issuer_universe');
  assert.deepEqual(profile.issuerUniverse, []);
  assert.deepEqual(profile.issuerResolution.candidateIssuerUniverse.sort(), ['ETN', 'PWR']);
  assert.equal(profile.rows.length, 0);
  assert.equal(calls.some((call) => /FROM event_uplift/i.test(call.sql)), false);
});
