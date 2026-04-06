import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildEventCandidates, buildDirectMappings, buildIdeaCards } from '../src/services/investment/idea-generator.ts';
import { buildIdeaGenerationRuntimeContext } from '../src/services/investment/idea-generation/runtime-context.ts';
import { defaultSelfTuningWeightProfile } from '../src/services/experiment-registry.ts';
import { buildMacroRiskOverlay } from '../src/services/macro-risk-overlay.ts';

function makeCluster(overrides = {}) {
  const title = overrides.title || 'Taiwan chip export controls tighten after new AI shipment restrictions';
  const source = overrides.source || 'The Guardian';
  const pubDate = overrides.pubDate || '2025-08-10T08:00:00.000Z';
  return {
    id: overrides.id || 'cluster-1',
    primaryTitle: title,
    primarySource: source,
    primaryLink: overrides.primaryLink || 'https://example.com/story',
    sourceCount: overrides.sourceCount ?? 1,
    isAlert: overrides.isAlert ?? false,
    topSources: overrides.topSources || [{ name: source, tier: 2, url: 'https://example.com/story' }],
    allItems: overrides.allItems || [{
      title,
      source,
      link: 'https://example.com/story',
      pubDate,
      isAlert: overrides.isAlert ?? false,
      tier: 2,
    }],
    firstSeen: overrides.firstSeen || pubDate,
    lastUpdated: overrides.lastUpdated || pubDate,
    threat: overrides.threat || { level: 'elevated' },
    relations: overrides.relations || {
      confidenceScore: overrides.confidenceScore ?? 82,
      evidence: overrides.evidence || ['taiwan', 'chip', 'export control', 'ai infrastructure'],
    },
  };
}

describe('event admission priors', () => {
  it('keeps transmission stress separate from the fallback market stress prior', () => {
    const cluster = makeCluster({
      confidenceScore: 84,
      sourceCount: 1,
      isAlert: true,
    });

    const withoutTransmission = buildEventCandidates({
      clusters: [cluster],
      transmission: null,
      sourceCredibility: [{
        source: 'The Guardian',
        credibilityScore: 68,
        corroborationScore: 52,
        feedHealthScore: 72,
        truthAgreementScore: 64,
      }],
    }).kept[0];

    assert.ok(withoutTransmission);
    assert.equal(withoutTransmission.transmissionStress, null);
    assert.ok(withoutTransmission.marketStressPrior > 0);
    assert.equal(withoutTransmission.marketStress, withoutTransmission.marketStressPrior);
    assert.equal(withoutTransmission.clusterConfidence, 84);

    const withTransmission = buildEventCandidates({
      clusters: [cluster],
      transmission: {
        generatedAt: '2025-08-10T09:00:00.000Z',
        edges: [{
          eventTitle: cluster.primaryTitle,
          marketSymbol: 'SOXX',
          strength: 66,
          reason: 'semiconductor-beta',
        }],
        regime: null,
      },
      sourceCredibility: [{
        source: 'The Guardian',
        credibilityScore: 68,
        corroborationScore: 52,
        feedHealthScore: 72,
        truthAgreementScore: 64,
      }],
    }).kept[0];

    assert.ok(withTransmission.marketStressPrior > 0);
    assert.equal(withTransmission.transmissionStress, 0.66);
    assert.equal(withTransmission.marketStress, 0.66);
  });

  it('raises meta admission score when cluster confidence evidence improves', () => {
    const cluster = makeCluster({
      confidenceScore: 82,
      sourceCount: 1,
      isAlert: true,
    });
    const candidate = buildEventCandidates({
      clusters: [cluster],
      transmission: {
        generatedAt: '2025-08-10T09:00:00.000Z',
        edges: [{
          eventTitle: cluster.primaryTitle,
          marketSymbol: 'SOXX',
          strength: 66,
          reason: 'semiconductor-beta',
        }],
        regime: null,
      },
      sourceCredibility: [{
        source: 'The Guardian',
        credibilityScore: 68,
        corroborationScore: 52,
        feedHealthScore: 72,
        truthAgreementScore: 64,
      }],
    }).kept[0];

    const mappings = buildDirectMappings({
      candidates: [candidate],
      markets: [{ symbol: 'SOXX', change: 1.3 }],
      transmission: { generatedAt: '2025-08-10T09:00:00.000Z', edges: [], regime: null },
      timestamp: '2025-08-10T12:00:00.000Z',
      autonomy: { shadowMode: false, rollbackLevel: 'normal' },
      weightProfile: defaultSelfTuningWeightProfile(),
      macroOverlay: buildMacroRiskOverlay({ regime: null, markets: [] }),
    });

    assert.ok(mappings.length > 0);
    const baseline = mappings[0];
    const lowEvidence = {
      ...baseline,
      clusterConfidence: 34,
      marketStressPrior: 0.08,
      transmissionStress: 0,
    };
    const highEvidence = {
      ...baseline,
      clusterConfidence: 88,
      marketStressPrior: 0.42,
      transmissionStress: 0.66,
    };

    const lowCard = buildIdeaCards(
      [lowEvidence],
      [],
      buildMacroRiskOverlay({ regime: null, markets: [] }),
      null,
      buildIdeaGenerationRuntimeContext(),
    )[0];
    const highCard = buildIdeaCards(
      [highEvidence],
      [],
      buildMacroRiskOverlay({ regime: null, markets: [] }),
      null,
      buildIdeaGenerationRuntimeContext(),
    )[0];

    assert.ok(highCard);
    assert.ok(lowCard);
    assert.ok((highCard.metaHitProbability ?? 0) > (lowCard.metaHitProbability ?? 0));
    assert.ok((highCard.metaDecisionScore ?? 0) > (lowCard.metaDecisionScore ?? 0));
  });
});
