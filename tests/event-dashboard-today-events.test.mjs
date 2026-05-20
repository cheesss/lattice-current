import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferArticleDashboardTheme,
  normalizeDashboardThemeKey,
  sanitizeArticleDisplaySource,
  shouldRenderTodayEvent,
} from '../scripts/event-dashboard-api.mjs';

test('today event theme sanitizer hides opaque and non-taxonomy labels', () => {
  assert.equal(normalizeDashboardThemeKey('dt-e5ae963eeace'), null);
  assert.equal(normalizeDashboardThemeKey('russian'), null);
  assert.equal(normalizeDashboardThemeKey('league'), null);
  assert.equal(normalizeDashboardThemeKey('tech'), 'technology-general');
  assert.equal(normalizeDashboardThemeKey('cybersecurity'), 'cybersecurity');
});

test('today event theme inference prefers canonical article fields over opaque auto themes', () => {
  assert.equal(inferArticleDashboardTheme({
    raw_theme: 'dt-251a3cdc9b2b',
    theme: 'conflict',
    legacy_theme: 'politics',
    title: 'Google News: government',
    source: 'Google News',
  }), 'conflict');

  assert.equal(inferArticleDashboardTheme({
    raw_theme: 'russian',
    theme: 'unknown',
    legacy_theme: '',
    title: 'Ransomware attack disrupts critical infrastructure provider',
    source: 'Reuters',
  }), 'cybersecurity');
});

test('today events only render taxonomy-backed items', () => {
  assert.equal(shouldRenderTodayEvent({
    title: 'Brighton vs. Chelsea: Premier League Match Highlights',
    theme: null,
  }), false);
  assert.equal(shouldRenderTodayEvent({
    title: 'Ransomware group exploits ActiveMQ flaw',
    theme: 'cybersecurity',
  }), true);
});

test('today event display source removes Google News keyword buckets', () => {
  assert.equal(
    sanitizeArticleDisplaySource('Google News: league', 'Match Highlights - CBS Sports'),
    'CBS Sports',
  );
  assert.equal(
    sanitizeArticleDisplaySource('Google News: climate', 'Hegseth dismisses climate change as military braces anyway - Honolulu Star-Advertiser'),
    'Honolulu Star-Advertiser',
  );
  assert.equal(
    sanitizeArticleDisplaySource('Google News: risk', 'War-risk insurance reprices shipping corridors'),
    'Google News',
  );
  assert.equal(
    sanitizeArticleDisplaySource('BBC Business source', 'China exports take on the world'),
    'BBC Business',
  );
  assert.equal(
    sanitizeArticleDisplaySource('Air &amp; Space Forces Magazine source', 'Air Force Budget Plan Seeks to Boost Munitions'),
    'Air & Space Forces Magazine',
  );
  assert.equal(
    sanitizeArticleDisplaySource('Google News: tech', 'SusHi Tech Tokyo isn&#8217;t a conference - TechCrunch'),
    'TechCrunch',
  );
  assert.equal(
    sanitizeArticleDisplaySource('BleepingComputer', 'Ransomware attack disrupts hospitals'),
    'BleepingComputer',
  );
});
