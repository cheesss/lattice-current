#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { generateResearchQuestions } from './_shared/research-question-generator.mjs';
import {
  generateMechanismSeeds,
  loadOperatorSeedPrior,
} from './_shared/mechanism-seed-generator.mjs';
import {
  crossThemePriorToSeedInputs,
  loadOperatorCrossThemePrior,
} from './_shared/operator-cross-theme-prior.mjs';
import {
  ensureOperatorResearchSeedSchema,
  upsertOperatorResearchSeeds,
} from './_shared/operator-research-seeds.mjs';
import {
  buildRouteAwareSeedEvidencePlan,
  enqueueSeedEvidenceSourceQueries,
} from './_shared/seed-evidence-plan.mjs';

const DEFAULT_ARTIFACT_OUT = path.join(process.cwd(), 'data', 'runtime', 'mechanism-seed-generation.latest.json');
const DEFAULT_JSONL_OUT = path.join(process.cwd(), 'data', 'operator-seeds', 'generated-seeds.jsonl');
const DEFAULT_REPORT_ROOT = path.join(process.cwd(), 'data', 'reports');
const { Client } = pg;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function parseCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseMechanismSeedGenerationArgs(argv = process.argv.slice(2)) {
  const out = {
    dryRun: true,
    source: 'all',
    themes: [],
    excludeThemes: [],
    limit: 50,
    minScore: null,
    writeJsonl: false,
    includeRejected: false,
    planEvidence: false,
    enqueueEvidence: false,
    sourceQueryLimit: 100,
    queryLimitPerClass: 2,
    excludeOperatorPrior: false,
    excludeOntology: false,
    excludeOntologySnapshotQuestions: false,
    artifactOut: DEFAULT_ARTIFACT_OUT,
    jsonlOut: DEFAULT_JSONL_OUT,
    reportRoot: DEFAULT_REPORT_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--source') out.source = next() || out.source;
    else if (arg === '--themes') out.themes = parseCsv(next());
    else if (arg === '--exclude-themes') out.excludeThemes = parseCsv(next());
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--min-score') out.minScore = Number(next());
    else if (arg === '--write-jsonl') out.writeJsonl = true;
    else if (arg === '--include-rejected') out.includeRejected = true;
    else if (arg === '--plan-evidence') out.planEvidence = true;
    else if (arg === '--enqueue-evidence') out.enqueueEvidence = true;
    else if (arg === '--source-query-limit') out.sourceQueryLimit = Number(next() || out.sourceQueryLimit);
    else if (arg === '--query-limit-per-class') out.queryLimitPerClass = Number(next() || out.queryLimitPerClass);
    else if (arg === '--exclude-operator-prior') out.excludeOperatorPrior = true;
    else if (arg === '--exclude-ontology') out.excludeOntology = true;
    else if (arg === '--exclude-ontology-snapshot-questions') out.excludeOntologySnapshotQuestions = true;
    else if (arg === '--artifact-out') out.artifactOut = path.resolve(next() || out.artifactOut);
    else if (arg === '--jsonl-out') out.jsonlOut = path.resolve(next() || out.jsonlOut);
    else if (arg === '--report-root') out.reportRoot = path.resolve(next() || out.reportRoot);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--source=')) out.source = arg.slice('--source='.length);
    else if (arg.startsWith('--themes=')) out.themes = parseCsv(arg.slice('--themes='.length));
    else if (arg.startsWith('--exclude-themes=')) out.excludeThemes = parseCsv(arg.slice('--exclude-themes='.length));
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--min-score=')) out.minScore = Number(arg.slice('--min-score='.length));
    else if (arg.startsWith('--source-query-limit=')) out.sourceQueryLimit = Number(arg.slice('--source-query-limit='.length));
    else if (arg.startsWith('--query-limit-per-class=')) out.queryLimitPerClass = Number(arg.slice('--query-limit-per-class='.length));
    else if (arg.startsWith('--artifact-out=')) out.artifactOut = path.resolve(arg.slice('--artifact-out='.length));
    else if (arg.startsWith('--jsonl-out=')) out.jsonlOut = path.resolve(arg.slice('--jsonl-out='.length));
    else if (arg.startsWith('--report-root=')) out.reportRoot = path.resolve(arg.slice('--report-root='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-mechanism-seed-generation.mjs --dry-run --limit 50
  node --import tsx scripts/run-mechanism-seed-generation.mjs --apply --source ontology --limit 50

Default mode is dry-run. --apply persists operator seed rows and an operator
seed run ledger. --enqueue-evidence requires --apply and writes only seed-scoped
source-query approvals. It does not write report_backfill_tasks,
universal_research_subjects, canonical graph, source registry, or provider
activation state.

Options:
  --source <research-questions|adjacent|reports|ontology|cross-theme-prior|all>
  --themes <csv>
  --exclude-themes <csv>
  --limit <n>
  --min-score <number>
  --write-jsonl
  --include-rejected
  --plan-evidence
  --enqueue-evidence       Requires --apply. Queues seed-scoped source-query approvals only.
  --source-query-limit <n>
  --query-limit-per-class <n>
  --exclude-operator-prior
  --exclude-ontology
  --exclude-ontology-snapshot-questions
  --artifact-out <path>
  --jsonl-out <path>
  --report-root <path>
`;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function collectValues(value, predicate, out = [], depth = 0) {
  if (!value || depth > 7 || out.length > 500) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectValues(item, predicate, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    if (predicate(value)) out.push(value);
    for (const child of Object.values(value)) collectValues(child, predicate, out, depth + 1);
  }
  return out;
}

function looksLikeResearchQuestion(value = {}) {
  return Boolean(value.prompt && (value.questionType || value.question_type || value.seedTerms || value.themes));
}

function looksLikeAdjacentCandidate(value = {}) {
  return Boolean((value.candidateKey || value.candidate_key || value.lane) && (value.sourceTerms || value.source_terms || value.evidenceClasses || value.evidence_classes || value.queryVariants));
}

async function loadRuntimeInputs() {
  const files = [
    path.join(process.cwd(), 'data', 'runtime', 'research-os-cycle.latest.json'),
    path.join(process.cwd(), 'data', 'runtime', 'universal-research-orchestrator.latest.json'),
    path.join(process.cwd(), 'data', 'runtime', 'research-os-status.latest.json'),
  ];
  const payloads = (await Promise.all(files.map(readJsonIfExists))).filter(Boolean);
  return {
    researchQuestions: uniqueById(payloads.flatMap((payload) => collectValues(payload, looksLikeResearchQuestion)), 'id'),
    adjacentCandidates: uniqueById(payloads.flatMap((payload) => collectValues(payload, looksLikeAdjacentCandidate)), 'candidateKey'),
  };
}

function uniqueById(values = [], preferredKey = 'id') {
  const map = new Map();
  for (const value of values) {
    const key = String(value?.[preferredKey] || value?.candidate_key || value?.deterministic_id || value?.id || JSON.stringify(value).slice(0, 120));
    if (!map.has(key)) map.set(key, value);
  }
  return [...map.values()];
}

async function loadThemeOntology() {
  return (await readJsonIfExists(path.join(process.cwd(), 'config', 'theme-ontology.defaults.json'))) || {};
}

async function loadRecentReportArtifacts(reportRoot = DEFAULT_REPORT_ROOT, limit = 20) {
  if (!existsSync(reportRoot)) return [];
  const entries = await readdir(reportRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const reportDir = path.join(reportRoot, entry.name);
    const bundlePath = path.join(reportDir, 'bundle.json');
    if (!existsSync(bundlePath)) continue;
    const info = await stat(bundlePath).catch(() => null);
    if (info) dirs.push({ reportDir, bundlePath, mtimeMs: info.mtimeMs });
  }
  dirs.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const artifacts = [];
  for (const item of dirs.slice(0, limit)) {
    const bundle = await readJsonIfExists(item.bundlePath);
    if (bundle) artifacts.push({ reportId: path.basename(item.reportDir), reportDir: item.reportDir, bundle });
  }
  return artifacts;
}

function filterInputsByThemes(inputs = {}, themes = []) {
  const filters = uniqueStrings(themes.map((theme) => theme.toLowerCase()), 20);
  if (!filters.length) return inputs;
  const hit = (value = {}) => {
    const text = JSON.stringify(value).toLowerCase();
    return filters.some((theme) => text.includes(theme));
  };
  return {
    ...inputs,
    researchQuestions: asArray(inputs.researchQuestions).filter(hit),
    adjacentCandidates: asArray(inputs.adjacentCandidates).filter(hit),
    reportArtifacts: asArray(inputs.reportArtifacts).filter(hit),
    ontology: {
      ...(inputs.ontology || {}),
      archetypes: asArray(inputs.ontology?.archetypes).filter(hit),
    },
  };
}

function excludeInputsByThemes(inputs = {}, themes = []) {
  const filters = uniqueStrings(themes.map((theme) => theme.toLowerCase()), 20);
  if (!filters.length) return inputs;
  const hit = (value = {}) => {
    const text = JSON.stringify(value).toLowerCase();
    return filters.some((theme) => text.includes(theme));
  };
  return {
    ...inputs,
    researchQuestions: asArray(inputs.researchQuestions).filter((item) => !hit(item)),
    adjacentCandidates: asArray(inputs.adjacentCandidates).filter((item) => !hit(item)),
    reportArtifacts: asArray(inputs.reportArtifacts).filter((item) => !hit(item)),
    inputs: asArray(inputs.inputs).filter((item) => !hit(item)),
    ontology: {
      ...(inputs.ontology || {}),
      archetypes: asArray(inputs.ontology?.archetypes).filter((item) => !hit(item)),
    },
  };
}

async function buildSeedInputs(options = {}) {
  const source = String(options.source || 'all').toLowerCase();
  const include = (name) => source === 'all' || source === name;
  const runtime = await loadRuntimeInputs();
  const ontology = include('ontology') && !options.excludeOntology ? await loadThemeOntology() : {};
  const reportArtifacts = include('reports') ? await loadRecentReportArtifacts(options.reportRoot, Math.max(10, Number(options.limit || 50))) : [];
  const snapshotQuestions = [];
  if ((include('research-questions') || source === 'all') && !options.excludeOntologySnapshotQuestions) {
    const generated = generateResearchQuestions({
      themes: asArray(ontology.archetypes).map((item) => ({
        key: asArray(item.themeIds)[0] || item.key,
        label: item.label,
        heat: 1,
        momentum: 0.7,
        supplierDiversity: 0,
      })),
    });
    snapshotQuestions.push(...asArray(generated.questions));
  }
  const inputs = {
    researchQuestions: include('research-questions') || source === 'all'
      ? [...snapshotQuestions, ...asArray(runtime.researchQuestions)]
      : [],
    adjacentCandidates: include('adjacent') || source === 'all' ? runtime.adjacentCandidates : [],
    reportArtifacts,
    ontology,
  };
  if (!options.excludeOperatorPrior && (source === 'all' || source === 'cross-theme-prior' || source === 'operator-cross-theme-prior')) {
    const crossThemePrior = loadOperatorCrossThemePrior();
    inputs.inputs = crossThemePriorToSeedInputs(crossThemePrior, { limitPerPrior: 8 });
  }
  return excludeInputsByThemes(filterInputsByThemes(inputs, options.themes || []), options.excludeThemes || []);
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, rows = []) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function withApplyClient(options = {}, fn) {
  if (options.client) return fn(options.client);
  loadOptionalEnvFile();
  const client = new Client(resolveNasPgConfig(options.pg || {}));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function runMechanismSeedGeneration(options = {}) {
  if (options.enqueueEvidence && !options.apply) {
    throw new Error('--enqueue-evidence requires --apply because it writes seed-scoped source-query approvals');
  }
  const prior = loadOperatorSeedPrior();
  const inputs = await buildSeedInputs(options);
  const result = generateMechanismSeeds(inputs, {
    prior,
    limit: options.limit,
    minScore: options.minScore,
    includeRejected: options.includeRejected,
  });
  const artifact = {
    ...result,
    mode: options.apply ? 'apply' : 'dry-run',
    source: options.source || 'all',
    themes: options.themes || [],
    excludeThemes: options.excludeThemes || [],
    artifactPath: options.artifactOut,
    jsonlPath: options.writeJsonl ? options.jsonlOut : null,
    exclusions: {
      operatorPrior: Boolean(options.excludeOperatorPrior),
      ontology: Boolean(options.excludeOntology),
      ontologySnapshotQuestions: Boolean(options.excludeOntologySnapshotQuestions),
    },
    boundaries: {
      dbWrites: 0,
      approvalQueueWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
  if (options.planEvidence || options.apply || options.enqueueEvidence) {
    artifact.seedEvidencePlans = result.seeds.map((seed) => buildRouteAwareSeedEvidencePlan(seed, {
      queryLimitPerClass: options.queryLimitPerClass,
    }));
    artifact.summary = {
      ...artifact.summary,
      evidencePlanCount: artifact.seedEvidencePlans.length,
      sourceQueryDraftCount: artifact.seedEvidencePlans.reduce((sum, plan) => sum + (plan.sourceQueryDrafts?.length || 0), 0),
      blockedRouteCount: artifact.seedEvidencePlans.reduce((sum, plan) => sum + (plan.blockedRoutes?.length || 0), 0),
    };
  }
  if (options.apply) {
    const persistence = await withApplyClient(options, async (client) => {
      if (options.ensureSchema !== false) await ensureOperatorResearchSeedSchema(client);
      const persisted = await upsertOperatorResearchSeeds(client, result.seeds, {
        mode: 'apply',
        source: options.source || 'all',
        artifactPath: options.artifactOut || DEFAULT_ARTIFACT_OUT,
        options: {
          source: options.source || 'all',
          themes: options.themes || [],
          excludeThemes: options.excludeThemes || [],
          limit: options.limit,
          minScore: options.minScore,
          includeRejected: Boolean(options.includeRejected),
          writeJsonl: Boolean(options.writeJsonl),
          planEvidence: Boolean(options.planEvidence),
          enqueueEvidence: Boolean(options.enqueueEvidence),
        },
      });
      if (!options.enqueueEvidence) return persisted;
      const enqueue = await enqueueSeedEvidenceSourceQueries(client, result.seeds, {
        limit: options.sourceQueryLimit,
        queryLimitPerClass: options.queryLimitPerClass,
      });
      return {
        ...persisted,
        enqueue,
        dbWrites: persisted.dbWrites + enqueue.approvalQueueWrites,
        approvalQueueWrites: enqueue.approvalQueueWrites,
        sourceQueryApprovalWrites: enqueue.sourceQueryApprovalWrites,
        reportBackfillWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        providerActivationWrites: 0,
      };
    });
    artifact.persistence = persistence;
    artifact.boundaries = {
      dbWrites: persistence.dbWrites,
      approvalQueueWrites: persistence.approvalQueueWrites,
      sourceQueryApprovalWrites: persistence.sourceQueryApprovalWrites || 0,
      reportBackfillWrites: persistence.reportBackfillWrites,
      canonicalWrites: persistence.canonicalWrites,
      sourceRegistryWrites: persistence.sourceRegistryWrites,
      providerActivationWrites: persistence.providerActivationWrites,
    };
    artifact.summary = {
      ...artifact.summary,
      dbWrites: persistence.dbWrites,
      inserted: persistence.inserted,
      updated: persistence.updated,
      unchanged: persistence.unchanged,
      skipped: persistence.skipped,
      runId: persistence.runId,
      approvalQueueWrites: persistence.approvalQueueWrites || 0,
      sourceQueryApprovalWrites: persistence.sourceQueryApprovalWrites || 0,
      sourceQueryEnqueued: persistence.enqueue?.insertedCount || 0,
      sourceQueryDeduped: persistence.enqueue?.dedupedCount || 0,
      canonicalWrites: 0,
    };
  }
  await writeJson(options.artifactOut || DEFAULT_ARTIFACT_OUT, artifact);
  if (options.writeJsonl) await writeJsonl(options.jsonlOut || DEFAULT_JSONL_OUT, result.seeds);
  return artifact;
}

async function main() {
  const options = parseMechanismSeedGenerationArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const artifact = await runMechanismSeedGeneration(options);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: artifact.mode,
    generated: artifact.summary.generated,
    statusCounts: artifact.summary.statusCounts,
    providerGapCounts: artifact.summary.providerGapCounts,
    persistence: artifact.persistence ? {
      runId: artifact.persistence.runId,
      inserted: artifact.persistence.inserted,
      updated: artifact.persistence.updated,
      unchanged: artifact.persistence.unchanged,
      skipped: artifact.persistence.skipped,
      dbWrites: artifact.persistence.dbWrites,
      sourceQueryEnqueued: artifact.persistence.enqueue?.insertedCount || 0,
      sourceQueryDeduped: artifact.persistence.enqueue?.dedupedCount || 0,
    } : null,
    evidencePlanCount: artifact.summary.evidencePlanCount || 0,
    sourceQueryDraftCount: artifact.summary.sourceQueryDraftCount || 0,
    blockedRouteCount: artifact.summary.blockedRouteCount || 0,
    artifactPath: artifact.artifactPath,
    jsonlPath: artifact.jsonlPath,
    boundaries: artifact.boundaries,
  }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
