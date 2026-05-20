import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveConcreteBottleneckNodes,
} from '../scripts/_shared/bottleneck-node-decomposer.mjs';

test('decomposer surfaces semiconductor fab capacity for wafer/EUV cues', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'leading-edge wafer fab capacity shortage',
    context: {
      parentSubject: 'foundry advanced packaging interposer supply',
      themes: ['semiconductors', 'compute'],
      corpus: 'EUV lithography capacity utilization is tight; advanced packaging substrate lead time has lengthened.',
    },
    limit: 8,
  });
  assert.ok(nodes.some((node) => node.key === 'semiconductor_fab_capacity'), `nodes=${nodes.map((n) => n.key).join(',')}`);
});

test('decomposer surfaces biotech GMP manufacturing capacity for fill-finish cues', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'biologics drug substance fill finish CDMO capacity',
    context: {
      parentSubject: 'GMP biologics manufacturing constraint',
      themes: ['health-life-science', 'biotech'],
      corpus: 'Fill-finish slot waitlist at CDMO sites has stretched after FDA inspection delays.',
    },
    limit: 8,
  });
  assert.ok(nodes.some((node) => node.key === 'biotech_manufacturing_capacity'));
});

test('decomposer surfaces clinical trial site capacity for trial enrollment cues', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'clinical trial site patient enrollment cap',
    context: {
      parentSubject: 'oncology trial enrollment backlog',
      themes: ['biotech'],
      corpus: 'Principal investigator availability and CRO bandwidth slow patient recruiting.',
    },
    limit: 8,
  });
  assert.ok(nodes.some((node) => node.key === 'clinical_trial_site_capacity'));
});

test('decomposer surfaces incident response capacity for DFIR cues', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'cyber incident response retainer demand',
    context: {
      parentSubject: 'DFIR breach response analyst supply',
      themes: ['cyber-security'],
      corpus: 'SOC analyst shortage extends response-time for forensics retainers; threat hunting backlog grows.',
    },
    limit: 8,
  });
  assert.ok(nodes.some((node) => node.key === 'incident_response_capacity'));
});

test('decomposer surfaces munitions production capacity for solid rocket motor cues', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'solid rocket motor and interceptor production capacity',
    context: {
      parentSubject: 'PAC-3 and GMLRS munitions production',
      themes: ['defense-industrial'],
      corpus: 'Artillery shell and missile production backlog limit munitions throughput; propellant supply constrained.',
    },
    limit: 8,
  });
  assert.ok(nodes.some((node) => node.key === 'munitions_production_capacity'));
});

test('decomposer does NOT trigger munitions archetype on broad defense keyword alone', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'defense budget growth and contractor strategy',
    context: {
      parentSubject: 'defense industrial growth',
      themes: ['defense-industrial'],
      corpus: 'The defense sector continues to expand, with rising spending and contractor consolidation.',
    },
    limit: 8,
  });
  assert.ok(!nodes.some((node) => node.key === 'munitions_production_capacity'));
});

test('decomposer does NOT trigger biotech archetype on the word "biotech" without manufacturing cues', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'biotech sector growth and oncology pipeline',
    context: {
      parentSubject: 'biotech investment outlook',
      themes: ['biotech'],
      corpus: 'Biotech valuations and clinical pipeline trends.',
    },
    limit: 8,
  });
  assert.ok(!nodes.some((node) => node.key === 'biotech_manufacturing_capacity'));
});

test('decomposer does NOT trigger cyber incident response archetype on the bare word "cyber"', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'cyber security adoption across the enterprise',
    context: {
      parentSubject: 'cyber security demand growth',
      themes: ['cyber-security'],
      corpus: 'Enterprise cyber budgets continue to grow.',
    },
    limit: 8,
  });
  assert.ok(!nodes.some((node) => node.key === 'incident_response_capacity'));
});

test('decomposer assigns expected node types to the new archetypes', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'wafer fab capacity and GMP fill finish and clinical trial site and DFIR retainer and solid rocket motor production',
    context: {
      parentSubject: 'cross-domain capacity probe',
      themes: ['semiconductors', 'biotech', 'cyber-security', 'defense-industrial'],
      corpus: 'EUV lithography, GMP biologics, principal investigator, threat hunting, missile production.',
    },
    limit: 16,
  });
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  assert.equal(byKey.get('semiconductor_fab_capacity')?.nodeType, 'physical_equipment');
  assert.equal(byKey.get('biotech_manufacturing_capacity')?.nodeType, 'regulated_production_process');
  assert.equal(byKey.get('clinical_trial_site_capacity')?.nodeType, 'clinical_process');
  assert.equal(byKey.get('incident_response_capacity')?.nodeType, 'specialist_service');
  assert.equal(byKey.get('munitions_production_capacity')?.nodeType, 'physical_equipment');
});
