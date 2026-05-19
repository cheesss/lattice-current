import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildSampleReportBundle, REPORT_TYPES } from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { renderReportFigureAssets } from '../scripts/_shared/report-chart-renderer.mjs';

test('chart renderer writes SVG assets and attaches relative renderAssetId', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-figures-'));
  try {
    const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME));
    const rendered = await renderReportFigureAssets(bundle, tmp);
    assert.equal(rendered.figures.every((figure) => figure.renderAssetId), true);
    const svg = await readFile(path.join(tmp, rendered.figures[0].renderAssetId), 'utf8');
    assert.match(svg, /<svg/);
    assert.match(svg, /Theme-component-supplier pathway|Evidence readiness/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('chart renderer supports issuer thesis peer basket figures', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-issuer-figures-'));
  try {
    const bundle = {
      ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Defense Industrial' }),
      metadata: {
        deepResearch: {
          packs: {
            issuerThesisPack: {
              status: 'available',
              cards: [
                {
                  symbol: 'LMT',
                  role: 'missile defense and backlog-to-revenue conversion',
                  fundamentalBridge: 'revenue $71.0B; EPS $27.55',
                  operatingBridge: 'issuer operating bridge: backlog, missile demand',
                  kpiEvidence: ['backlog', 'missile demand'],
                  valuationBridge: 'consensus revenue proxy $73.5B; P/E 17.2x',
                  marketBridge: '0.80% relative return, t-stat 1.20',
                  dataFlags: {
                    hasIssuerOperatingKpi: true,
                    hasConsensus: true,
                    hasIssuerCommentary: true,
                    hasMarketReaction: true,
                  },
                },
                {
                  symbol: 'GD',
                  role: 'shipbuilding and yard-throughput execution',
                  fundamentalBridge: 'fundamental evidence is not yet deep enough',
                  operatingBridge: 'issuer operating bridge pending; theme-level KPI context includes shipyard throughput',
                  themeKpiContext: ['shipyard throughput'],
                  valuationBridge: 'recent price $292.10',
                  marketBridge: '1.61% relative return, t-stat 0.49',
                  dataFlags: {
                    hasIssuerOperatingKpi: false,
                    hasConsensus: false,
                    hasIssuerCommentary: false,
                    hasMarketReaction: true,
                  },
                },
              ],
            },
          },
        },
      },
    };
    const rendered = await renderReportFigureAssets(planReportFigures(bundle), tmp);
    const issuerFigure = rendered.figures.find((figure) => figure.figureId === 'FIG-DEEP-ISSUER-THESIS');
    assert.ok(issuerFigure?.renderAssetId, 'expected issuer thesis figure asset');
    const svg = await readFile(path.join(tmp, issuerFigure.renderAssetId), 'utf8');
    assert.match(svg, /Issuer thesis bridge/);
    assert.match(svg, /LMT/);
    assert.match(svg, /GD/);
    assert.match(svg, /backlog-to-revenue/);
    assert.match(svg, /issuer operating bridge/);
    assert.match(svg, /theme context: shipyard throughput/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
