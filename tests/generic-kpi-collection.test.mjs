import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKpiCollectionQuery,
  inferKpiDefinitionsForTheme,
} from '../scripts/_shared/generic-kpi-collection.mjs';
import {
  buildOntologyBackfillTasks,
  evaluateOntologyCoverage,
  filterIssuerSymbols,
  resolveThemeOntology,
  scoreOntologyAnchorFit,
} from '../scripts/_shared/theme-ontology.mjs';

test('generic KPI inference maps themes through reusable ontology archetypes', () => {
  const cloud = inferKpiDefinitionsForTheme({
    themeId: 'cloud-infrastructure',
    themeLabel: 'Cloud Infrastructure',
    category: 'technology',
    parentTheme: 'technology-general',
  }).map((item) => item.kpiKey);

  const space = inferKpiDefinitionsForTheme({
    themeId: 'space-economy',
    themeLabel: 'Space Economy',
    category: 'technology',
    parentTheme: 'technology-general',
  }).map((item) => item.kpiKey);

  assert.equal(cloud.includes('attention_volume'), true);
  assert.equal(space.includes('attention_volume'), true);
  assert.equal(cloud.includes('capacity_buildout_proxy'), true);
  assert.equal(space.includes('capacity_buildout_proxy'), true);
  assert.equal(cloud.includes('data_center_power_capacity'), true);
  assert.equal(space.includes('space_launch_cadence'), true);
  assert.equal(space.includes('data_center_power_capacity'), false);
});

test('KPI source queries are generated from theme plus KPI definition', () => {
  const [definition] = inferKpiDefinitionsForTheme({
    themeId: 'defense-industrial',
    category: 'geopolitics',
    parentTheme: 'defense',
  }).filter((item) => item.kpiKey === 'procurement_policy_pressure');

  const query = buildKpiCollectionQuery({
    themeId: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    definition,
    sourceType: 'policy_evidence',
  });

  assert.match(query, /Defense Industrial/);
  assert.match(query, /Procurement and policy pressure/);
  assert.match(query, /policy_evidence/);
});

test('defense ontology resolves critical investment KPIs', () => {
  const ontology = resolveThemeOntology({
    themeId: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    parentTheme: 'defense',
  });
  const keys = inferKpiDefinitionsForTheme({
    themeId: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    parentTheme: 'defense',
  }).map((item) => item.kpiKey);

  assert.equal(ontology.key, 'defense_industrial');
  assert.equal(keys.includes('defense_backlog'), true);
  assert.equal(keys.includes('defense_book_to_bill'), true);
  assert.equal(keys.includes('defense_contract_awards'), true);
  assert.equal(keys.includes('defense_munitions_capacity'), true);
  assert.equal(keys.includes('direct_management_commentary'), true);
});

test('generic fallback ontology still creates investment-readiness gaps instead of silent pass', () => {
  const ontology = resolveThemeOntology({
    themeId: 'novel-supply-chain-theme',
    themeLabel: 'Novel Supply Chain Theme',
  });
  const coverage = evaluateOntologyCoverage({
    subject: { subjectId: 'novel-supply-chain-theme', displayName: 'Novel Supply Chain Theme' },
    marketReactions: [{ symbol: 'ABC' }],
    metadata: { themeContext: { events: [{ title: 'Generic industry headline' }] } },
  }, {
    rows: {
      symbols: ['ABC'],
      transcripts: [],
      genericKpis: { observations: [] },
    },
  });
  const tasks = buildOntologyBackfillTasks(coverage, { subject: 'Novel Supply Chain Theme' });

  assert.equal(ontology.key, 'generic');
  assert.equal(ontology.requiredKpis.length > 0, true);
  assert.equal(coverage.isGenericFallback, true);
  assert.equal(coverage.readinessTier, 'signal_triage');
  assert.equal(coverage.investmentCriticalGapCount > 0, true);
  assert.equal(tasks.some((task) => task.collectionKind === 'ontology_required_kpi'), true);
});

test('generic fallback ontology credits report backfill pack evidence without treating it as direct commentary', () => {
  const coverage = evaluateOntologyCoverage({
    subject: { subjectId: 'air-liquide', displayName: 'Air Liquide' },
    marketReactions: [{ symbol: 'AIQUY' }],
  }, {
    rows: {
      symbols: ['AIQUY'],
      transcripts: [],
      genericKpis: { observations: [] },
    },
    packEvidenceRows: {
      marketPack: [{ title: 'Air Liquide revenue margin guidance valuation evidence' }],
      industryPack: [{ title: 'Air Liquide operating driver demand supply capacity evidence' }],
      evidencePack: [{ title: 'Air Liquide independent evidence source breadth from multiple sources' }],
      transcriptPack: [{ title: 'Air Liquide management commentary candidate' }],
    },
  });

  assert.equal(coverage.isGenericFallback, true);
  assert.equal(coverage.satisfiedKpiCount, 3);
  assert.equal(coverage.requiredKpiCoverage, 0.75);
  assert.equal(coverage.investmentCriticalGapCount, 1);
  assert.equal(coverage.missingKpis.some((item) => item.kpiKey === 'direct_management_commentary'), true);
  assert.equal(coverage.issuerCommentaryCoverage, 0);
});

test('ontology pack evidence must match the specific KPI instead of the pack name alone', () => {
  const weak = evaluateOntologyCoverage({
    subject: { subjectId: 'defense-industrial', displayName: 'Defense Industrial' },
    marketReactions: [{ symbol: 'RTX' }, { symbol: 'LMT' }, { symbol: 'NOC' }, { symbol: 'GD' }],
  }, {
    rows: {
      symbols: ['RTX', 'LMT', 'NOC', 'GD'],
      transcripts: [],
      genericKpis: { observations: [] },
    },
    packEvidenceRows: {
      fundamentalPack: [{ title: 'Defense article accepted from a fundamentalPack source query' }],
    },
  });
  const strong = evaluateOntologyCoverage({
    subject: { subjectId: 'defense-industrial', displayName: 'Defense Industrial' },
    marketReactions: [{ symbol: 'RTX' }, { symbol: 'LMT' }, { symbol: 'NOC' }, { symbol: 'GD' }],
  }, {
    rows: {
      symbols: ['RTX', 'LMT', 'NOC', 'GD'],
      transcripts: [],
      genericKpis: { observations: [] },
    },
    packEvidenceRows: {
      policyPack: [{ title: 'Defense contract award procurement program award evidence' }],
    },
  });

  assert.equal(weak.missingKpis.some((item) => item.kpiKey === 'defense_book_to_bill'), true);
  assert.equal(strong.missingKpis.some((item) => item.kpiKey === 'defense_contract_awards'), false);
});

test('defense book-to-bill coverage is not cleared by bookings-only evidence', () => {
  const coverage = evaluateOntologyCoverage({
    subject: { subjectId: 'defense-industrial', displayName: 'Defense Industrial' },
    marketReactions: [{ symbol: 'NOC' }, { symbol: 'RTX' }, { symbol: 'LMT' }, { symbol: 'GD' }],
  }, {
    rows: {
      symbols: ['NOC', 'RTX', 'LMT', 'GD'],
      transcripts: [
        { symbol: 'NOC', metadata: { directManagementCommentaryEvidence: true } },
        { symbol: 'RTX', metadata: { directManagementCommentaryEvidence: true } },
        { symbol: 'LMT', metadata: { directManagementCommentaryEvidence: true } },
      ],
      genericKpis: {
        observations: [{
          kpi_key: 'defense_book_to_bill',
          source_type: 'sec_exhibit_ontology_evidence',
          unit: 'evidence_hit',
          value_num: 1,
          metadata: {
            matchedTerms: ['bookings'],
            excerpt: 'Management said robust bookings supported demand.',
          },
        }],
      },
    },
  });

  assert.equal(coverage.missingKpis.some((item) => item.kpiKey === 'defense_book_to_bill'), true);
  assert.equal(coverage.investmentCriticalGapCount > 0, true);
});

test('defense book-to-bill coverage can be satisfied by direct issuer exhibit wording', () => {
  const coverage = evaluateOntologyCoverage({
    subject: { subjectId: 'defense-industrial', displayName: 'Defense Industrial' },
    marketReactions: [{ symbol: 'NOC' }, { symbol: 'RTX' }, { symbol: 'LMT' }, { symbol: 'GD' }],
  }, {
    rows: {
      symbols: ['NOC', 'RTX', 'LMT', 'GD'],
      transcripts: [
        { symbol: 'NOC', excerpt: 'Backlog grew to a company record driven by full year book to bill of 1.10.', metadata: { directManagementCommentaryEvidence: true } },
        { symbol: 'RTX', metadata: { directManagementCommentaryEvidence: true } },
        { symbol: 'LMT', metadata: { directManagementCommentaryEvidence: true } },
      ],
      genericKpis: { observations: [] },
    },
  });

  assert.equal(coverage.missingKpis.some((item) => item.kpiKey === 'defense_book_to_bill'), false);
});

test('short ontology match patterns do not fire inside unrelated words', () => {
  const supplyChain = resolveThemeOntology({
    themeId: 'novel-supply-chain-theme',
    themeLabel: 'Novel Supply Chain Theme',
  });
  const ai = resolveThemeOntology({
    themeId: 'ai-ml',
    themeLabel: 'AI / Machine Learning',
  });

  assert.equal(supplyChain.key, 'generic');
  assert.equal(ai.key, 'data_center_infrastructure');
});

test('AI ontology credits electricity and capex provider proxies for operating KPI gates', () => {
  const coverage = evaluateOntologyCoverage({
    subject: { subjectId: 'ai-ml', displayName: 'AI / Machine Learning' },
    marketReactions: [{ symbol: 'MSFT' }, { symbol: 'AMD' }, { symbol: 'NVDA' }],
  }, {
    rows: {
      symbols: ['MSFT', 'AMD', 'NVDA'],
      transcripts: [
        { symbol: 'MSFT', metadata: { directManagementCommentaryEvidence: true } },
        { symbol: 'AMD', metadata: { directManagementCommentaryEvidence: true } },
        { symbol: 'NVDA', metadata: { directManagementCommentaryEvidence: true } },
      ],
      genericKpis: {
        observations: [
          {
            kpi_key: 'electricity_demand_proxy',
            source_type: 'eia',
            unit: 'million kilowatt hours',
            value_num: 125000,
            metadata: {
              title: 'US Commercial Sector Electricity Sales',
              excerpt: 'Official EIA electricity demand context for data center power demand.',
            },
          },
          {
            kpi_key: 'capex_intensity_proxy',
            source_type: 'sec_companyfacts_facts',
            unit: 'facts',
            value_num: 67,
            metadata: {
              title: 'AI capex intensity proxy',
              excerpt: 'SEC companyfacts capital expenditure proxy for hyperscaler capex and data center investment.',
            },
          },
          {
            kpi_key: 'accelerator_server_shipments',
            source_type: 'research_evidence',
            unit: 'evidence_hit',
            value_num: 1,
            metadata: {
              title: 'GPU shipments and accelerator orders deployment evidence',
            },
          },
        ],
      },
    },
  });

  assert.equal(coverage.ontologyKey, 'data_center_infrastructure');
  assert.equal(coverage.missingKpis.some((item) => item.kpiKey === 'data_center_power_capacity'), false);
  assert.equal(coverage.missingKpis.some((item) => item.kpiKey === 'hyperscaler_capex'), false);
  assert.equal(coverage.readinessTier, 'investment_memo_candidate');
});

test('issuer universe excludes ETF and macro symbols from transcript collection', () => {
  assert.deepEqual(
    filterIssuerSymbols(['RTX', 'LMT', 'NOC', 'GD', 'ITA', 'UUP', 'SMH', 'BDRY', 'NATO', 'EU', 'DOD', 'MW', 'LLM', 'ICLN']),
    ['RTX', 'LMT', 'NOC', 'GD'],
  );
});

test('defense anchor fit ranks procurement above noisy adjacency', () => {
  const ontology = resolveThemeOntology({ themeId: 'defense-industrial', parentTheme: 'defense' });
  const high = scoreOntologyAnchorFit({ title: 'Raytheon receives missile defense contract award' }, ontology);
  const low = scoreOntologyAnchorFit({ title: 'New UFO documents renew generic politics debate' }, ontology);
  const shipping = scoreOntologyAnchorFit({ title: 'Six types of shipping crisis and what they mean for freight procurement' }, ontology);

  assert.equal(high.label, 'high');
  assert.equal(low.label, 'low');
  assert.notEqual(shipping.label, 'high');
  assert.equal(high.score > low.score, true);
});

test('ontology coverage creates issuer-only backfill tasks for missing defense KPIs', () => {
  const bundle = {
    subject: { subjectId: 'defense-industrial', displayName: 'Defense Industrial' },
    marketReactions: [{ symbol: 'RTX' }, { symbol: 'LMT' }, { symbol: 'ITA' }, { symbol: 'UUP' }, { symbol: 'SMH' }, { symbol: 'BDRY' }],
    metadata: { themeContext: { events: [{ title: 'Defense procurement contract award' }] } },
  };
  const coverage = evaluateOntologyCoverage(bundle, {
    rows: {
      symbols: ['RTX', 'LMT', 'NOC', 'GD', 'ITA', 'UUP', 'SMH', 'BDRY'],
      transcripts: [],
      genericKpis: { observations: [] },
    },
  });
  const tasks = buildOntologyBackfillTasks(coverage, { subject: 'Defense Industrial' });
  const transcriptTask = tasks.find((task) => task.query.includes('earnings call transcript'));

  assert.equal(coverage.readinessTier, 'signal_triage');
  assert.equal(coverage.issuerUniverseSymbols.includes('ITA'), false);
  assert.equal(coverage.issuerUniverseSymbols.includes('UUP'), false);
  assert.equal(coverage.issuerUniverseSymbols.includes('SMH'), false);
  assert.equal(coverage.issuerUniverseSymbols.includes('BDRY'), false);
  assert.match(transcriptTask.query, /RTX LMT NOC GD/);
  assert.doesNotMatch(transcriptTask.query, /\bITA\b|\bUUP\b|\bSMH\b|\bBDRY\b/);
});
