import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metricLookup(bundle = {}) {
  return new Map((bundle.metrics || []).map((metric) => [metric.metricId, metric]));
}

function valuesForFigure(bundle, figure) {
  const metrics = metricLookup(bundle);
  return (figure.dataRefIds || [])
    .map((id) => metrics.get(id))
    .filter(Boolean)
    .map((metric) => ({
      label: metric.name || metric.metricId,
      value: Number(metric.value || 0),
      unit: metric.unit || '',
    }));
}

function renderLollipopSvg(figure, values) {
  const width = 760;
  const rowHeight = 38;
  const height = Math.max(220, 86 + values.length * rowHeight);
  const max = Math.max(1, ...values.map((item) => Math.abs(item.value)));
  const axisX = 260;
  const maxBar = width - axisX - 120;
  const rows = values.map((item, index) => {
    const y = 74 + index * rowHeight;
    const len = Math.max(4, Math.abs(item.value) / max * maxBar);
    const color = item.value >= 0 ? '#7ee081' : '#fb7185';
    return `
      <text x="24" y="${y + 5}" fill="#cbd5e1" font-size="13">${escapeXml(item.label)}</text>
      <line x1="${axisX}" y1="${y}" x2="${axisX + len}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${axisX + len}" cy="${y}" r="6" fill="${color}"/>
      <text x="${axisX + len + 14}" y="${y + 5}" fill="#e7ecf3" font-size="13">${escapeXml(item.value)} ${escapeXml(item.unit)}</text>
    `;
  }).join('');
  return wrapSvg({ width, height, title: figure.title, body: rows, subtitle: figure.analyticQuestion });
}

function renderTimelineSvg(figure, values) {
  const width = 760;
  const height = 240;
  const points = values.length ? values : [{ label: 'evidence', value: 1 }];
  const step = (width - 120) / Math.max(1, points.length - 1);
  const body = `
    <line x1="60" y1="132" x2="${width - 60}" y2="132" stroke="#2a3140" stroke-width="2"/>
    ${points.map((item, index) => {
      const x = 60 + index * step;
      return `
        <circle cx="${x}" cy="132" r="8" fill="#d8f99d"/>
        <text x="${x}" y="160" text-anchor="middle" fill="#cbd5e1" font-size="12">${escapeXml(item.label).slice(0, 16)}</text>
        <text x="${x}" y="184" text-anchor="middle" fill="#9aa7b7" font-size="11">${escapeXml(item.value)}</text>
      `;
    }).join('')}
  `;
  return wrapSvg({ width, height, title: figure.title, body, subtitle: figure.analyticQuestion });
}

function renderNetworkSvg(figure, values) {
  const width = 760;
  const height = 300;
  const labels = values.length ? values.map((item) => item.label) : ['theme', 'connector', 'supplier'];
  const nodes = labels.slice(0, 6).map((label, index) => ({
    label,
    x: 120 + (index % 3) * 250,
    y: index < 3 ? 120 : 220,
  }));
  const edges = nodes.slice(1).map((node, index) => `
    <line x1="${nodes[index].x}" y1="${nodes[index].y}" x2="${node.x}" y2="${node.y}" stroke="#3d4658" stroke-width="2"/>
  `).join('');
  const body = `
    ${edges}
    ${nodes.map((node) => `
      <circle cx="${node.x}" cy="${node.y}" r="34" fill="#151922" stroke="#d8f99d" stroke-width="2"/>
      <text x="${node.x}" y="${node.y + 5}" text-anchor="middle" fill="#e7ecf3" font-size="12">${escapeXml(node.label).slice(0, 18)}</text>
    `).join('')}
  `;
  return wrapSvg({ width, height, title: figure.title, body, subtitle: figure.analyticQuestion });
}

function renderStatusSvg(figure, values) {
  const width = 760;
  const height = 240;
  const rows = values.length ? values : [{ label: 'status', value: 1, unit: '' }];
  const body = rows.slice(0, 8).map((item, index) => {
    const x = 44 + (index % 4) * 176;
    const y = 82 + Math.floor(index / 4) * 70;
    return `
      <rect x="${x}" y="${y}" width="150" height="48" rx="10" fill="#10141b" stroke="#2a3140"/>
      <text x="${x + 12}" y="${y + 21}" fill="#cbd5e1" font-size="12">${escapeXml(item.label).slice(0, 18)}</text>
      <text x="${x + 12}" y="${y + 39}" fill="#d8f99d" font-size="12">${escapeXml(item.value)} ${escapeXml(item.unit)}</text>
    `;
  }).join('');
  return wrapSvg({ width, height, title: figure.title, body, subtitle: figure.analyticQuestion });
}

function renderPeerBasketSvg(figure, values) {
  const cards = Array.isArray(figure.metadata?.issuerThesisPack?.cards)
    ? figure.metadata.issuerThesisPack.cards.slice(0, 6)
    : [];
  if (!cards.length) return renderLollipopSvg(figure, values);
  const width = 900;
  const rowHeight = 76;
  const height = Math.max(280, 96 + cards.length * rowHeight);
  const headers = `
    <text x="32" y="76" fill="#9aa7b7" font-size="11">Issuer</text>
    <text x="108" y="76" fill="#9aa7b7" font-size="11">Operating role</text>
    <text x="420" y="76" fill="#9aa7b7" font-size="11">Issuer operating bridge</text>
    <text x="680" y="76" fill="#9aa7b7" font-size="11">Market / valuation read</text>
  `;
  const rows = cards.map((card, index) => {
    const y = 92 + index * rowHeight;
    const flags = card.dataFlags || {};
    const hasOperatingBridge = Boolean(flags.hasIssuerOperatingKpi || flags.hasIssuerOperatingBridge);
    const issuerReady = Boolean(hasOperatingBridge && flags.hasConsensus && flags.hasIssuerCommentary && flags.hasMarketReaction);
    const partialReady = Boolean(hasOperatingBridge || flags.hasMarketReaction || flags.hasConsensus);
    const color = issuerReady ? '#7ee081' : partialReady ? '#facc15' : '#fb7185';
    const operatingBridge = card.operatingBridge || card.metadata?.operatingBridge || 'issuer operating bridge pending';
    const themeContext = (card.themeKpiContext || card.metadata?.themeKpiContext || []).slice(0, 3).join(', ');
    return `
      <rect x="24" y="${y - 22}" width="${width - 48}" height="64" rx="10" fill="#10141b" stroke="#2a3140"/>
      <text x="38" y="${y + 2}" fill="#e7ecf3" font-size="15" font-weight="700">${escapeXml(card.symbol)}</text>
      <circle cx="82" cy="${y - 3}" r="7" fill="${color}"/>
      <text x="108" y="${y - 4}" fill="#cbd5e1" font-size="12">${escapeXml(card.role || '').slice(0, 46)}</text>
      <text x="108" y="${y + 15}" fill="#9aa7b7" font-size="11">${escapeXml(card.fundamentalBridge || '').slice(0, 54)}</text>
      <text x="420" y="${y - 4}" fill="#cbd5e1" font-size="12">${escapeXml(operatingBridge).slice(0, 44)}</text>
      <text x="420" y="${y + 15}" fill="#9aa7b7" font-size="11">${escapeXml(themeContext ? `theme context: ${themeContext}` : `${card.commentaryCount || 0} commentary rows`).slice(0, 44)}</text>
      <text x="680" y="${y - 4}" fill="#cbd5e1" font-size="12">${escapeXml(card.marketBridge || '').slice(0, 34)}</text>
      <text x="680" y="${y + 15}" fill="#9aa7b7" font-size="11">${escapeXml(card.valuationBridge || '').slice(0, 34)}</text>
    `;
  }).join('');
  return wrapSvg({ width, height, title: figure.title, body: `${headers}${rows}`, subtitle: figure.analyticQuestion });
}

function wrapSvg({ width, height, title, subtitle, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#0f1218"/>
  <text x="24" y="34" fill="#e7ecf3" font-family="Segoe UI, sans-serif" font-size="18" font-weight="700">${escapeXml(title)}</text>
  <text x="24" y="56" fill="#9aa7b7" font-family="Segoe UI, sans-serif" font-size="12">${escapeXml(subtitle || '')}</text>
  <g font-family="Segoe UI, sans-serif">${body}</g>
</svg>`;
}

export function renderFigureSvg(bundle = {}, figure = {}) {
  const values = valuesForFigure(bundle, figure);
  if (figure.chartType === 'peer_basket') return renderPeerBasketSvg(figure, values);
  if (figure.chartType === 'network') return renderNetworkSvg(figure, values);
  if (figure.chartType === 'timeline') return renderTimelineSvg(figure, values);
  if (figure.chartType === 'freshness_heatmap' || figure.chartType === 'status_board') return renderStatusSvg(figure, values);
  return renderLollipopSvg(figure, values);
}

export async function renderReportFigureAssets(bundle = {}, reportDir) {
  const figureDir = path.join(reportDir, 'figures');
  await mkdir(figureDir, { recursive: true });
  const figures = [];
  for (const figure of bundle.figures || []) {
    const fileName = `${figure.figureId}.svg`;
    const relativePath = path.join('figures', fileName).replace(/\\/g, '/');
    await writeFile(path.join(figureDir, fileName), renderFigureSvg(bundle, figure), 'utf8');
    figures.push({
      ...figure,
      renderAssetId: relativePath,
      metadata: {
        ...(figure.metadata || {}),
        renderer: 'report-chart-renderer-svg-v1',
      },
    });
  }
  return {
    ...bundle,
    figures,
  };
}
