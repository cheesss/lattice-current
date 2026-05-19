import assert from 'node:assert/strict';
import test from 'node:test';

import {
  issuerUniverseForEvidenceClass,
  resolveIssuerAliases,
  resolveReportIssuerUniverse,
} from '../scripts/_shared/report-issuer-universe.mjs';

function srmArtifact(overrides = {}) {
  const { bundle: bundleOverrides = {}, ...artifactOverrides } = overrides;
  return {
    reportId: 'RPT-srm',
    bundle: {
      reportId: 'RPT-srm',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: '16776',
        subjectType: 'cross_theme_candidate',
        displayName: 'solid rocket motor capacity',
        metadata: {
          themes: ['defense-industrial', 'space'],
          discovery: {
            triggerTerms: ['solid rocket motor', 'Aerojet Rocketdyne', 'Northrop Grumman rocket motor'],
            sourceQueries: ['"solid rocket motor" production capacity Aerojet Northrop backlog'],
          },
        },
      },
      ...bundleOverrides,
    },
    ...artifactOverrides,
  };
}

test('report issuer universe resolves SRM ontology suppliers without hardcoding the subject', () => {
  const resolved = resolveReportIssuerUniverse(srmArtifact());

  assert.deepEqual(resolved.issuerUniverse.sort(), ['LHX', 'NOC']);
  assert.equal(resolved.sources.LHX.some((source) => source.source === 'ontology-supplier'), true);
  assert.equal(resolved.sources.NOC.some((source) => source.source === 'ontology-supplier'), true);
  assert.equal(resolved.issuerUniverse.includes('LMT'), false);
});

test('report issuer universe merges ontology suppliers with actual report pack exposure', () => {
  const resolved = resolveReportIssuerUniverse(srmArtifact({
    bundle: {
      claims: [{
        metadata: {
          deepResearch: {
            packs: {
              fundamentalPack: {
                fundamentals: [{ symbol: 'LMT' }, { symbol: 'RKLB' }, { symbol: 'ITA' }],
              },
              noisyContextPack: {
                issuerUniverse: ['SLB', 'MSFT'],
              },
            },
          },
        },
      }],
    },
  }));

  assert.deepEqual(resolved.issuerUniverse.sort(), ['LHX', 'LMT', 'NOC', 'RKLB']);
  assert.equal(resolved.excludedSymbols.includes('ITA'), true);
  assert.equal(resolved.issuerUniverse.includes('SLB'), false);
  assert.equal(resolved.issuerUniverse.includes('MSFT'), false);
});

test('legacy issuer aliases map acquired symbols into current issuer universe', () => {
  const alias = resolveIssuerAliases('AJRD Aerojet Rocketdyne solid rocket motor backlog');

  assert.deepEqual(alias.symbols, ['LHX']);
  assert.equal(alias.legacyMappings.some((mapping) => mapping.alias === 'AJRD' && mapping.symbol === 'LHX'), true);
});

test('issuer-specific evidence class blocks execution when issuer universe is empty', () => {
  const status = issuerUniverseForEvidenceClass('issuer_exposure', {
    bundle: {
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: 'unknown',
        subjectType: 'cross_theme_candidate',
        displayName: 'unknown bottleneck',
        metadata: { themes: ['technology-general'] },
      },
    },
  });

  assert.equal(status.blocked, true);
  assert.equal(status.blockedReason, 'blocked_missing_issuer_universe');
});

test('issuer-specific evidence class can collect against candidate universe without promotion universe', () => {
  const status = issuerUniverseForEvidenceClass('issuer_exposure', {
    issuerUniverse: [],
    candidateIssuerUniverse: ['MSFT', 'SMH', 'VRT'],
    version: 'report-issuer-universe-v1',
  });

  assert.equal(status.blocked, false);
  assert.deepEqual(status.issuerUniverse, []);
  assert.deepEqual(status.candidateIssuerUniverse.sort(), ['MSFT', 'VRT']);
  assert.deepEqual(status.collectionUniverse.sort(), ['MSFT', 'VRT']);
});

test('market validation waits for direct issuer bridge instead of candidate-only universe', () => {
  const status = issuerUniverseForEvidenceClass('market_validation', {
    issuerUniverse: [],
    candidateIssuerUniverse: ['MSFT', 'VRT'],
    version: 'report-issuer-universe-v1',
  });

  assert.equal(status.blocked, true);
  assert.deepEqual(status.collectionUniverse, []);
  assert.deepEqual(status.candidateIssuerUniverse.sort(), ['MSFT', 'VRT']);
});

test('strict endogenous issuer universe ignores stale broad metadata and uses current discovery pack rows', () => {
  const resolved = resolveReportIssuerUniverse({
    bundle: {
      reportId: 'RPT-strict-clean-energy',
      reportType: 'cross_theme_bottleneck_report',
      issuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM', 'ENPH'],
      metadata: {
        issuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM', 'ENPH'],
        candidateIssuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM', 'ENPH'],
        issuerDiscoveryMap: [{ symbol: 'AMZN', status: 'candidate' }],
        adjacentCandidate: {
          metadata: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            candidateIssuerUniverse: ['NVDA'],
            domains: ['semiconductor', 'clean_energy', 'industrial_materials'],
          },
        },
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [
                { symbol: 'PWR', issuerName: 'Quanta Services', role: 'service_or_epc', status: 'candidate' },
                { symbol: 'ETN', issuerName: 'Eaton', role: 'equipment_supplier', status: 'candidate' },
              ],
            },
          },
        },
      },
      claims: [{
        metadata: {
          deepResearch: {
            packs: {
              issuerDiscoveryPack: {
                rows: [{ symbol: 'NVDA', status: 'issuer_exposure_attached', promotionEligible: true }],
              },
            },
          },
        },
      }],
      evidence: [{
        metadata: {
          deepResearch: {
            reportClosureLedger: {
              items: [{
                metadata: {
                  issuerResolution: {
                    issuerDiscoveryMap: [{ symbol: 'GOOGL', status: 'issuer_exposure_attached' }],
                  },
                },
              }],
            },
          },
        },
      }],
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: 'endogenous-adjacent-clean-energy-generated-approved-supplier-qualification-lead-time',
        displayName: 'approved-supplier qualification lead time',
        metadata: {
          themes: ['clean-energy'],
          discovery: { discoveryNamespace: 'strict_endogenous_adjacent' },
        },
      },
    },
  });

  assert.deepEqual(resolved.issuerUniverse, []);
  assert.deepEqual(resolved.candidateIssuerUniverse.sort(), ['ETN', 'PWR']);
  assert.deepEqual(resolved.collectionUniverse.sort(), ['ETN', 'PWR']);
  assert.equal(resolved.strictEndogenous, true);
  assert.equal(resolved.candidateIssuerUniverse.includes('AMZN'), false);
  assert.equal(resolved.candidateIssuerUniverse.includes('ASML'), false);
  assert.equal(resolved.candidateIssuerUniverse.includes('TSM'), false);
  assert.equal(resolved.candidateIssuerUniverse.includes('NVDA'), false);
  assert.equal(resolved.candidateIssuerUniverse.includes('GOOGL'), false);
});

test('strict endogenous issuer universe keeps only direct bridge rows in promotion universe', () => {
  const resolved = resolveReportIssuerUniverse({
    bundle: {
      reportId: 'RPT-strict-direct',
      reportType: 'cross_theme_bottleneck_report',
      metadata: {
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [
                { symbol: 'PWR', issuerName: 'Quanta Services', status: 'issuer_exposure_attached', promotionEligible: true },
                { symbol: 'ETN', issuerName: 'Eaton', status: 'candidate' },
              ],
            },
          },
        },
      },
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: 'strict-node',
        displayName: 'strict node',
        metadata: {
          themes: ['clean-energy'],
          discovery: { discoveryNamespace: 'strict_endogenous_adjacent' },
        },
      },
    },
  });

  assert.deepEqual(resolved.issuerUniverse, ['PWR']);
  assert.deepEqual(resolved.candidateIssuerUniverse.sort(), ['ETN', 'PWR']);
  assert.deepEqual(resolved.collectionUniverse.sort(), ['ETN', 'PWR']);
  assert.deepEqual(resolved.promotionEligibleSymbols, ['PWR']);
});

test('frontier parent issuer universe ignores broad pack symbols until direct node bridge attaches', () => {
  const resolved = resolveReportIssuerUniverse({
    bundle: {
      reportId: 'RPT-frontier-parent',
      reportType: 'cross_theme_bottleneck_report',
      issuerUniverse: ['CVX', 'LNG', 'PWR', 'ETN'],
      metadata: {
        issuerUniverse: ['CVX', 'LNG', 'PWR', 'ETN'],
        candidate: {
          evidence_summary: {
            frontierParentCollectionEligible: true,
            frontierParentReportReady: false,
            frontierParentState: 'graph_overlap_only',
          },
        },
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [
                { symbol: 'ETN', issuerName: 'Eaton', status: 'direct_node_exposure_attached', promotionEligible: true },
                { symbol: 'PWR', issuerName: 'Quanta Services', status: 'candidate' },
              ],
            },
          },
        },
      },
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: 'high-voltage-switchgear',
        displayName: 'high-voltage switchgear',
        metadata: {
          themes: ['climate-change', 'cloud-infrastructure'],
          discovery: {},
        },
      },
    },
  });

  assert.equal(resolved.frontierParentScoped, true);
  assert.deepEqual(resolved.issuerUniverse, ['ETN']);
  assert.deepEqual(resolved.candidateIssuerUniverse, ['ETN']);
  assert.deepEqual(resolved.collectionUniverse, ['ETN']);
  assert.equal(resolved.collectionUniverse.includes('PWR'), false);
  assert.equal(resolved.collectionUniverse.includes('CVX'), false);
  assert.equal(resolved.collectionUniverse.includes('LNG'), false);
});

test('frontier parent issuer universe does not replay provider route collection universe as issuer evidence', () => {
  const resolved = resolveReportIssuerUniverse({
    bundle: {
      reportId: 'RPT-frontier-parent-route-noise',
      reportType: 'cross_theme_bottleneck_report',
      metadata: {
        candidate: {
          evidence_summary: {
            frontierParentCollectionEligible: true,
            frontierParentReportReady: true,
          },
        },
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [{
                title: 'DOE data-center electricity demand grid enablers',
                desiredEvidenceClass: 'power_constraint',
                evidenceUse: 'promotion_candidate',
                metadata: {
                  providerRoutePlan: {
                    collectionUniverse: ['AMD', 'AMZN', 'ARKX', 'ETN', 'PWR', 'THAAD'],
                  },
                },
                sourceTypes: ['public_planning_source'],
                status: 'candidate',
              }],
            },
          },
        },
      },
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: 'substation-equipment-lead-time',
        displayName: 'substation equipment lead time',
        metadata: {
          themes: ['clean-energy'],
          discovery: {},
        },
      },
    },
  });

  assert.deepEqual(resolved.issuerUniverse, []);
  assert.deepEqual(resolved.candidateIssuerUniverse, []);
  assert.deepEqual(resolved.collectionUniverse, []);
});

test('frontier parent issuer universe detects subject-level generated frontier metadata', () => {
  const resolved = resolveReportIssuerUniverse({
    bundle: {
      reportId: 'RPT-frontier-subject-metadata',
      reportType: 'cross_theme_bottleneck_report',
      metadata: {
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [
                { symbol: 'ETN', status: 'candidate', sourceTypes: ['public_planning_source'] },
                {
                  symbol: 'PWR',
                  status: 'issuer_exposure_attached',
                  promotionEligible: true,
                  desiredEvidenceClass: 'issuer_exposure',
                  evidenceUse: 'promotion_candidate',
                  metadata: { directNodeExposure: true },
                },
              ],
            },
          },
        },
      },
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: 'endogenous-frontier-parent-56299-substation-equipment-lead-time',
        displayName: 'substation equipment lead time',
        metadata: {
          themes: ['clean-energy'],
          discovery: {
            frontierDiscovery: true,
            generatedLane: true,
            adjacentCandidateKey: 'endogenous-frontier-parent-56299-substation-equipment-lead-time',
          },
        },
      },
    },
  });

  assert.equal(resolved.frontierParentScoped, true);
  assert.deepEqual(resolved.issuerUniverse, ['PWR']);
  assert.deepEqual(resolved.candidateIssuerUniverse, ['PWR']);
  assert.equal(resolved.collectionUniverse.includes('ETN'), false);
});

test('frontier parent issuer universe reuses top-level frontier issuer map as collection universe', () => {
  const resolved = resolveReportIssuerUniverse({
    bundle: {
      reportId: 'RPT-frontier-top-level-map',
      reportType: 'cross_theme_bottleneck_report',
      metadata: {
        issuerDiscoveryMap: [
          {
            symbol: 'ETN',
            issuerName: 'Eaton',
            role: 'equipment_supplier',
            status: 'frontier_node_candidate',
            sourceTypes: ['evidence_row'],
            whyRelated: 'equipment supplier frontier-node collection candidate from ETN 8-K exhibit earnings-release commentary',
          },
          {
            symbol: 'PWR',
            issuerName: 'Quanta Services',
            role: 'service_or_epc',
            status: 'frontier_node_candidate',
            sourceTypes: ['evidence_row'],
            whyRelated: 'service or epc frontier-node collection candidate from PWR 10-Q direct management commentary',
          },
          {
            symbol: 'AMZN',
            issuerName: 'Amazon',
            role: 'demand_owner',
            status: 'candidate',
            sourceTypes: ['stale_metadata'],
          },
        ],
      },
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: 'endogenous-frontier-parent-28681-substation-equipment-lead-time',
        displayName: 'substation equipment lead time',
        metadata: {
          themes: ['clean-energy'],
          discovery: {
            frontierDiscovery: true,
            generatedLane: true,
          },
        },
      },
    },
  });

  assert.equal(resolved.frontierParentScoped, true);
  assert.deepEqual(resolved.issuerUniverse, []);
  assert.deepEqual(resolved.candidateIssuerUniverse.sort(), ['ETN', 'PWR']);
  assert.deepEqual(resolved.collectionUniverse.sort(), ['ETN', 'PWR']);
  assert.equal(resolved.collectionUniverse.includes('AMZN'), false);
});
