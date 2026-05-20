import assert from 'node:assert/strict';
import test from 'node:test';

import { attachDeepResearchPack } from '../scripts/_shared/report-deep-research-pack.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import { buildCrossThemeBottleneckReportBundle, buildThemeReportBundle } from '../scripts/_shared/report-evidence-bundle.mjs';

test('deep research pack turns low samples into actionable collection tasks', async () => {
  const base = buildThemeReportBundle({
    theme: {
      key: 'ai-ml',
      label: 'AI / Machine Learning',
      sourceDiversity: 0.35,
    },
    metrics: [
      { metricId: 'MET-THEME-ARTICLES', name: 'article_count', value: 4, unit: 'articles' },
      { metricId: 'MET-THEME-RECENT-EVIDENCE', name: 'recent_evidence_items', value: 2, unit: 'items' },
    ],
    evidence: [
      { evidenceId: 'EVID-001', kind: 'news_article', publisher: 'Sample Source', title: 'AI deployment sample', freshnessStatus: 'fresh' },
    ],
  });
  const bundle = await attachDeepResearchPack({
    ...base,
    sourceSummary: {
      ...(base.sourceSummary || {}),
      sourceDiversityScore: 0.35,
      distinctSources: 1,
    },
  });

  const plan = bundle.metadata.deepResearch.collectionPlan;
  assert.equal(bundle.metadata.deepResearch.universalEvidenceContract.requiredClasses.length > 0, true);
  assert.equal(bundle.metadata.deepResearch.evidenceClassMatrix.length > 0, true);
  assert.equal(plan.some((task) => task.collectionKind === 'universal_evidence_contract'), true);
  assert.equal(plan.some((task) => task.metadata?.evidenceContract?.evidenceClass), true);
  assert.equal(plan.some((task) => task.collectionKind === 'sample_expansion'), true);
  assert.equal(plan.some((task) => task.collectionKind === 'industry_pack_expansion'), true);
  assert.equal(plan.every((task) => task.taskType === 'source_query'), true);
  assert.equal(bundle.watchIndicators.some((watch) => String(watch.watchId).startsWith('WATCH-COLLECT-')), true);

  const analysis = generateDeterministicAnalystDraft(bundle);
  assert.equal(analysis.sourceQueries.some((query) => query.metadata?.gapKind === 'investment_depth_collection'), true);
  const dataDepthText = analysis.dataDepth.map((block) => block.text).join(' ');
  assert.match(dataDepthText, /economic|research gaps|evidence/i);
  assert.doesNotMatch(dataDepthText, /queued \d+ investment-depth collection tasks|KPI spine|fundamentalPack|transcriptPack/i);
});

test('cross-theme discovery uses source-query evidence instead of article sample blockers', async () => {
  const base = buildCrossThemeBottleneckReportBundle({
    candidate: {
      id: 'ctc-solid-rocket-motor',
      connector: 'solid rocket motor capacity',
      themes: ['defense-industrial', 'space'],
      evidenceQuality: 0.72,
      sourceDiversity: 1,
      discovery: {
        role: 'constraint',
        mechanism: 'missile replenishment depends on motor production capacity and qualified energetic-material supply',
        sourceQueries: [
          '"solid rocket motor" "production capacity" missile interceptor Aerojet Northrop backlog',
        ],
      },
    },
    evidence: [
      { evidenceId: 'EVID-SRM-1', kind: 'source_query', publisher: 'Source A', title: 'Solid rocket motor capacity evidence', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-SRM-2', kind: 'source_query', publisher: 'Source B', title: 'Qualified energetic materials supplier evidence', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-SRM-3', kind: 'source_query', publisher: 'Source C', title: 'Missile production capacity evidence', freshnessStatus: 'fresh' },
    ],
  });
  const bundle = await attachDeepResearchPack({
    ...base,
    sourceSummary: {
      ...(base.sourceSummary || {}),
      distinctSources: 3,
      sourceDiversityScore: 1,
      lowDiversityFlag: false,
    },
  });

  const readiness = bundle.metadata.deepResearch.investmentReadiness;
  assert.equal(readiness.sampleAdequacy, 'cross_theme_discovery');
  assert.equal(readiness.blockers.some((blocker) => /article sample/i.test(blocker)), false);
  assert.equal(bundle.metadata.deepResearch.collectionPlan.some((task) => task.collectionKind === 'sample_expansion'), false);
});
