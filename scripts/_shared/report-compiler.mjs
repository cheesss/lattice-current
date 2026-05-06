import { validateReportBundle } from './report-validator.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatList(items, renderer) {
  if (!Array.isArray(items) || !items.length) return '<p class="muted">No items available.</p>';
  return `<ul>${items.map((item) => `<li>${renderer(item)}</li>`).join('')}</ul>`;
}

function refsBlock(item = {}) {
  const refs = [
    ...asArray(item.claimIds).map((id) => `claim:${id}`),
    ...asArray(item.evidenceIds).map((id) => `evidence:${id}`),
    ...asArray(item.metricIds).map((id) => `metric:${id}`),
    ...asArray(item.figureIds).map((id) => `figure:${id}`),
    ...asArray(item.caveatIds).map((id) => `caveat:${id}`),
  ];
  return refs.length ? `<div class="refs">${refs.map((ref) => `<code>${escapeHtml(ref)}</code>`).join(' ')}</div>` : '';
}

function mdRefs(item = {}) {
  const refs = [
    ...asArray(item.claimIds).map((id) => `claim:${id}`),
    ...asArray(item.evidenceIds).map((id) => `evidence:${id}`),
    ...asArray(item.metricIds).map((id) => `metric:${id}`),
    ...asArray(item.figureIds).map((id) => `figure:${id}`),
    ...asArray(item.caveatIds).map((id) => `caveat:${id}`),
  ];
  return refs.length ? ` (${refs.join(', ')})` : '';
}

function renderAnalysisSection(items = []) {
  return formatList(items, (item) => `${escapeHtml(item.text || item.label || item.summary || item.rationale || '')}${refsBlock(item)}`);
}

function renderMetricList(metrics = []) {
  return formatList(metrics, (metric) => `<strong>${escapeHtml(metric.name)}</strong>: ${escapeHtml(metric.value)} ${escapeHtml(metric.unit || '')} <span class="muted">(${escapeHtml(metric.metricId)})</span>`);
}

function renderQualityRibbon(validation = {}) {
  const quality = validation.quality || {};
  const metrics = quality.metrics || {};
  return `
    <section class="quality">
      <div><span>status</span><strong>${escapeHtml(validation.status || 'unknown')}</strong></div>
      <div><span>grade</span><strong>${escapeHtml(quality.grade || 'n/a')}</strong></div>
      <div><span>score</span><strong>${quality.score ?? 'n/a'}</strong></div>
      <div><span>evidence</span><strong>${Math.round((metrics.evidenceCoverage ?? 0) * 100)}%</strong></div>
      <div><span>freshness</span><strong>${Math.round((metrics.freshnessDisclosure ?? 0) * 100)}%</strong></div>
      <div><span>charts</span><strong>${Math.round((metrics.chartRelevance ?? 0) * 100)}%</strong></div>
    </section>
  `;
}

function renderFigures(figures = []) {
  if (!figures.length) return '<p class="muted">No figures planned.</p>';
  return figures.map((figure) => `
    <article class="figure-card">
      <div class="figure-head">
        <strong>${escapeHtml(figure.title)}</strong>
        <code>${escapeHtml(figure.figureId)}</code>
      </div>
      ${figure.renderAssetId
        ? `<img class="figure-img" src="${escapeHtml(figure.renderAssetId)}" alt="${escapeHtml(figure.title)}">`
        : `<div class="figure-placeholder">${escapeHtml(figure.chartType)}</div>`}
      <p>${escapeHtml(figure.analyticQuestion)}</p>
      <p class="muted">Data as of ${escapeHtml(figure.dataAsOf || 'unknown')} &middot; supports ${asArray(figure.supportedClaimIds).map(escapeHtml).join(', ') || 'none'}</p>
    </article>
  `).join('');
}

export function renderReportHtml(bundle = {}, options = {}) {
  const analysis = options.analysis || {};
  const validation = options.validation || validateReportBundle(bundle, { analysis });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(bundle.subject?.displayName || bundle.reportId)} - Lattice Report</title>
  <style>
    :root{color-scheme:dark;--bg:#0d0f13;--panel:#151922;--line:#2a3140;--text:#e7ecf3;--muted:#9aa7b7;--accent:#d8f99d;--warn:#fbbf24;--bad:#fb7185}
    body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:32px}
    header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:20px}
    h1{margin:0 0 8px;font-size:30px;line-height:1.1}
    h2{margin:28px 0 10px;font-size:18px}
    h3{margin:18px 0 8px;font-size:15px}
    .muted{color:var(--muted)}
    .meta,.refs{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:12px}
    code{background:#0a0c10;border:1px solid var(--line);border-radius:6px;padding:2px 6px;color:var(--accent);font-size:12px}
    section,.card,.figure-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin:12px 0}
    .quality{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;background:#10141b}
    .quality div{border:1px solid var(--line);border-radius:10px;padding:10px}
    .quality span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
    .quality strong{font-size:17px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .figure-head{display:flex;justify-content:space-between;gap:12px;align-items:center}
    .figure-placeholder{height:130px;border:1px dashed var(--line);border-radius:10px;display:grid;place-items:center;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin:10px 0;background:#0f1218}
    .figure-img{width:100%;height:auto;border:1px solid var(--line);border-radius:10px;margin:10px 0;background:#0f1218}
    .blocker{border-color:rgba(251,113,133,.5)}
    .warning{border-color:rgba(251,191,36,.5)}
    @media(max-width:820px){main{padding:18px}.quality,.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main>
  <header>
    <div class="meta">
      <code>${escapeHtml(bundle.reportType)}</code>
      <span>${escapeHtml(bundle.reportId)}</span>
      <span>as of ${escapeHtml(bundle.asOf)}</span>
    </div>
    <h1>${escapeHtml(bundle.subject?.displayName || bundle.subject?.subjectId || 'Intelligence Report')}</h1>
    <p class="muted">${escapeHtml(bundle.reportTypeLabel || 'Lattice intelligence report')} &middot; evidence-first generated artifact</p>
  </header>
  ${renderQualityRibbon(validation)}
  ${analysis.codexNarrativeHead ? `<section class="codex-narrative">
    <h2>Analyst Narrative <span class="muted" style="font-size:.7em">Codex synthesis, evidence-pinned</span></h2>
    ${renderAnalysisSection(analysis.codexNarrativeHead)}
  </section>` : ''}
  <section>
    <h2>Executive Brief</h2>
    ${formatList(analysis.keyJudgments || bundle.claims || [], (item) => `${escapeHtml(item.text || item.generatedText || item.canonicalText)}${refsBlock(item)}`)}
  </section>
  <section>
    <h2>Working Thesis</h2>
    ${renderAnalysisSection(analysis.thesis || [])}
  </section>
  ${analysis.codexBullThesis || analysis.codexBearThesis || analysis.codexInvalidator ? `<section class="codex-bullbear">
    <h2>Bull / Bear Synthesis <span class="muted" style="font-size:.7em">Codex</span></h2>
    ${analysis.codexBullThesis ? `<h3>Bull thesis</h3>${renderAnalysisSection(analysis.codexBullThesis)}` : ''}
    ${analysis.codexBearThesis ? `<h3>Bear thesis</h3>${renderAnalysisSection(analysis.codexBearThesis)}` : ''}
    ${analysis.codexInvalidator ? `<h3>What would change my mind</h3>${renderAnalysisSection(analysis.codexInvalidator)}` : ''}
  </section>` : ''}
  <section>
    <h2>Analytical Assessment</h2>
    ${renderAnalysisSection(analysis.analyticalAssessment || [])}
  </section>
  <section>
    <h2>What Changed</h2>
    ${renderAnalysisSection(analysis.whatChanged || [])}
    <h3>Metric Ledger</h3>
    ${renderMetricList(bundle.metrics || [])}
  </section>
  <section>
    <h2>Catalysts and Drivers</h2>
    ${renderAnalysisSection(analysis.catalysts || [])}
  </section>
  <section>
    <h2>Evidence Synthesis</h2>
    ${renderAnalysisSection(analysis.evidenceSynthesis || [])}
  </section>
  <section>
    <h2>Timeline and Sequence</h2>
    ${renderAnalysisSection(analysis.timeline || [])}
  </section>
  <section>
    <h2>Evidence Base</h2>
    ${formatList(bundle.evidence || [], (item) => `<strong>${escapeHtml(item.title)}</strong> <span class="muted">${escapeHtml(item.publisher || '')} &middot; ${escapeHtml(item.freshnessStatus || 'unknown')} &middot; ${escapeHtml(item.evidenceGrade || 'ungraded')}</span> <code>${escapeHtml(item.evidenceId)}</code>`)}
  </section>
  <section>
    <h2>Market and Transmission</h2>
    ${renderAnalysisSection(analysis.marketTransmission || [])}
  </section>
  <section>
    <h2>Scenario Matrix</h2>
    ${formatList(analysis.scenarios || [], (item) => `<strong>${escapeHtml(item.label || 'Scenario')}</strong>: ${escapeHtml(item.text || '')}${refsBlock(item)}`)}
  </section>
  <section>
    <h2>Figures</h2>
    <div class="grid">${renderFigures(bundle.figures || [])}</div>
  </section>
  <section>
    <h2>Alternative Explanations</h2>
    ${formatList(analysis.alternativeExplanations || [], (item) => `${escapeHtml(item.text)}${refsBlock(item)}`)}
  </section>
  <section>
    <h2>Risks and Counterpoints</h2>
    ${renderAnalysisSection(analysis.risks || [])}
  </section>
  <section>
    <h2>Caveats and Information Gaps</h2>
    ${renderAnalysisSection(analysis.informationGaps || [])}
    <h3>Caveat Ledger</h3>
    ${formatList(bundle.caveats || [], (item) => `<strong>${escapeHtml(item.severity)}</strong> &middot; ${escapeHtml(item.text)} <code>${escapeHtml(item.caveatId)}</code>`)}
  </section>
  <section>
    <h2>Watch Next</h2>
    ${renderAnalysisSection(analysis.watchNext?.length ? analysis.watchNext : [])}
    <h3>Watch Ledger</h3>
    ${formatList(bundle.watchIndicators || [], (item) => `${escapeHtml(item.label || item.text)} <span class="muted">${escapeHtml(item.source || '')} ${escapeHtml(item.horizon || '')}</span>`)}
  </section>
  <section>
    <h2>Decision Use</h2>
    ${renderAnalysisSection(analysis.decisionUse || [])}
  </section>
  <section>
    <h2>Analyst Conclusion</h2>
    ${renderAnalysisSection(analysis.analystConclusion || [])}
  </section>
  <section>
    <h2>Source Query Drafts</h2>
    ${formatList(analysis.sourceQueries || [], (item) => `${escapeHtml(item.text)}${refsBlock(item)}<p class="muted">Artifact-only draft. Live source queue integration is deferred.</p>`)}
  </section>
  <section class="${validation.blockers?.length ? 'blocker' : validation.warnings?.length ? 'warning' : ''}">
    <h2>Validation</h2>
    <p>Status: <strong>${escapeHtml(validation.status || 'unknown')}</strong></p>
    ${validation.blockers?.length ? `<h3>Blockers</h3>${formatList(validation.blockers, (item) => `${escapeHtml(item.type)}: ${escapeHtml(item.message)}`)}` : ''}
    ${validation.warnings?.length ? `<h3>Warnings</h3>${formatList(validation.warnings, (item) => `${escapeHtml(item.type)}: ${escapeHtml(item.message)}`)}` : ''}
  </section>
  <section>
    <h2>Appendix: Query Manifest</h2>
    <pre>${escapeHtml(JSON.stringify(bundle.queryManifest || {}, null, 2))}</pre>
  </section>
</main>
</body>
</html>`;
}

export function renderReportMarkdown(bundle = {}, options = {}) {
  const analysis = options.analysis || {};
  const validation = options.validation || validateReportBundle(bundle, { analysis });
  const lines = [];
  lines.push(`# ${bundle.subject?.displayName || bundle.subject?.subjectId || 'Intelligence Report'}`);
  lines.push('');
  lines.push(`- Report: ${bundle.reportId}`);
  lines.push(`- Type: ${bundle.reportType}`);
  lines.push(`- As of: ${bundle.asOf}`);
  lines.push(`- Validation: ${validation.status}`);
  lines.push(`- Quality: ${validation.quality?.grade || 'n/a'} (${validation.quality?.score ?? 'n/a'})`);
  lines.push('');
  if ((analysis.codexNarrativeHead || []).length) {
    lines.push('## Analyst Narrative');
    for (const item of analysis.codexNarrativeHead) lines.push(`${item.text}${mdRefs(item)}`);
    lines.push('');
  }
  lines.push('## Executive Brief');
  for (const item of (analysis.keyJudgments || bundle.claims || [])) {
    lines.push(`- ${item.text || item.generatedText || item.canonicalText}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Working Thesis');
  for (const item of (analysis.thesis || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  if ((analysis.codexBullThesis || []).length || (analysis.codexBearThesis || []).length || (analysis.codexInvalidator || []).length) {
    lines.push('## Bull / Bear Synthesis');
    if ((analysis.codexBullThesis || []).length) {
      lines.push('### Bull thesis');
      for (const item of analysis.codexBullThesis) lines.push(`${item.text}${mdRefs(item)}`);
    }
    if ((analysis.codexBearThesis || []).length) {
      lines.push('### Bear thesis');
      for (const item of analysis.codexBearThesis) lines.push(`${item.text}${mdRefs(item)}`);
    }
    if ((analysis.codexInvalidator || []).length) {
      lines.push('### What would change my mind');
      for (const item of analysis.codexInvalidator) lines.push(`${item.text}${mdRefs(item)}`);
    }
    lines.push('');
  }
  lines.push('## Analytical Assessment');
  for (const item of (analysis.analyticalAssessment || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## What Changed');
  for (const item of (analysis.whatChanged || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('### Metric Ledger');
  for (const metric of (bundle.metrics || [])) {
    lines.push(`- [${metric.metricId}] ${metric.name}: ${metric.value} ${metric.unit || ''}`);
  }
  lines.push('');
  lines.push('## Catalysts and Drivers');
  for (const item of (analysis.catalysts || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Evidence Synthesis');
  for (const item of (analysis.evidenceSynthesis || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Timeline and Sequence');
  for (const item of (analysis.timeline || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Evidence Base');
  for (const item of (bundle.evidence || [])) {
    lines.push(`- [${item.evidenceId}] ${item.title} (${item.publisher || 'unknown'}, ${item.freshnessStatus || 'unknown'})`);
  }
  lines.push('');
  lines.push('## Market and Transmission');
  for (const item of (analysis.marketTransmission || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Scenario Matrix');
  for (const item of (analysis.scenarios || [])) {
    lines.push(`- ${item.label || 'Scenario'}: ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Figures');
  for (const figure of (bundle.figures || [])) {
    lines.push(`- [${figure.figureId}] ${figure.title}: ${figure.analyticQuestion}`);
  }
  lines.push('');
  lines.push('## Caveats');
  for (const item of (analysis.informationGaps || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('### Caveat Ledger');
  for (const caveat of (bundle.caveats || [])) {
    lines.push(`- [${caveat.caveatId}] ${caveat.text}`);
  }
  lines.push('');
  lines.push('## Risks and Counterpoints');
  for (const item of (analysis.risks || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Watch Next');
  for (const item of (analysis.watchNext || [])) {
    lines.push(`- ${item.text || item.label}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('### Watch Ledger');
  for (const item of (bundle.watchIndicators || [])) {
    lines.push(`- [${item.watchId}] ${item.label}${item.source ? ` (${item.source})` : ''}`);
  }
  lines.push('');
  lines.push('## Decision Use');
  for (const item of (analysis.decisionUse || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Analyst Conclusion');
  for (const item of (analysis.analystConclusion || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  lines.push('');
  lines.push('## Source Query Drafts');
  for (const item of (analysis.sourceQueries || [])) {
    lines.push(`- ${item.text}${mdRefs(item)}`);
  }
  return `${lines.join('\n')}\n`;
}
