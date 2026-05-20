import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOntologyTranscriptTerms,
  buildSecArchiveIndexUrl,
  bestPublicPlanningExcerpt,
  buildUsaSpendingAwardSearchPayload,
  extractBackfillTargetsFromRows,
  extractOntologyKpiHitsFromText,
  extractDodContractFacts,
  extractSecAttachmentCandidates,
  extractUsaSpendingAwardFacts,
  loadThemeSymbols,
  mergeBackfillTargets,
  normalizeBackfillTarget,
  officialProviderAcceptance,
  officialProviderEvidenceUse,
  parseArgs,
  parseDodContractRssItems,
  providerCooldownsFromRuns,
  providerRouteEvidenceClasses,
  providerRunStatus,
  selectProvidersForBackfillTarget,
  symbolsNeedingSecCompanyFactsRefresh,
} from '../scripts/collect-free-external-data.mjs';
import { loadFor as loadFmp } from '../scripts/_shared/external-data/fmp.mjs';
import { SUBJECT_KINDS } from '../scripts/_shared/external-data/adapter-base.mjs';
import { ontologyKpiDefinitionsForTheme } from '../scripts/_shared/theme-ontology.mjs';

test('parseArgs enables auto discovery without losing provider selection', () => {
  const parsed = parseArgs([
    '--auto-discover',
    '--providers', 'fred,eia,fmp,polygon',
    '--themes', 'cloud-infrastructure,space',
    '--limit', '12',
    '--since-hours', '72',
    '--report-id=RPT-scope',
    '--sec-refresh-stale-hours', '0',
  ]);
  assert.equal(parsed.autoDiscover, true);
  assert.deepEqual(parsed.providers, ['fred', 'eia', 'fmp', 'polygon']);
  assert.deepEqual(parsed.themes, ['cloud-infrastructure', 'space']);
  assert.equal(parsed.limit, 12);
  assert.equal(parsed.sinceHours, 72);
  assert.equal(parsed.reportId, 'RPT-scope');
  assert.equal(parsed.secRefresh, true);
  assert.equal(parsed.secRefreshStaleHours, 0);
});

test('normalizeBackfillTarget produces deterministic target keys and symbols', () => {
  const target = normalizeBackfillTarget({
    label: 'Linde cryogenic cooling',
    symbols: ['lin', 'LIN', 'bad symbol!'],
    discoveredFrom: ['tracked_targets'],
  });
  assert.equal(target.theme, 'linde-cryogenic-cooling');
  assert.deepEqual(target.symbols, ['LIN']);
  assert.equal(target.targetKey, 'linde-cryogenic-cooling::LIN');

  const a = normalizeBackfillTarget({ theme: 'clean-energy', symbols: ['PWR', 'ETN'] });
  const b = normalizeBackfillTarget({ theme: 'clean-energy', symbols: ['ETN', 'PWR'] });
  assert.equal(a.targetKey, b.targetKey);
  assert.equal(a.targetKey, 'clean-energy::ETN,PWR');
});

test('extractBackfillTargetsFromRows covers tracked targets and source-query approvals', () => {
  const targets = extractBackfillTargetsFromRows({
    trackedTargets: [{
      id: 7,
      label: 'Linde cryogenic cooling',
      target_type: 'keyword',
      normalized_key: 'linde-cryogenic-cooling',
      aliases: ['liquid hydrogen', 'rocket fuel'],
      symbols: ['LIN'],
      priority: 'high',
    }],
    approvals: [{
      id: 11,
      action_type: 'source-query',
      payload: {
        query: 'Bluefors quantum cooling supplier evidence',
        themes: ['quantum-computing', 'space'],
        supplier: 'Bluefors',
      },
      status: 'pending',
      reasoning: 'Evidence expansion',
    }],
  });
  const byTheme = new Map(targets.map((target) => [target.theme, target]));
  assert.equal(byTheme.get('linde-cryogenic-cooling').symbols[0], 'LIN');
  assert.deepEqual(byTheme.get('linde-cryogenic-cooling').trackingTargetIds, ['7']);
  assert.equal(byTheme.get('quantum-computing').label, 'Bluefors');
  assert.equal(byTheme.get('space').label, 'Bluefors');
});

test('extractBackfillTargetsFromRows preserves issuer symbols from report backfill metadata', () => {
  const targets = extractBackfillTargetsFromRows({
    reportBackfills: [{
      subject_key: 'defense-industrial',
      subject_label: 'Defense Industrial',
      query: 'Defense Industrial direct issuer commentary',
      data_pack: 'transcriptPack',
      status: 'pending',
      metadata: {
        target: {
          issuerUniverseSymbols: ['RTX', 'LMT', 'ITA', 'UUP'],
        },
      },
    }],
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].theme, 'defense-industrial');
  assert.deepEqual(targets[0].symbols, ['RTX', 'LMT']);
});

test('provider route metadata narrows external backfill provider selection', () => {
  const requested = ['fred', 'eia', 'public-planning-source', 'sec', 'fmp', 'polygon', 'dod-contracts', 'usaspending'];
  const procurement = selectProvidersForBackfillTarget({
    theme: 'defense-industrial',
    label: 'Defense Industrial',
    sources: ['report_backfill_tasks'],
    providerRoutePlans: [{
      evidenceClass: 'procurement_trigger',
      executableCollectors: ['dod-contracts', 'usaspending', 'source-query'],
    }],
  }, { providers: requested, theme: 'defense-industrial' }, ['LMT']);
  const market = selectProvidersForBackfillTarget({
    theme: 'ai-ml',
    label: 'AI / Machine Learning',
    sources: ['report_backfill_tasks'],
    providerRoutePlans: [{
      evidenceClass: 'market_validation',
      executableCollectors: ['polygon', 'fmp'],
    }],
  }, { providers: requested, theme: 'ai-ml' }, ['MSFT']);
  const negative = selectProvidersForBackfillTarget({
    theme: 'defense-industrial',
    label: 'Defense Industrial',
    sources: ['report_backfill_tasks'],
    providerRoutePlans: [{
      evidenceClass: 'negative_control',
      executableCollectors: ['source-query'],
    }],
  }, { providers: requested, theme: 'defense-industrial' }, ['LMT']);
  const grid = selectProvidersForBackfillTarget({
    theme: 'endogenous-grid-node',
    label: 'interconnection study specialist capacity',
    sources: ['report_backfill_tasks'],
    providerRoutePlans: [{
      evidenceClass: 'grid_interconnection',
      executableCollectors: ['eia', 'public-planning-source', 'sec', 'fmp', 'source-query'],
    }],
  }, { providers: requested, theme: 'ai-ml' }, []);

  assert.deepEqual(procurement.sort(), ['dod-contracts', 'usaspending']);
  assert.deepEqual(market.sort(), ['fmp', 'polygon']);
  assert.deepEqual(negative, []);
  assert.deepEqual(grid.sort(), ['public-planning-source', 'sec']);
});

test('report-scoped provider routes infer ontology without treating program acronyms as tickers', () => {
  const target = normalizeBackfillTarget({
    theme: '16776',
    label: 'solid rocket motor capacity',
    query: 'solid rocket motor PAC-3 THAAD GMLRS PrSM SM-6 contract award site:war.gov',
    symbols: ['LMT', 'LHX', 'NOC'],
    providerRoutePlan: {
      evidenceClass: 'policy_funding',
      ontologyKey: 'defense_industrial',
      executableCollectors: ['dod-contracts', 'usaspending', 'source-query'],
      sourceProviders: ['war.gov-contracts', 'usaspending'],
    },
  });
  const terms = buildOntologyTranscriptTerms({
    theme: '16776',
    label: 'solid rocket motor capacity',
    providerRoutePlans: [{
      evidenceClass: 'policy_funding',
      ontologyKey: 'defense_industrial',
      executableCollectors: ['dod-contracts', 'usaspending', 'source-query'],
      sourceProviders: ['war.gov-contracts', 'usaspending'],
      queryVariants: ['PAC-3 THAAD GMLRS PrSM SM-6 interceptor solid rocket motor Aerojet Northrop budget justification site:defense.gov'],
    }],
  }).map((term) => term.toLowerCase());

  assert.deepEqual(target.symbols, ['LMT', 'LHX', 'NOC']);
  assert.equal(terms.some((term) => term.includes('contract award')), true);
  assert.equal(terms.some((term) => term.includes('munitions')), true);
});

test('official provider rows become report-scoped promotion only for matching official evidence classes', () => {
  const classes = providerRouteEvidenceClasses({
    desiredEvidenceClasses: ['policy-funding'],
    providerRoutePlans: [
      { evidenceClass: 'mission_award' },
      { evidenceClass: 'substitution_limit' },
    ],
  }).sort();
  const item = {
    hitKpis: ['defense_contract_awards', 'defense_procurement_budget_lines'],
    largestAwardUsd: 535_623_041,
  };

  assert.deepEqual(classes, ['mission_award', 'policy_funding', 'substitution_limit']);
  assert.equal(officialProviderEvidenceUse('policy_funding', 'dod-contracts', item), 'promotion_candidate');
  assert.equal(officialProviderEvidenceUse('mission_award', 'usaspending', item), 'promotion_candidate');
  assert.equal(officialProviderEvidenceUse('substitution_limit', 'dod-contracts', item), 'supporting_context');
  assert.equal(officialProviderEvidenceUse('historical_analog', 'dod-contracts', item), null);

  const acceptance = officialProviderAcceptance('policy_funding', 'dod-contracts', item);
  assert.equal(acceptance.evidenceUse, 'promotion_candidate');
  assert.equal(acceptance.collectorCapability.supported, true);
  assert.equal(acceptance.factsExtracted.some((fact) => fact.key === 'funding_or_budget'), true);
  assert.equal(acceptance.closureReason, 'promotion_collected');
});

test('report-scoped auto discovery only reads matching report approvals and backfill tasks', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM approval_queue')) {
        return { rows: [{
          id: 22,
          action_type: 'source-query',
          payload: {
            query: 'solid rocket motor PAC-3 THAAD contract award site:war.gov',
            reportId: 'RPT-srm',
            latestReportId: 'RPT-srm',
            subjectKey: '16776',
            themes: ['defense-industrial'],
            desiredEvidenceClass: 'procurement_trigger',
            providerRoutePlan: {
              evidenceClass: 'procurement_trigger',
              executableCollectors: ['dod-contracts', 'usaspending', 'source-query'],
            },
          },
          status: 'pending',
          reasoning: 'report scoped',
        }] };
      }
      if (sql.includes('FROM report_backfill_tasks')) {
        return { rows: [{
          report_id: 'RPT-srm',
          subject_key: '16776',
          subject_label: 'solid rocket motor capacity',
          query: 'solid rocket motor budget justification site:defense.gov',
          data_pack: 'policyPack',
          status: 'pending',
          metadata: {
            desiredEvidenceClass: 'policy_funding',
            providerRoutePlan: {
              evidenceClass: 'policy_funding',
              executableCollectors: ['dod-contracts', 'usaspending', 'source-query'],
            },
          },
        }] };
      }
      return { rows: [] };
    },
  };

  const targets = await import('../scripts/collect-free-external-data.mjs')
    .then((mod) => mod.discoverProviderBackfillTargets(client, { reportId: 'RPT-srm', sinceHours: 24, limit: 10 }));
  const sqlText = calls.map((call) => call.sql).join('\n');

  assert.equal(calls.some((call) => call.sql.includes('FROM tracked_targets')), false);
  assert.equal(calls.some((call) => call.sql.includes('FROM source_registry')), false);
  assert.match(sqlText, /payload->>'latestReportId' = \$3::text/);
  assert.match(sqlText, /metadata->>'latestReportId' = \$3::text/);
  assert.equal(calls.every((call) => call.params.includes('RPT-srm')), true);
  assert.equal(targets.some((target) => target.desiredEvidenceClasses.includes('procurement-trigger')), true);
  assert.equal(targets.some((target) => target.desiredEvidenceClasses.includes('policy-funding')), true);
});

test('loadThemeSymbols resolves issuer universe from generic DB evidence sources', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('theme_symbol_mappings')) return { rows: [] };
      if (sql.includes('theme_entity_exposure')) return { rows: [{ symbol: 'RTX' }, { symbol: 'ITA' }] };
      if (sql.includes('regime_conditional_impact')) return { rows: [{ symbol: 'GD' }] };
      if (sql.includes('tracked_targets')) return { rows: [{ symbols: ['LMT', 'UUP', 'MW'] }] };
      if (sql.includes('report_backfill_tasks')) {
        return { rows: [{ metadata: { target: { issuerUniverseSymbols: ['NOC', 'SMH', 'NATO', 'LLM'] } } }] };
      }
      if (sql.includes('approval_queue')) return { rows: [{ payload: { target: { issuerUniverseSymbols: ['AVAV', 'BDRY', 'EU', 'ICLN'] } } }] };
      if (sql.includes('external_provider_backfill_runs')) return { rows: [{ target_symbols: ['KTOS', 'SPY', 'DOD'] }] };
      return { rows: [] };
    },
  };

  const symbols = await loadThemeSymbols(client, 'defense-industrial', [], { label: 'Defense Industrial' });
  assert.deepEqual(symbols, ['RTX', 'GD', 'LMT', 'NOC', 'AVAV', 'KTOS']);
});

test('loadThemeSymbols does not fall back to stale broad symbols in strict endogenous mode', async () => {
  const client = {
    async query() {
      throw new Error('strict endogenous symbol resolution should not query broad DB fallbacks');
    },
  };

  const symbols = await loadThemeSymbols(client, 'strict-generated-lane', [], {
    label: 'Strict Generated Lane',
    strictEndogenous: true,
  });
  assert.deepEqual(symbols, []);
});

test('extractBackfillTargetsFromRows ignores unresolved report-gap source queries', () => {
  const targets = extractBackfillTargetsFromRows({
    approvals: [{
      id: 99,
      action_type: 'source-query',
      payload: {
        query: 'unknown regulation subsidy procurement sanctions policy',
        source: 'report-deep-research-pack',
        reportBackfillTaskId: '44',
        subjectKey: 'unknown',
        themes: ['technology-general'],
      },
      status: 'pending',
      reasoning: 'Report deep research gap (policyPack): No canonical report mutation is performed by the daemon.',
    }],
    reportBackfills: [{
      subject_key: 'unknown',
      query: 'unknown industry KPI capacity demand supply orders backlog',
      data_pack: 'industryPack',
      status: 'pending',
    }, {
      subject_key: 'system-quality',
      query: 'System quality and trust thesis evidence market fundamentals filings transcript industry KPI historical analog causal mechanism',
      data_pack: 'corePackExpansion',
      status: 'pending',
    }, {
      subject_key: 'no-match-theme-cloud-infrastructure',
      query: 'No symbol signal report bound to cloud-infrastructure earnings call transcript management commentary',
      data_pack: 'transcriptPack',
      status: 'pending',
    }],
  });
  assert.deepEqual(targets, []);
});

test('mergeBackfillTargets deduplicates aliases and source traces', () => {
  const [target] = mergeBackfillTargets([
    { theme: 'cloud-infrastructure', label: 'Cloud Infrastructure', aliases: ['data centers'], discoveredFrom: ['theme_kpi_map'] },
    { theme: 'cloud-infrastructure', label: 'Cloud Infrastructure', aliases: ['data centers', 'power'], discoveredFrom: ['report_backfill_tasks'] },
  ]);
  assert.deepEqual(target.aliases, ['Cloud Infrastructure', 'data centers', 'power']);
  assert.deepEqual(target.sources, ['theme_kpi_map', 'report_backfill_tasks']);
});

test('mergeBackfillTargets collapses duplicate report-scoped collection universes', () => {
  const targets = mergeBackfillTargets([{
    theme: 'clean-energy',
    label: 'Clean Energy',
    symbols: ['PWR', 'ETN'],
    reportId: 'RPT-old',
    providerRoutePlans: [{ evidenceClass: 'issuer_exposure', executableCollectors: ['sec'] }],
  }, {
    theme: 'endogenous-adjacent-clean-energy-generated-node',
    label: 'Generated node',
    symbols: ['ETN', 'PWR'],
    reportId: 'RPT-new',
    strictEndogenous: true,
    providerRoutePlans: [{ evidenceClass: 'issuer_commentary', executableCollectors: ['sec', 'fmp'] }],
  }]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].targetKey, 'endogenous-adjacent-clean-energy-generated-node::ETN,PWR');
  assert.deepEqual(targets[0].symbols, ['ETN', 'PWR']);
  assert.equal(targets[0].strictEndogenous, true);
  assert.deepEqual(new Set(targets[0].providerRoutePlans.map((plan) => plan.evidenceClass)), new Set(['issuer_commentary', 'issuer_exposure']));
  assert.deepEqual(new Set(targets[0].reportIds), new Set(['RPT-new', 'RPT-old']));
});

test('ontology transcript terms adapt to defense instead of hard-coded AI terms', () => {
  const terms = buildOntologyTranscriptTerms({
    theme: 'defense-industrial',
    label: 'Defense Industrial',
  }).map((term) => term.toLowerCase());
  assert.equal(terms.some((term) => term.includes('backlog')), true);
  assert.equal(terms.some((term) => term.includes('book-to-bill')), true);
  assert.equal(terms.some((term) => term.includes('contract award')), true);
  assert.equal(terms.some((term) => term.includes('munitions')), true);
  assert.equal(terms.some((term) => term.includes('launch cadence')), false);
});

test('ontology KPI extraction maps defense issuer text to exact required KPI keys', () => {
  const definitions = ontologyKpiDefinitionsForTheme({
    themeId: 'defense-industrial',
    themeLabel: 'Defense Industrial',
  });
  const hits = extractOntologyKpiHitsFromText(
    'Management said funded backlog increased, book-to-bill exceeded 1.0, and a missile contract award supports missile defense replenishment demand with fiscal procurement funds.',
    definitions,
  );
  const keys = new Set(hits.map((hit) => hit.definition.kpiKey));
  assert.equal(keys.has('defense_backlog'), true);
  assert.equal(keys.has('defense_book_to_bill'), true);
  assert.equal(keys.has('defense_contract_awards'), true);
  assert.equal(keys.has('defense_missile_air_defense_demand'), true);
  assert.equal(keys.has('defense_procurement_budget_lines'), true);
});

test('ontology KPI extraction does not satisfy critical KPIs from a weak generic order mention alone', () => {
  const definitions = ontologyKpiDefinitionsForTheme({
    themeId: 'defense-industrial',
    themeLabel: 'Defense Industrial',
  });
  const hits = extractOntologyKpiHitsFromText('Management said orders were discussed during the quarter.', definitions);
  const keys = new Set(hits.map((hit) => hit.definition.kpiKey));
  assert.equal(keys.has('defense_backlog'), false);
  assert.equal(keys.has('defense_book_to_bill'), false);
});

test('DoD contract RSS parser and award facts support defense ontology backfill', () => {
  const xml = `
    <rss><channel><item>
      <title>Contracts for May 8, 2026</title>
      <link>https://www.war.gov/News/Contracts/Contract/Article/4479466/contracts-for-may-8-2026/</link>
      <description>Today's contracts are live.</description>
      <pubDate>Fri, 08 May 2026 21:01:39 GMT</pubDate>
    </item></channel></rss>
  `;
  const [item] = parseDodContractRssItems(xml);
  assert.equal(item.title, 'Contracts for May 8, 2026');
  assert.equal(item.pubDate, '2026-05-08T21:01:39.000Z');
  const facts = extractDodContractFacts('Lockheed Martin was awarded a $407.1 million contract modification for missile defense. Obligations include $76,164,591 in research funds.');
  assert.equal(facts.amountCount, 2);
  assert.equal(facts.largestAwardText, '$407.1 million');
});

test('SEC attachment discovery prioritizes earnings-release exhibits over the primary filing', () => {
  const row = {
    cik: '0000101829',
    accession: '0000101829-26-000015',
    primary_document: 'rtx-20260130.htm',
    primary_doc_url: 'https://www.sec.gov/Archives/edgar/data/101829/000010182926000015/rtx-20260130.htm',
  };
  assert.equal(
    buildSecArchiveIndexUrl(row),
    'https://www.sec.gov/Archives/edgar/data/101829/000010182926000015/index.json',
  );

  const candidates = extractSecAttachmentCandidates({
    directory: {
      item: [
        { name: 'rtx-20260130.htm' },
        { name: 'rtx-ex991_earningsrelease.htm' },
        { name: 'rtx-ex992-investor-presentation.htm' },
        { name: 'rtx-20260130_htm.xml' },
      ],
    },
  }, row);

  assert.deepEqual(candidates.map((candidate) => candidate.name), [
    'rtx-ex991_earningsrelease.htm',
    'rtx-ex992-investor-presentation.htm',
  ]);
  assert.equal(candidates[0].sourceType, 'sec_earnings_release_exhibit');
});

test('USAspending award extraction creates contract-award evidence without clearing book-to-bill', () => {
  const payload = buildUsaSpendingAwardSearchPayload({
    recipientName: 'Lockheed Martin Corporation',
    startDate: '2025-10-01',
    endDate: '2026-05-12',
    limit: 3,
  });

  assert.deepEqual(payload.filters.recipient_search_text, ['Lockheed Martin Corporation']);
  assert.equal(payload.filters.agencies[0].name, 'Department of Defense');
  assert.equal(payload.fields.includes('Award Amount'), true);

  const awards = extractUsaSpendingAwardFacts({
    results: [{
      'Award ID': 'W31P4Q-26-C-0001',
      'Recipient Name': 'LOCKHEED MARTIN CORPORATION',
      'Award Amount': 407100000,
      Description: 'Missile defense production contract award for munitions replenishment.',
      'Awarding Agency': 'Department of Defense',
      'Awarding Sub Agency': 'Department of the Army',
      'Start Date': '2026-05-01',
    }],
  }, { symbol: 'LMT', recipientName: 'Lockheed Martin Corporation' });

  assert.equal(awards.length, 1);
  assert.equal(awards[0].amountUsd, 407100000);
  assert.equal(awards[0].kpiKey, 'defense_contract_awards');
  assert.equal(awards[0].text.includes('book-to-bill'), false);
});

test('providerRunStatus marks FMP rate limits as deferred provider work', () => {
  assert.equal(providerRunStatus([
    { provider: 'sec', ok: true },
    { provider: 'fmp', ok: false, rateLimited: true, retryable: true },
  ]), 'deferred_provider');
  assert.equal(providerRunStatus([
    { provider: 'sec', ok: true },
    { provider: 'fmp', ok: false, retryable: true },
  ]), 'retry_wait');
  assert.equal(providerRunStatus([
    { provider: 'sec', skipped: true },
  ]), 'skipped');
});

test('providerCooldownsFromRuns preserves provider retry queue after rate limits', () => {
  const rows = [{
    id: 42,
    target_symbols: ['ETN', 'PWR'],
    status: 'deferred_provider',
    created_at: '2026-05-18T09:00:00.000Z',
    summary: {
      results: [{
        provider: 'fmp',
        rateLimited: true,
        retryable: true,
        retryAfterSec: 3600,
        deferredSymbols: ['ETN', 'PWR'],
      }, {
        provider: 'sec',
        ok: true,
      }],
    },
  }];

  const cooldowns = providerCooldownsFromRuns(rows, new Date('2026-05-18T09:30:00.000Z'), ['fmp', 'sec']);
  assert.equal(cooldowns.length, 1);
  assert.equal(cooldowns[0].provider, 'fmp');
  assert.equal(cooldowns[0].nextAttemptAt, '2026-05-18T10:00:00.000Z');
  assert.deepEqual(cooldowns[0].deferredSymbols, ['ETN', 'PWR']);
});

test('FMP adapter does not abort transcript collection when income endpoint is rate limited', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'test-key';
  const called = [];
  globalThis.fetch = async (url) => {
    called.push(String(url));
    const headers = { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '120' : null) };
    if (String(url).includes('/income-statement?')) {
      return { ok: false, status: 429, headers, text: async () => 'rate limited' };
    }
    if (String(url).includes('/earning-call-transcript-dates?')) {
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => [{ year: 2026, quarter: 1, date: '2026-04-25' }],
      };
    }
    if (String(url).includes('/earning-call-transcript?')) {
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => [{
          symbol: 'VRT',
          year: 2026,
          quarter: 1,
          transcript: 'Management said data center power interconnection demand supports segment revenue, backlog, customer contracts, and guidance.',
        }],
      };
    }
    return { ok: true, status: 200, headers, json: async () => [] };
  };

  try {
    const result = await loadFmp({ kind: SUBJECT_KINDS.SYMBOL, key: 'VRT' }, {
      transcriptTerms: ['interconnection demand', 'data center power'],
      transcriptLimit: 1,
    });
    assert.equal(result.rateLimited, true);
    assert.equal(result.retryAfterSec, 120);
    assert.equal(result.pack.earningsTranscripts.length, 1);
    assert.equal(called.some((url) => url.includes('/earning-call-transcript?')), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = originalKey;
  }
});

test('direct SEC/FMP issuer evidence can attach bridge only when class facts are present', () => {
  const direct = officialProviderAcceptance('issuer_exposure', 'fmp', {
    symbol: 'VRT',
    title: 'VRT earnings call transcript',
    sourceType: 'fmp_earning_call_transcript',
    excerpt: 'Management said data center power infrastructure demand supports the thermal management segment revenue, backlog, customer contracts, and guidance.',
  });
  const coMention = officialProviderAcceptance('issuer_exposure', 'fmp', {
    symbol: 'VRT',
    title: 'VRT mentioned in grid article',
    sourceType: 'fmp_earning_call_transcript',
    excerpt: 'The company was mentioned near interconnection queues but gave no operating linkage or financial detail.',
  });
  const offTarget = officialProviderAcceptance('issuer_exposure', 'sec', {
    symbol: 'AMD',
    title: 'AMD 8-K direct management commentary',
    sourceType: 'sec_direct_management_commentary',
    filingType: '8-K',
    targetHit: false,
    excerpt: 'FORM 8-K CURRENT REPORT with no report-specific grid interconnection queue exposure.',
  });

  assert.equal(direct.evidenceUse, 'promotion_candidate');
  assert.equal(direct.factKeys.includes('revenue_backlog_or_customer_link'), true);
  assert.equal(coMention.evidenceUse === 'promotion_candidate', false);
  assert.equal(offTarget.evidenceUse === 'promotion_candidate', false);
  assert.equal(offTarget.closureReason, 'acceptance_failed');
});

test('public planning source can promote grid interconnection evidence when playbook facts match', () => {
  const item = {
    title: 'LBNL Queued Up interconnection queue dataset',
    sourceType: 'public_planning_source',
    url: 'https://emp.lbl.gov/queues',
    excerpt: 'ISOs, RTOs, and utilities require interconnection impact studies before projects connect to the transmission grid; active queues contain gigawatts of capacity and wait times are increasing.',
  };
  const acceptance = officialProviderAcceptance('grid_interconnection', 'public-planning-source', item);
  assert.equal(acceptance.evidenceUse, 'promotion_candidate');
  assert.equal(acceptance.officialSource, true);
  assert.equal(acceptance.factKeys.includes('interconnection_queue'), true);
  assert.equal(acceptance.factKeys.includes('transmission_or_utility'), true);
  assert.equal(acceptance.factKeys.includes('capacity_or_timing'), true);
});

test('public planning excerpt scorer skips boilerplate and keeps frontier facts', () => {
  const page = `
    Clean Energy Resources to Meet Data Center Electricity Demand | Department of Energy
    Skip to main content An official website of the United States government Here's how you know
    Main Menu Policy & Priorities View all Policy & Priorities
    This page covers federal programs.
    Later in the article, transmission providers and utilities must process interconnection studies before large loads connect to the grid.
    Queue backlogs and wait times can delay data center energization, and active interconnection queues include gigawatts of proposed capacity.
  `;
  const excerpt = bestPublicPlanningExcerpt(page, ['data centers', 'interconnection studies'], 420);
  assert.match(excerpt, /interconnection studies/i);
  assert.match(excerpt, /queue backlogs|gigawatts/i);
  assert.doesNotMatch(excerpt, /Skip to main content/i);
});

test('SEC provider refresh planner seeds missing issuer filings before extraction', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      assert.deepEqual(params[0], ['RTX', 'LMT']);
      return { rows: [{ ticker: 'RTX', filing_count: 12, last_imported_at: new Date().toISOString() }] };
    },
  };

  const missing = await symbolsNeedingSecCompanyFactsRefresh(client, ['RTX', 'LMT', 'ICLN', 'MW'], {
    secRefresh: true,
    secRefreshStaleHours: 24,
  });
  assert.deepEqual(missing, ['LMT']);
  assert.equal(calls.length, 1);

  const disabled = await symbolsNeedingSecCompanyFactsRefresh(client, ['RTX', 'LMT'], {
    secRefresh: false,
  });
  assert.deepEqual(disabled, []);
});
