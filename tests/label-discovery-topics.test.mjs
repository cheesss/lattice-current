import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDiscoveryTopicPayload, parseArgs } from '../scripts/label-discovery-topics.mjs';

test('label-discovery-topics parseArgs applies defaults and overrides', () => {
  assert.deepEqual(parseArgs([]), { limit: 5, topicId: '' });
  assert.deepEqual(parseArgs(['--limit', '12', '--topic-id', 'dt-abc']), { limit: 12, topicId: 'dt-abc' });
});

test('label-discovery-topics normalizes arrays and bounded scores', () => {
  const payload = normalizeDiscoveryTopicPayload({
    topic_name: 'Silicon Photonics',
    category: 'Semiconductor',
    stage: 'Research',
    description: 'Optical interconnects are moving into practical deployment.',
    key_companies: ['A', '', 'B'],
    key_technologies: ['photonics', 'co-packaged optics'],
    investment_relevance: 1.7,
    novelty: -2,
    uncertainty: 0.3,
  });
  assert.equal(payload.topicName, 'Silicon Photonics');
  assert.equal(payload.category, 'semiconductor');
  assert.equal(payload.stage, 'research');
  assert.deepEqual(payload.keyCompanies, ['A', 'B']);
  assert.equal(payload.investmentRelevance, 1);
  assert.equal(payload.novelty, 0);
  assert.equal(payload.uncertainty, 0.3);
});
