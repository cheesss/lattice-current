import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessDiscoveryTopicAlignment,
  classifyArticleAgainstTaxonomy,
  getCanonicalParentTheme,
  isDiscoveryTopicKey,
  isLegacyThemeKey,
  listChildThemes,
  listTrendTrackerThemes,
  resolveThemeTaxonomy,
} from '../scripts/_shared/theme-taxonomy.mjs';

test('theme taxonomy resolves legacy theme aliases into long-horizon taxonomy keys', () => {
  const resolved = resolveThemeTaxonomy('tech');
  assert.equal(resolved.themeKey, 'technology-general');
  assert.equal(resolved.parentTheme, 'technology-general');
  assert.equal(resolved.category, 'technology');
});

test('theme taxonomy can recognize specific subthemes from article text', () => {
  const classified = classifyArticleAgainstTaxonomy({
    title: 'IBM unveils new 1000 qubit quantum processor for enterprise research',
    source: 'reuters',
    keywords: ['quantum computing', 'qubit', 'quantum processor'],
    embeddingTheme: 'tech',
    embeddingSimilarity: 0.8,
  });

  assert.equal(classified.theme, 'quantum-computing');
  assert.equal(classified.parentTheme, 'technology-general');
  assert.ok(classified.confidence >= 0.6);
});

test('trend tracker exposes a rich tracked-theme set', () => {
  const themes = listTrendTrackerThemes();
  assert.ok(themes.length >= 15);
  assert.ok(themes.some((theme) => theme.key === 'quantum-computing'));
  assert.ok(themes.some((theme) => theme.key === 'ai-ml'));
});

test('taxonomy helpers expose canonical parents and child themes', () => {
  assert.equal(getCanonicalParentTheme('tech'), 'technology-general');
  assert.equal(getCanonicalParentTheme('quantum-computing'), 'technology-general');
  assert.equal(isLegacyThemeKey('tech'), true);
  assert.equal(isDiscoveryTopicKey('dt-abc123'), true);
  assert.ok(listChildThemes('technology-general').some((theme) => theme.key === 'ai-ml'));
});

test('discovery alignment suppresses noisy topics and promotes canonical ones', () => {
  const noisy = assessDiscoveryTopicAlignment({
    topicId: 'dt-noise',
    label: 'Football cup match and league results roundup',
    keywords: ['football', 'cup match', 'league table'],
    parentTheme: 'tech',
    category: 'other',
    articleCount: 120,
    momentum: 1.4,
  });
  assert.equal(noisy.disposition, 'suppress');
  assert.ok(noisy.noiseFlags.includes('sports'));

  const canonical = assessDiscoveryTopicAlignment({
    topicId: 'dt-quantum',
    label: 'Fault tolerant quantum computing advances',
    keywords: ['quantum computing', 'qubit', 'error correction'],
    parentTheme: 'tech',
    category: 'technology',
    articleCount: 48,
    momentum: 1.8,
    sourceQualityScore: 0.88,
  });
  assert.equal(canonical.operatorVisible, true);
  assert.equal(canonical.canonicalParentTheme, 'technology-general');
  assert.equal(canonical.canonicalTheme, 'quantum-computing');
});

test('generic bucket themes require stronger evidence before they are surfaced as canonical', () => {
  const genericArticle = classifyArticleAgainstTaxonomy({
    title: 'Global technology market outlook update',
    source: 'newswire',
    keywords: ['technology', 'market', 'growth'],
    embeddingTheme: 'technology-general',
    embeddingSimilarity: 0.42,
  });

  assert.equal(genericArticle.theme, 'unknown');

  const genericDiscovery = assessDiscoveryTopicAlignment({
    topicId: 'dt-generic-tech',
    label: 'Global technology market outlook',
    keywords: ['technology', 'market', 'growth'],
    parentTheme: 'technology-general',
    category: 'technology',
    articleCount: 42,
    momentum: 1.34,
    sourceQualityScore: 0.66,
  });

  assert.equal(genericDiscovery.canonicalTheme, null);
});
