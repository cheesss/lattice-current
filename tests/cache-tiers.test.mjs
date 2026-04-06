import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_TIER_CONFIG,
  getTierConfig,
  getRedisTtl,
  getClientTtlMs,
  buildCacheControlHeader,
  buildCdnCacheControlHeader,
  extendTierTtl,
  isTtlExpired,
} from '../src/config/cache-tiers.ts';

describe('CacheTTLConfig — Unified Cache Tiers (Phase 4.1)', () => {

  it('defines all 6 tiers', () => {
    const tiers = Object.keys(CACHE_TIER_CONFIG);
    assert.deepEqual(tiers.sort(), ['daily', 'fast', 'medium', 'no-store', 'slow', 'static']);
  });

  it('fast tier has correct TTL values', () => {
    const cfg = getTierConfig('fast');
    assert.equal(cfg.cdnSeconds, 120);    // 2 min
    assert.equal(cfg.redisSeconds, 180);  // 3 min
    assert.equal(cfg.clientMs, 300_000);  // 5 min
  });

  it('medium tier has correct TTL values', () => {
    const cfg = getTierConfig('medium');
    assert.equal(cfg.cdnSeconds, 300);     // 5 min
    assert.equal(cfg.redisSeconds, 600);   // 10 min
    assert.equal(cfg.clientMs, 900_000);   // 15 min
  });

  it('slow tier has correct TTL values', () => {
    const cfg = getTierConfig('slow');
    assert.equal(cfg.cdnSeconds, 900);      // 15 min
    assert.equal(cfg.redisSeconds, 1_800);  // 30 min
    assert.equal(cfg.clientMs, 3_600_000);  // 1 hour
  });

  it('static tier has correct TTL values', () => {
    const cfg = getTierConfig('static');
    assert.equal(cfg.cdnSeconds, 3_600);      // 1 hour
    assert.equal(cfg.redisSeconds, 21_600);   // 6 hours
    assert.equal(cfg.clientMs, 86_400_000);   // 24 hours
  });

  it('daily tier has correct TTL values', () => {
    const cfg = getTierConfig('daily');
    assert.equal(cfg.cdnSeconds, 21_600);     // 6 hours
    assert.equal(cfg.redisSeconds, 86_400);   // 24 hours
    assert.equal(cfg.clientMs, 172_800_000);  // 48 hours
  });

  it('no-store tier has all zeros', () => {
    const cfg = getTierConfig('no-store');
    assert.equal(cfg.cdnSeconds, 0);
    assert.equal(cfg.redisSeconds, 0);
    assert.equal(cfg.clientMs, 0);
    assert.equal(cfg.cdnSwrSeconds, 0);
    assert.equal(cfg.cdnSieSeconds, 0);
  });

  it('TTLs increase monotonically across tiers: CDN < Redis < Client', () => {
    for (const tier of ['fast', 'medium', 'slow', 'static', 'daily']) {
      const cfg = getTierConfig(tier);
      assert.ok(cfg.cdnSeconds < cfg.redisSeconds, `${tier}: CDN < Redis`);
      assert.ok(cfg.redisSeconds * 1000 < cfg.clientMs, `${tier}: Redis < Client`);
    }
  });

  it('getRedisTtl returns correct values', () => {
    assert.equal(getRedisTtl('fast'), 180);
    assert.equal(getRedisTtl('slow'), 1_800);
    assert.equal(getRedisTtl('no-store'), 0);
  });

  it('getClientTtlMs returns correct values', () => {
    assert.equal(getClientTtlMs('fast'), 300_000);
    assert.equal(getClientTtlMs('medium'), 900_000);
  });

  it('buildCacheControlHeader produces valid header for fast tier', () => {
    const header = buildCacheControlHeader('fast');
    assert.ok(header.includes('s-maxage=120'));
    assert.ok(header.includes('stale-while-revalidate=60'));
    assert.ok(header.includes('stale-if-error=600'));
    assert.ok(header.startsWith('public'));
  });

  it('buildCacheControlHeader returns no-store for no-store tier', () => {
    assert.equal(buildCacheControlHeader('no-store'), 'no-store');
  });

  it('buildCdnCacheControlHeader returns null for no-store', () => {
    assert.equal(buildCdnCacheControlHeader('no-store'), null);
  });

  it('buildCdnCacheControlHeader returns doubled values for fast tier', () => {
    const header = buildCdnCacheControlHeader('fast');
    assert.ok(header !== null);
    // CF s-maxage should be 2× the standard (120 * 2 = 240)
    assert.ok(header.includes('s-maxage=240'));
  });

  it('extendTierTtl multiplies all values', () => {
    const extended = extendTierTtl('fast', 3);
    const base = getTierConfig('fast');
    assert.equal(extended.cdnSeconds, base.cdnSeconds * 3);
    assert.equal(extended.redisSeconds, base.redisSeconds * 3);
    assert.equal(extended.clientMs, base.clientMs * 3);
  });

  it('extendTierTtl returns unchanged config for no-store', () => {
    const extended = extendTierTtl('no-store', 5);
    assert.equal(extended.cdnSeconds, 0);
    assert.equal(extended.redisSeconds, 0);
    assert.equal(extended.clientMs, 0);
  });

  it('isTtlExpired returns true for expired timestamp', () => {
    const oneMinuteAgo = Date.now() - 60_000;
    assert.ok(isTtlExpired(oneMinuteAgo, 30_000)); // 30s TTL, 60s ago
  });

  it('isTtlExpired returns false for non-expired timestamp', () => {
    const tenSecondsAgo = Date.now() - 10_000;
    assert.ok(!isTtlExpired(tenSecondsAgo, 60_000)); // 60s TTL, 10s ago
  });

  it('isTtlExpired returns true for zero TTL', () => {
    assert.ok(isTtlExpired(Date.now(), 0));
  });
});
