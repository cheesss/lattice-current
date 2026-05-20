import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath } from './_workspace-paths.mjs';

describe('map redesign guardrails', () => {
  it('expands the embedded map surface to 85vh in the theme shell', () => {
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    assert.equal(dashboardSource.includes('.embed-frame{display:block;width:100%;height:clamp(720px,85vh,1200px);'), true);
  });

  it('adds collapsible overlay controls, theme filters, and a time slider to the map lens shell', () => {
    const lensHtml = readFileSync(repoPath('event-map-lens.html'), 'utf8');
    assert.equal(lensHtml.includes('id="lens-collapse-toggle"'), true);
    assert.equal(lensHtml.includes('id="lens-filter-bar"'), true);
    assert.equal(lensHtml.includes('id="lens-period-slider"'), true);
    assert.equal(lensHtml.includes('id="lens-relationship-toggle"'), true);
    assert.equal(lensHtml.includes('#lens-root.overlay-collapsed .lens-overlay'), true);
  });

  it('keeps local map-lens UI state in the controller and requests overlay payloads from the dashboard API', () => {
    const lensSource = readFileSync(repoPath('src/theme-map-lens.ts'), 'utf8');
    assert.equal(lensSource.includes("const OVERLAY_COLLAPSE_KEY = 'theme-map-lens:overlay-collapsed';"), true);
    assert.equal(lensSource.includes("type LensThemeFilter = 'all' | 'conflict' | 'macro' | 'tech' | 'energy' | 'climate';"), true);
    assert.equal(lensSource.includes('fetchMapLensOverlays'), true);
    assert.equal(lensSource.includes("map.setRelationshipMode(relationshipMode);"), true);
    assert.equal(lensSource.includes("map.setSignalMarkers(signalMarkers);"), true);
    assert.equal(lensSource.includes("map.setTransmissionOverlayArcs(overlays.transmissionArcs);"), true);
  });

  it('adds zoom-aware LOD thresholds and relationship overlays to DeckGLMap', () => {
    const mapSource = readFileSync(repoPath('src/components/DeckGLMap.ts'), 'utf8');
    assert.equal(mapSource.includes("hotspots: { minZoom: 1.2, showLabels: 4.6 }"), true);
    assert.equal(mapSource.includes("tradeRoutes: { minZoom: 2.6 }"), true);
    assert.equal(mapSource.includes('private signalMarkers: SignalMarkerDatum[] = [];'), true);
    assert.equal(mapSource.includes('private transmissionOverlayArcs: TransmissionOverlayArc[] = [];'), true);
    assert.equal(mapSource.includes('private createSignalMarkerLayers(lodLevel: MapLodLevel): Layer[] {'), true);
    assert.equal(mapSource.includes('private createTransmissionOverlayLayer(lodLevel: MapLodLevel): ArcLayer<TransmissionOverlayArc> {'), true);
    assert.equal(mapSource.includes('public setRelationshipMode(enabled: boolean): void {'), true);
  });

  it('exposes a dedicated map overlay API contract for event hotspots, E2 signals, and transmission arcs', () => {
    const apiSource = readFileSync(repoPath('scripts/event-dashboard-api.mjs'), 'utf8');
    assert.equal(apiSource.includes('async function buildMapLensOverlayPayload(params) {'), true);
    assert.equal(apiSource.includes("readPersistentCachePayload('event-market-transmission:v1')"), true);
    assert.equal(apiSource.includes("if (segments[0] === 'api' && segments[1] === 'map-lens-overlays') {"), true);
    assert.equal(apiSource.includes('transmissionArcs'), true);
    assert.equal(apiSource.includes("evidence_grade = 'E2'"), true);
    assert.equal(apiSource.includes('HOT_EVENTS_MIN_PROMOTION_CONTROLS'), true);
    assert.equal(apiSource.includes('COALESCE(eu.n_controls, 0) >='), true);
    assert.equal(apiSource.includes('market_relevance'), true);
  });
});
