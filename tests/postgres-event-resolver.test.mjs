import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCanonicalEventClusters } from '../src/services/importer/event-resolver.ts';

function makeNewsItem(overrides = {}) {
  return {
    source: overrides.source || 'Guardian',
    title: overrides.title || 'Untitled',
    link: overrides.link || 'https://example.com/story',
    pubDate: overrides.pubDate || new Date('2025-03-25T12:00:00.000Z'),
    isAlert: overrides.isAlert || false,
    tier: overrides.tier ?? 2,
    lat: overrides.lat,
    lon: overrides.lon,
    locationName: overrides.locationName,
    lang: overrides.lang || 'en',
  };
}

function makeRecord(overrides = {}) {
  return {
    id: overrides.id || `raw:${Math.random()}`,
    datasetId: overrides.datasetId || 'postgres-test',
    provider: overrides.provider || 'guardian',
    sourceKind: overrides.sourceKind || 'api',
    sourceId: overrides.sourceId || overrides.provider || 'guardian',
    itemKind: overrides.itemKind || 'news',
    validTimeStart: overrides.validTimeStart || '2025-03-25T12:00:00.000Z',
    validTimeEnd: overrides.validTimeEnd ?? null,
    transactionTime: overrides.transactionTime || overrides.validTimeStart || '2025-03-25T12:00:00.000Z',
    knowledgeBoundary: overrides.knowledgeBoundary || overrides.transactionTime || overrides.validTimeStart || '2025-03-25T12:00:00.000Z',
    headline: overrides.headline || overrides.title || 'Untitled',
    link: overrides.link || 'https://example.com/story',
    symbol: overrides.symbol ?? null,
    region: overrides.region ?? null,
    price: overrides.price ?? null,
    payload: overrides.payload || {},
    metadata: overrides.metadata || {},
  };
}

describe('canonical postgres event resolver', () => {
  it('clusters related cross-source articles and uses aggregate support as alert prior', () => {
    const guardian = makeNewsItem({
      source: 'The Guardian',
      title: 'Iran-linked missile strike in Red Sea raises new shipping risks',
      link: 'https://www.theguardian.com/world/2025/mar/25/red-sea-missile-strike',
    });
    const nyt = makeNewsItem({
      source: 'New York Times',
      title: 'Shipping risks rise after Red Sea missile strike tied to Iran-backed forces',
      link: 'https://www.nytimes.com/2025/03/25/world/middleeast/red-sea-strike.html',
    });
    const aggregate = makeNewsItem({
      source: 'GDELT Aggregate',
      title: 'GDELT: 551 conflict/tension events across 57 countries (goldstein=-7.28, tone=-4.07)',
      link: 'https://gdelt.example/conflict',
    });

    const clusters = buildCanonicalEventClusters(
      [guardian, nyt, aggregate],
      [
        makeRecord({
          id: 'guardian-1',
          provider: 'guardian',
          title: guardian.title,
          link: guardian.link,
          payload: { source: 'guardian', theme: 'conflict', summary: 'Iran-linked missile strike disrupts Red Sea shipping lanes.' },
          metadata: { sourceName: 'The Guardian' },
        }),
        makeRecord({
          id: 'nyt-1',
          provider: 'nyt',
          title: nyt.title,
          link: nyt.link,
          payload: { source: 'nyt', theme: 'politics', summary: 'Red Sea shipping faces new pressure after Iran-backed missile strike.' },
          metadata: { sourceName: 'New York Times' },
        }),
        makeRecord({
          id: 'gdelt-agg-1',
          provider: 'gdelt-agg',
          title: aggregate.title,
          link: aggregate.link,
          payload: { eventCount: 551, totalSources: 588, countries: 'IR,YE,EG', avgGoldstein: -7.28, avgTone: -4.07 },
          metadata: { sourceName: 'GDELT Aggregate' },
        }),
      ],
    );

    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].sourceCount, 2);
    assert.equal(clusters[0].isAlert, true);
    assert.ok((clusters[0].relations?.confidenceScore || 0) >= 60);
    assert.match((clusters[0].relations?.evidence || []).join(' '), /aggregateSupport=/);
  });

  it('keeps unrelated same-day articles in separate event clusters', () => {
    const sports = makeNewsItem({
      source: 'The Guardian',
      title: 'Manchester United stumble again after late equaliser at Wolves',
      link: 'https://www.theguardian.com/football/2025/dec/30/manchester-united-wolves',
    });
    const economy = makeNewsItem({
      source: 'The Guardian',
      title: 'Eurozone inflation cools as energy prices continue to ease',
      link: 'https://www.theguardian.com/business/2025/dec/30/eurozone-inflation-energy',
    });

    const clusters = buildCanonicalEventClusters(
      [sports, economy],
      [
        makeRecord({
          id: 'sports-1',
          provider: 'guardian',
          title: sports.title,
          link: sports.link,
          payload: { source: 'guardian', theme: 'sports', summary: 'Wolves drew with Manchester United after a late equaliser.' },
          metadata: { sourceName: 'The Guardian' },
        }),
        makeRecord({
          id: 'economy-1',
          provider: 'guardian',
          title: economy.title,
          link: economy.link,
          payload: { source: 'guardian', theme: 'economy', summary: 'Energy prices eased again as eurozone inflation slowed.' },
          metadata: { sourceName: 'The Guardian' },
        }),
      ],
    );

    assert.equal(clusters.length, 2);
    assert.deepEqual(
      new Set(clusters.map((cluster) => cluster.primaryTitle)),
      new Set([sports.title, economy.title]),
    );
  });
});
