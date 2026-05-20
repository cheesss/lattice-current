import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderAuditAppendixHtml, renderReportHtml, renderReportMarkdown } from './report-compiler.mjs';
import { renderReportFigureAssets } from './report-chart-renderer.mjs';
import { validateReportBundle } from './report-validator.mjs';
import {
  buildReportManifest,
  buildSourceQueryDrafts,
  hashArtifactContent,
} from './report-artifacts.mjs';

const DEFAULT_REPORT_ROOT = path.join('data', 'reports');
const REGISTRY_FILE = '_registry.jsonl';
const SOURCE_QUEUE_FILE = '_source-query-queue.jsonl';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeReportId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,180}$/.test(id)) {
    throw new Error('invalid report id');
  }
  return id;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function reportRecordFromManifest(manifest, reportDir) {
  return {
    reportId: manifest.reportId,
    bundleId: manifest.bundleId,
    reportType: manifest.reportType,
    subject: manifest.subject,
    generatedAt: manifest.generatedAt,
    validationStatus: manifest.validationStatus,
    quality: manifest.quality,
    reportDir,
    artifacts: manifest.artifacts,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderEvidenceTableCsv(bundle = {}) {
  const rows = asArray(bundle.evidence).map((item) => [
    item.evidenceId,
    item.kind,
    item.publisher,
    item.title,
    item.publishedAt,
    item.freshnessStatus,
    item.evidenceGrade,
    item.sourceQualityScore,
  ]);
  return [
    ['evidence_id', 'kind', 'publisher', 'title', 'published_at', 'freshness_status', 'evidence_grade', 'source_quality_score'],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

export function resolveReportRoot(reportRoot = DEFAULT_REPORT_ROOT) {
  return path.resolve(reportRoot);
}

export function resolveReportDir(reportId, reportRoot = DEFAULT_REPORT_ROOT) {
  return path.join(resolveReportRoot(reportRoot), sanitizeReportId(reportId));
}

export async function appendReportRegistry(manifest, reportDir, reportRoot = DEFAULT_REPORT_ROOT) {
  const root = resolveReportRoot(reportRoot);
  await mkdir(root, { recursive: true });
  const record = reportRecordFromManifest(manifest, path.resolve(reportDir));
  await appendFile(path.join(root, REGISTRY_FILE), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function listReportRegistry(reportRoot = DEFAULT_REPORT_ROOT, { limit = 50 } = {}) {
  const root = resolveReportRoot(reportRoot);
  const rows = await readJsonLines(path.join(root, REGISTRY_FILE));
  const latest = new Map();
  for (const row of rows) latest.set(row.reportId, row);

  // Backfill from artifact dirs so the registry remains recoverable if JSONL is deleted.
  if (existsSync(root)) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, entry.name, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      latest.set(manifest.reportId, reportRecordFromManifest(manifest, path.join(root, entry.name)));
    }
  }

  return [...latest.values()]
    .sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
}

export async function enqueueSourceQueryDrafts(sourceQueryDrafts = [], reportRoot = DEFAULT_REPORT_ROOT) {
  const root = resolveReportRoot(reportRoot);
  await mkdir(root, { recursive: true });
  const rows = asArray(sourceQueryDrafts).map((query) => ({
    ...query,
    queueStatus: 'pending_review',
    queuedAt: new Date().toISOString(),
    boundary: query.boundary || 'artifact-only; canonical source queue integration is intentionally deferred',
  }));
  if (rows.length) {
    await appendFile(path.join(root, SOURCE_QUEUE_FILE), rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  }
  return rows;
}

export async function listSourceQueryQueue(reportRoot = DEFAULT_REPORT_ROOT, { limit = 100 } = {}) {
  const root = resolveReportRoot(reportRoot);
  const rows = await readJsonLines(path.join(root, SOURCE_QUEUE_FILE));
  return rows
    .sort((a, b) => String(b.queuedAt || b.generatedAt || '').localeCompare(String(a.queuedAt || a.generatedAt || '')))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 100)));
}

export async function writeReportArtifactsToStore({
  bundle,
  analysis,
  reportRoot = DEFAULT_REPORT_ROOT,
  outDir = null,
} = {}) {
  if (!bundle?.reportId) throw new Error('bundle.reportId is required');
  const reportDir = outDir ? path.resolve(outDir) : resolveReportDir(bundle.reportId, reportRoot);
  await mkdir(reportDir, { recursive: true });

  const renderedBundle = await renderReportFigureAssets(bundle, reportDir);
  const sourceQueryDrafts = buildSourceQueryDrafts(renderedBundle, analysis);
  let renderedValidation = validateReportBundle(renderedBundle, { analysis, requireRenderedFigures: true });
  let html = renderReportHtml(renderedBundle, { analysis, validation: renderedValidation });
  let markdown = renderReportMarkdown(renderedBundle, { analysis, validation: renderedValidation });
  let auditAppendixHtml = renderAuditAppendixHtml(renderedBundle, { analysis, validation: renderedValidation });
  let auditAppendixJson = `${JSON.stringify({
    reportId: renderedBundle.reportId,
    bundleId: renderedBundle.bundleId,
    generatedAt: new Date().toISOString(),
    validation: renderedValidation,
    signalCards: analysis.signalCards || [],
    metricCalibration: analysis.metricCalibration || {},
    evidenceStrength: analysis.evidenceStrength || {},
    queryManifest: renderedBundle.queryManifest || {},
  }, null, 2)}\n`;
  let evidenceTableCsv = renderEvidenceTableCsv(renderedBundle);
  renderedValidation = validateReportBundle(renderedBundle, {
    analysis,
    requireRenderedFigures: true,
    renderedArtifacts: { html, markdown, auditAppendixHtml },
  });
  html = renderReportHtml(renderedBundle, { analysis, validation: renderedValidation });
  markdown = renderReportMarkdown(renderedBundle, { analysis, validation: renderedValidation });
  auditAppendixHtml = renderAuditAppendixHtml(renderedBundle, { analysis, validation: renderedValidation });
  auditAppendixJson = `${JSON.stringify({
    reportId: renderedBundle.reportId,
    bundleId: renderedBundle.bundleId,
    generatedAt: renderedValidation.generatedAt,
    validation: renderedValidation,
    signalCards: analysis.signalCards || [],
    metricCalibration: analysis.metricCalibration || {},
    evidenceStrength: analysis.evidenceStrength || {},
    queryManifest: renderedBundle.queryManifest || {},
  }, null, 2)}\n`;
  evidenceTableCsv = renderEvidenceTableCsv(renderedBundle);
  const bundleJson = `${JSON.stringify(renderedBundle, null, 2)}\n`;
  const analysisJson = `${JSON.stringify(analysis, null, 2)}\n`;
  const validationJson = `${JSON.stringify(renderedValidation, null, 2)}\n`;
  const sourceQueryDraftsJson = `${JSON.stringify(sourceQueryDrafts, null, 2)}\n`;

  const manifest = buildReportManifest({
    bundle: renderedBundle,
    analysis,
    validation: renderedValidation,
    sourceQueryDrafts,
    artifactHashes: {
      bundle: hashArtifactContent(bundleJson),
      analysis: hashArtifactContent(analysisJson),
      validation: hashArtifactContent(validationJson),
      html: hashArtifactContent(html),
      markdown: hashArtifactContent(markdown),
      auditAppendixHtml: hashArtifactContent(auditAppendixHtml),
      auditAppendixJson: hashArtifactContent(auditAppendixJson),
      evidenceTableCsv: hashArtifactContent(evidenceTableCsv),
      sourceQueryDrafts: hashArtifactContent(sourceQueryDraftsJson),
    },
  });

  await writeFile(path.join(reportDir, 'bundle.json'), bundleJson, 'utf8');
  await writeFile(path.join(reportDir, 'llm-analysis.json'), analysisJson, 'utf8');
  await writeFile(path.join(reportDir, 'validation.json'), validationJson, 'utf8');
  await writeFile(path.join(reportDir, 'source-query-drafts.json'), sourceQueryDraftsJson, 'utf8');
  await writeJson(path.join(reportDir, 'manifest.json'), manifest);
  await writeFile(path.join(reportDir, 'report.html'), html, 'utf8');
  await writeFile(path.join(reportDir, 'report.md'), markdown, 'utf8');
  await writeFile(path.join(reportDir, 'audit_appendix.html'), auditAppendixHtml, 'utf8');
  await writeFile(path.join(reportDir, 'audit_appendix.json'), auditAppendixJson, 'utf8');
  await writeFile(path.join(reportDir, 'evidence_table.csv'), evidenceTableCsv, 'utf8');

  const registryRecord = await appendReportRegistry(manifest, reportDir, reportRoot);
  const queuedSourceQueries = await enqueueSourceQueryDrafts(sourceQueryDrafts, reportRoot);
  return {
    reportDir,
    manifest,
    bundle: renderedBundle,
    validation: renderedValidation,
    sourceQueryDrafts,
    queuedSourceQueries,
    registryRecord,
  };
}

export async function readReportArtifactFromStore(reportId, artifact, reportRoot = DEFAULT_REPORT_ROOT) {
  const allowed = new Set(['bundle.json', 'llm-analysis.json', 'validation.json', 'manifest.json', 'report.html', 'report.md', 'audit_appendix.html', 'audit_appendix.json', 'evidence_table.csv', 'source-query-drafts.json']);
  if (!allowed.has(artifact)) throw new Error('unsupported report artifact');
  const filePath = path.join(resolveReportDir(reportId, reportRoot), artifact);
  if (!existsSync(filePath)) return null;
  return readFile(filePath, 'utf8');
}

export function renderReportIndexHtml(records = []) {
  const rows = asArray(records).map((record) => {
    const label = record.subject?.displayName || record.subject?.subjectId || record.reportId;
    const grade = record.quality?.grade || 'n/a';
    const score = record.quality?.score ?? 'n/a';
    return `<tr>
      <td><a href="./${record.reportId}/report.html">${escapeHtml(label)}</a></td>
      <td>${escapeHtml(record.reportType)}</td>
      <td>${escapeHtml(record.validationStatus)}</td>
      <td>${escapeHtml(grade)} / ${escapeHtml(score)}</td>
      <td>${escapeHtml(record.generatedAt || '')}</td>
    </tr>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lattice Report Registry</title>
  <style>
    body{margin:0;background:#0d0f13;color:#e7ecf3;font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,sans-serif}
    main{max-width:1100px;margin:0 auto;padding:32px}
    table{width:100%;border-collapse:collapse;background:#151922;border:1px solid #2a3140;border-radius:14px;overflow:hidden}
    th,td{padding:12px;border-bottom:1px solid #2a3140;text-align:left}
    th{color:#9aa7b7;text-transform:uppercase;font-size:11px;letter-spacing:.08em}
    a{color:#d8f99d;text-decoration:none}
    .muted{color:#9aa7b7}
  </style>
</head>
<body>
<main>
  <h1>Lattice Report Registry</h1>
  <p class="muted">Local artifact registry. No DB or canonical source writes are required.</p>
  <table>
    <thead><tr><th>Report</th><th>Type</th><th>Status</th><th>Quality</th><th>Generated</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">No reports generated yet.</td></tr>'}</tbody>
  </table>
</main>
</body>
</html>`;
}

export async function writeReportIndex(reportRoot = DEFAULT_REPORT_ROOT) {
  const root = resolveReportRoot(reportRoot);
  await mkdir(root, { recursive: true });
  const records = await listReportRegistry(root, { limit: 500 });
  const html = renderReportIndexHtml(records);
  await writeFile(path.join(root, 'index.html'), html, 'utf8');
  return { indexPath: path.join(root, 'index.html'), records };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
