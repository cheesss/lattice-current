import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIssuerDiscoveryMap,
  candidateIssuerUniverseFromMap,
  groupIssuerDiscoveryMap,
  issuerDiscoverySummary,
} from '../scripts/_shared/report-issuer-discovery-map.mjs';

function adjacentAiGridBundle(overrides = {}) {
  return {
    reportId: 'RPT-grid',
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'endogenous-grid-interconnection',
      displayName: 'grid interconnection queue',
      metadata: {
        connector: 'AI / Machine Learning',
        themes: [],
        discovery: {
          triggerTerms: ['grid interconnection', 'power availability', 'interconnection wait times'],
          generatedLane: true,
        },
      },
    },
    issuerUniverse: ['AMD', 'MSFT'],
    metadata: {
      candidateIssuerUniverse: ['AMD', 'MSFT'],
      adjacentCandidate: {
        metadata: {
          domains: ['ai_data_center', 'clean_energy'],
          issuerUniverseSourceSymbols: ['AMD', 'MSFT'],
        },
        source_terms: ['grid interconnection', 'data center power availability'],
      },
    },
    evidence: [],
    ...overrides,
  };
}

test('issuer discovery map creates candidate groups from no-seed adjacent context and ontology', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: adjacentAiGridBundle(),
    ontologyCoverage: {
      ontologyKey: 'data_center_infrastructure',
      ontologyLabel: 'Data Center Infrastructure',
      matchedArchetypes: ['data_center_infrastructure'],
    },
  });

  const symbols = rows.map((row) => row.symbol);
  assert.ok(symbols.includes('AMD'), 'existing adjacent candidate symbols should remain collection candidates');
  assert.ok(symbols.includes('MSFT'), 'existing adjacent candidate symbols should remain collection candidates');
  assert.ok(symbols.includes('ETN'), 'data-center infrastructure ontology supplier should be discovered');
  assert.ok(symbols.includes('VRT'), 'data-center infrastructure ontology supplier should be discovered');
  assert.ok(symbols.includes('PWR'), 'data-center infrastructure ontology supplier should be discovered');
  assert.equal(rows.find((row) => row.symbol === 'ETN')?.promotionEligible, false);
  assert.equal(rows.find((row) => row.symbol === 'VRT')?.status, 'candidate');
  assert.match(rows.find((row) => row.symbol === 'ETN')?.whyRelated || '', /candidate/i);
});

test('issuer discovery map keeps candidates out of promotion until direct evidence attaches', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: adjacentAiGridBundle(),
    rows: {
      research: [{
        id: 1,
        symbol: 'MSFT',
        title: 'Microsoft data center interconnection commentary',
        metadata: {
          desiredEvidenceClass: 'issuer_exposure',
          evidenceUse: 'promotion_candidate',
        },
      }],
    },
    ontologyCoverage: { ontologyKey: 'data_center_infrastructure' },
  });

  assert.equal(rows.find((row) => row.symbol === 'MSFT')?.status, 'issuer_exposure_attached');
  assert.equal(rows.find((row) => row.symbol === 'AMD')?.promotionEligible, false);
  assert.equal(rows.find((row) => row.symbol === 'AMD')?.candidateOnly, true);
});

test('strict endogenous issuer discovery does not reuse stale broad candidate metadata', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: adjacentAiGridBundle({
      issuerUniverse: [],
      metadata: {
        candidateIssuerUniverse: ['AMZN', 'AMD'],
        adjacentCandidate: {
          metadata: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            candidateIssuerUniverse: ['AVGO'],
            issuerUniverseSourceSymbols: ['ASML'],
          },
        },
        issuerDiscoveryMap: [{ symbol: 'META', status: 'candidate' }],
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [{ symbol: 'ZZZZ', status: 'candidate' }],
            },
          },
        },
      },
    }),
    ontologyCoverage: { ontologyKey: 'generic' },
  });

  const symbols = rows.map((row) => row.symbol);
  for (const symbol of ['AMZN', 'AMD', 'AVGO', 'ASML', 'META', 'ZZZZ']) {
    assert.equal(symbols.includes(symbol), false, `${symbol} should not leak from stale metadata`);
  }
});

test('strict endogenous issuer discovery only uses parent-theme ontology hints', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        displayName: 'approved-supplier qualification lead time',
        metadata: {
          themes: ['clean-energy'],
          discovery: { discoveryNamespace: 'strict_endogenous_adjacent' },
        },
      },
      metadata: {
        adjacentCandidate: {
          metadata: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            themes: ['clean-energy'],
            domains: ['semiconductor', 'clean_energy', 'industrial_materials'],
          },
        },
      },
    },
    ontologyCoverage: {
      ontologyKey: 'semiconductors',
      ontologyLabel: 'Semiconductors',
      matchedArchetypes: ['semiconductors'],
    },
  });

  const symbols = rows.map((row) => row.symbol);
  assert.equal(symbols.includes('ASML'), false, 'strict clean-energy run should not borrow semiconductor ontology issuers');
  assert.equal(symbols.includes('TSM'), false, 'strict clean-energy run should not borrow semiconductor ontology issuers');
});

test('issuer discovery map marks repeated non-direct evidence as probable exposure without promotion', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: adjacentAiGridBundle({ issuerUniverse: [] }),
    rows: {
      research: [{
        id: 12,
        symbol: 'VRT',
        title: 'Vertiv data center power equipment supplier exposure',
        metadata: {
          desiredEvidenceClass: 'issuer_exposure',
          evidenceUse: 'supporting_context',
          providerRoutePlan: {
            evidenceClass: 'issuer_exposure',
            collectionUniverse: ['VRT'],
          },
        },
      }],
    },
    ontologyCoverage: { ontologyKey: 'data_center_infrastructure' },
  });

  const vrt = rows.find((row) => row.symbol === 'VRT');
  assert.equal(vrt?.status, 'probable_exposure');
  assert.equal(vrt?.promotionEligible, false);
  assert.equal(vrt?.candidateOnly, true);
  const summary = issuerDiscoverySummary(rows);
  assert.equal(summary.probableExposureCount >= 1, true);
  assert.equal(summary.bridgeAttachedCount, 0);
});

test('strict endogenous issuer discovery suppresses dynamic consensus symbols without hardcoded issuers', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        displayName: 'substation protection relay qualification lead time',
        metadata: { discovery: { discoveryNamespace: 'strict_endogenous_adjacent' } },
      },
      metadata: {
        adjacentCandidate: {
          metadata: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            frontierDiscovery: true,
            consensusProfile: {
              frequentSymbols: [{ symbol: 'ACME', count: 4 }],
            },
          },
        },
      },
    },
    candidateIssuerUniverse: ['ACME', 'FRO'],
  });

  assert.equal(rows.find((row) => row.symbol === 'ACME')?.status, 'suppressed_consensus_issuer');
  assert.equal(rows.find((row) => row.symbol === 'FRO')?.status, 'candidate');
  const summary = issuerDiscoverySummary(rows);
  assert.equal(summary.suppressedConsensusCount, 1);
  assert.equal(summary.bridgeAttachedCount, 0);
});

test('strict endogenous ontology issuers are suppressed until direct node evidence attaches', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        displayName: 'interconnection study capacity',
        metadata: {
          themes: ['ai-ml'],
          discovery: { discoveryNamespace: 'strict_endogenous_adjacent' },
        },
      },
      metadata: {
        adjacentCandidate: {
          metadata: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            frontierDiscovery: true,
            themes: ['ai-ml'],
          },
          source_terms: ['interconnection study capacity', 'data center power availability'],
        },
      },
    },
    ontologyCoverage: {
      ontologyKey: 'data_center_infrastructure',
      ontologyLabel: 'Data Center Infrastructure',
      matchedArchetypes: ['data_center_infrastructure'],
    },
  });

  const ontologyRows = rows.filter((row) => row.sourceTypes.includes('theme_ontology'));
  assert.equal(ontologyRows.length > 0, true);
  assert.equal(ontologyRows.every((row) => row.status === 'suppressed_consensus_issuer'), true);
  const summary = issuerDiscoverySummary(rows);
  assert.equal(summary.suppressedConsensusCount, ontologyRows.length);
  assert.equal(summary.bridgeAttachedCount, 0);
});

test('direct frontier-node evidence restores a suppressed issuer as a bridge candidate', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        displayName: 'substation protection relay qualification lead time',
        metadata: { discovery: { discoveryNamespace: 'strict_endogenous_adjacent' } },
      },
      metadata: {
        adjacentCandidate: {
          metadata: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            frontierDiscovery: true,
            consensusProfile: {
              frequentSymbols: [{ symbol: 'ACME', count: 4 }],
            },
          },
        },
      },
    },
    candidateIssuerUniverse: ['ACME'],
    rows: {
      research: [{
        symbol: 'ACME',
        title: 'ACME direct node exposure to relay qualification lead time',
        metadata: {
          desiredEvidenceClass: 'supplier_capacity',
          evidenceUse: 'promotion_candidate',
          directNodeExposure: true,
          frontierNode: 'substation protection relay qualification lead time',
        },
      }],
    },
  });

  const acme = rows.find((row) => row.symbol === 'ACME');
  assert.equal(acme?.status, 'direct_node_exposure_attached');
  assert.equal(acme?.promotionEligible, true);
  assert.equal(acme?.candidateOnly, false);
  const summary = issuerDiscoverySummary(rows);
  assert.equal(summary.bridgeAttachedCount, 1);
  assert.equal(summary.directNodeBridgeCount, 1);
});

test('frontier parent issuer discovery keeps node-family SEC evidence as collection candidates only', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: 'endogenous-frontier-parent-1-substation-equipment-lead-time',
        displayName: 'substation equipment lead time',
        metadata: {
          discovery: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            concreteBottleneckNodes: [{
              node: 'substation equipment lead time',
              nodeType: 'physical_equipment',
              acceptanceCriteria: [
                'equipment lead-time or backlog evidence',
                'supplier capacity or allocation evidence',
              ],
            }],
          },
        },
      },
      metadata: {
        candidate: {
          evidence_summary: {
            frontierParentCollectionEligible: true,
          },
        },
      },
    },
    rows: {
      transcripts: [{
        symbol: 'PWR',
        title: 'PWR 10-K direct management commentary',
        source_type: 'sec_direct_management_commentary',
        excerpt: 'Quanta is well positioned to provide turnkey infrastructure solutions for large data center facilities, including low-voltage electrical infrastructure solutions inside data centers.',
        metadata: { provider: 'sec-edgar', filingType: '10-K' },
      }, {
        symbol: 'AMD',
        title: 'AMD 8-K direct management commentary',
        source_type: 'sec_direct_management_commentary',
        excerpt: 'AMD expects demand for Instinct GPU products and AI accelerator deployments to remain strong.',
        metadata: { provider: 'sec-edgar', filingType: '8-K' },
      }],
    },
  });

  const pwr = rows.find((row) => row.symbol === 'PWR');
  assert.equal(pwr?.status, 'frontier_node_candidate');
  assert.equal(pwr?.promotionEligible, false);
  assert.equal(pwr?.candidateOnly, true);
  assert.equal(rows.some((row) => row.symbol === 'AMD'), false, 'generic AI issuer evidence should not leak into a substation frontier node');
  const summary = issuerDiscoverySummary(rows);
  assert.equal(summary.frontierNodeCandidateCount, 1);
  assert.equal(summary.bridgeAttachedCount, 0);
});

test('frontier parent issuer discovery rejects node mentions in unrelated executive biographies', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: 'endogenous-frontier-parent-3-substation-equipment-lead-time',
        displayName: 'substation equipment lead time',
        metadata: {
          discovery: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            concreteBottleneckNodes: [{ node: 'substation equipment lead time', nodeType: 'physical_equipment' }],
          },
        },
      },
      metadata: {
        candidate: {
          evidence_summary: { frontierParentCollectionEligible: true },
        },
      },
    },
    rows: {
      transcripts: [{
        symbol: 'ORCL',
        speaker: 'ORACLE CORPORATION',
        title: 'ORCL 8-K exhibit earnings-release commentary',
        source_type: 'sec_earnings_release_exhibit',
        excerpt: 'Oracle appointed a new CFO. Before joining Oracle, the executive worked at another company that was an electrical equipment supplier and modernized the grid.',
        metadata: { provider: 'sec-edgar', filingType: '8-K' },
      }],
    },
  });

  assert.equal(rows.some((row) => row.symbol === 'ORCL'), false);
});

test('frontier parent exact node promotion requires direct node evidence before bridge attachment', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: 'endogenous-frontier-parent-2-substation-equipment-lead-time',
        displayName: 'substation equipment lead time',
      },
      metadata: {
        candidate: {
          evidence_summary: { frontierParentCollectionEligible: true },
        },
      },
    },
    rows: {
      research: [{
        symbol: 'ETN',
        title: 'ETN substation equipment backlog direct exposure',
        source_type: 'sec_direct_management_commentary',
        excerpt: 'Eaton reported substation equipment backlog and longer lead times for utility and data center customers.',
        metadata: {
          provider: 'sec-edgar',
          filingType: '10-Q',
          desiredEvidenceClass: 'issuer_exposure',
          evidenceUse: 'promotion_candidate',
        },
      }],
    },
  });

  const etn = rows.find((row) => row.symbol === 'ETN');
  assert.equal(etn?.status, 'issuer_exposure_attached');
  assert.equal(etn?.promotionEligible, true);
  assert.equal(etn?.candidateOnly, false);
});

test('issuer discovery summary and grouping expose bridge gaps without fabricating issuers', () => {
  const empty = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: { displayName: 'generic research lead', metadata: { themes: ['technology-general'] } },
      evidence: [{ title: 'Generic research article without issuer fields' }],
    },
  });
  assert.deepEqual(empty, []);

  const rows = buildIssuerDiscoveryMap({
    bundle: adjacentAiGridBundle(),
    ontologyCoverage: { ontologyKey: 'data_center_infrastructure' },
  });
  const groups = groupIssuerDiscoveryMap(rows);
  const summary = issuerDiscoverySummary(rows);
  assert.equal(candidateIssuerUniverseFromMap(rows).includes('MSFT'), true);
  assert.equal(groups.some((group) => group.role === 'equipment_supplier'), true);
  assert.equal(summary.bridgeAttachedCount, 0);
  assert.equal(summary.issuerMappingGapCount > 0, true);
});

test('issuer discovery map filters generic technical acronyms from provider metadata', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: adjacentAiGridBundle({ issuerUniverse: [] }),
    rows: {
      research: [{
        title: 'GPU ASIC EPS MD article',
        metadata: {
          providerRoutePlan: {
            evidenceClass: 'issuer_exposure',
            collectionUniverse: ['GPU', 'ASIC', 'EPS', 'MD', 'VRT'],
          },
        },
      }],
    },
    ontologyCoverage: { ontologyKey: 'data_center_infrastructure' },
  });

  const symbols = rows.map((row) => row.symbol);
  assert.equal(symbols.includes('VRT'), true);
  assert.equal(symbols.includes('GPU'), false);
  assert.equal(symbols.includes('ASIC'), false);
  assert.equal(symbols.includes('EPS'), false);
  assert.equal(symbols.includes('MD'), false);
});

test('market validation rows do not promote the whole provider collection universe as issuer exposure', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: { displayName: 'high-voltage switchgear', metadata: { themes: ['technology-general'] } },
      metadata: {
        candidate: {
          evidence_summary: {
            frontierParentCollectionEligible: true,
          },
        },
      },
    },
    rows: {
      research: [{
        symbol: 'CVX',
        title: 'CVX 2w controlled market validation',
        metadata: {
          desiredEvidenceClass: 'market_validation',
          evidenceUse: 'promotion_candidate',
          providerRoutePlan: {
            evidenceClass: 'market_validation',
            collectionUniverse: ['CVX', 'AMZN', 'ETN', 'PWR'],
          },
        },
      }],
    },
  });

  assert.equal(rows.some((row) => row.symbol === 'CVX' && row.status === 'market_attached'), true);
  assert.equal(rows.some((row) => row.symbol === 'AMZN'), false);
  assert.equal(rows.some((row) => row.symbol === 'ETN'), false);
  assert.equal(rows.some((row) => row.status === 'issuer_exposure_attached'), false);
});

test('issuer discovery map preserves roles from existing report pack rows', () => {
  const rows = buildIssuerDiscoveryMap({
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: { displayName: 'grid interconnection queue', metadata: { connector: 'AI / Machine Learning' } },
      metadata: {
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [{
                symbol: 'PWR',
                issuerName: 'Quanta Services',
                role: 'service_or_epc',
                status: 'candidate',
              }],
            },
          },
        },
      },
    },
    ontologyCoverage: { ontologyKey: 'data_center_infrastructure' },
  });

  assert.equal(rows.find((row) => row.symbol === 'PWR')?.role, 'service_or_epc');
});
