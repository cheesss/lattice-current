import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTopicArticleProfile,
  buildTopicRecentArticleScore,
} from '../scripts/event-dashboard-api.mjs';

test('topic article profile promotes specific topic anchors over generic conflict terms', () => {
  const profile = buildTopicArticleProfile({
    label: 'Military drone warfare in the Russia-Ukraine conflict',
    description: 'This cluster centers on drone warfare, counter-UAS systems, electronic warfare, and battlefield drone doctrine in Ukraine.',
    keywords: ['killed', 'attack', 'russian', 'drone', 'ukraine'],
    key_technologies: ['FPV drones', 'counter-UAS systems', 'electronic warfare'],
    key_companies: ['AeroVironment', 'Anduril'],
    parent_theme: 'geopolitics',
  });

  assert.equal(profile.strong.includes('drone'), true);
  assert.equal(profile.strong.includes('electronic warfare'), true);
  assert.equal(profile.strong.includes('counter-uas systems'), true);
  assert.equal(profile.geoContext.includes('ukraine'), true);
  assert.equal(profile.geoContext.includes('russian'), true);
  assert.equal(profile.focusTerms.includes('drone'), true);
  assert.equal(profile.support.includes('killed'), false);
  assert.equal(profile.support.includes('attack'), false);
});

test('topic article scoring favors specific recent drone-war evidence over generic conflict headlines', () => {
  const profile = buildTopicArticleProfile({
    label: 'Military drone warfare in the Russia-Ukraine conflict',
    description: 'This cluster centers on drone warfare, counter-UAS systems, electronic warfare, and battlefield drone doctrine in Ukraine.',
    keywords: ['killed', 'attack', 'russian', 'drone', 'ukraine'],
    key_technologies: ['FPV drones', 'counter-UAS systems', 'electronic warfare'],
    key_companies: [],
    parent_theme: 'geopolitics',
  });

  const topicId = 'dt-4536ea1f6989';
  const specific = buildTopicRecentArticleScore({
    title: 'British drones help Ukraine destroy Russian-held bridge in historic operation',
    summary: '',
    source: 'The Independent',
    theme: 'unknown',
    legacy_theme: 'dt-6d56626de748',
    published_at: new Date().toISOString(),
  }, topicId, 'geopolitics', profile);

  const generic = buildTopicRecentArticleScore({
    title: 'As U.S. Threatens Maduro, a Caribbean Nation Is Drawn Into the Conflict',
    summary: '',
    source: 'nyt',
    theme: 'geopolitics',
    legacy_theme: '',
    published_at: new Date().toISOString(),
  }, topicId, 'geopolitics', profile);

  assert.equal(specific.focusHitCount > 0, true);
  assert.equal(specific.geoHitCount > 0, true);
  assert.equal(generic.geoHitCount, 0);
  assert.equal(specific.score > generic.score, true);
});
