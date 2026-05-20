#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  promoteOperatorSeedReportCandidates,
} from './_shared/operator-seed-report-closure.mjs';

const { Client } = pg;

const DEFAULT_ARTIFACT_OUT = path.join(process.cwd(), 'data', 'runtime', 'mechanism-seed-report-closure.latest.json');
const DEFAULT_REPORT_ROOT = path.join(process.cwd(), 'data', 'reports');

function parseCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseMechanismSeedReportClosureArgs(argv = process.argv.slice(2)) {
  const out = {
    dryRun: true,
    apply: false,
    seedId: '',
    statuses: ['report_candidate'],
    includeReviewReady: false,
    limit: 25,
    generateReport: false,
    reportRoot: DEFAULT_REPORT_ROOT,
    artifactOut: DEFAULT_ARTIFACT_OUT,
    writeArtifact: true,
    provider: 'deterministic',
    reviewer: 'operator',
    reason: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (arg === '--seed-id') out.seedId = next() || '';
    else if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--include-review-ready') {
      out.includeReviewReady = true;
      out.statuses = ['report_candidate', 'review_ready'];
    } else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--generate-report') out.generateReport = true;
    else if (arg === '--report-root') out.reportRoot = path.resolve(next() || out.reportRoot);
    else if (arg === '--artifact-out') out.artifactOut = path.resolve(next() || out.artifactOut);
    else if (arg === '--no-write') out.writeArtifact = false;
    else if (arg === '--provider') out.provider = next() || out.provider;
    else if (arg === '--reviewer') out.reviewer = next() || out.reviewer;
    else if (arg === '--reason') out.reason = next() || '';
    else if (arg === '--fail-on-blocked') out.failOnBlocked = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--seed-id=')) out.seedId = arg.slice('--seed-id='.length);
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--report-root=')) out.reportRoot = path.resolve(arg.slice('--report-root='.length));
    else if (arg.startsWith('--artifact-out=')) out.artifactOut = path.resolve(arg.slice('--artifact-out='.length));
    else if (arg.startsWith('--provider=')) out.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--reviewer=')) out.reviewer = arg.slice('--reviewer='.length);
    else if (arg.startsWith('--reason=')) out.reason = arg.slice('--reason='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-mechanism-seed-report-closure.mjs --dry-run --include-review-ready --limit 10
  node --import tsx scripts/run-mechanism-seed-report-closure.mjs --apply --seed-id <id>
  node --import tsx scripts/run-mechanism-seed-report-closure.mjs --apply --seed-id <id> --generate-report

Default mode is dry-run. Phase E apply mode writes only:
  - universal_research_subjects
  - operator_research_seeds review/latest report metadata
  - local report artifacts when --generate-report is set

It does not write approval_queue, report_backfill_tasks, research_evidence_bundles,
canonical graph, source registry, or provider activation state.

Options:
  --seed-id <id>
  --statuses <csv>             Default: report_candidate
  --include-review-ready       Also previews review_ready seeds
  --limit <n>
  --generate-report            Requires --apply; writes local report artifact
  --report-root <path>
  --artifact-out <path>
  --no-write                   Do not write the runtime artifact
`;
}

async function writeRuntimeArtifact(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

async function withClient(options = {}, fn) {
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

export async function runMechanismSeedReportClosure(options = {}) {
  return withClient(options, async (client) => {
    const result = await promoteOperatorSeedReportCandidates(client, {
      seedId: options.seedId || undefined,
      statuses: options.statuses || ['report_candidate'],
      includeReviewReady: Boolean(options.includeReviewReady),
      limit: options.limit || 25,
      apply: Boolean(options.apply),
      generateReport: Boolean(options.generateReport),
      reportRoot: options.reportRoot || DEFAULT_REPORT_ROOT,
      provider: options.provider || 'deterministic',
      reviewer: options.reviewer || 'operator',
      reason: options.reason || '',
    });
    const withArtifact = {
      ...result,
      artifactPath: null,
    };
    if (options.writeArtifact !== false) {
      withArtifact.artifactPath = await writeRuntimeArtifact(options.artifactOut || DEFAULT_ARTIFACT_OUT, withArtifact);
      withArtifact.boundaries = {
        ...(withArtifact.boundaries || {}),
        runtimeArtifactWrites: 1,
      };
    }
    return withArtifact;
  });
}

async function main() {
  const options = parseMechanismSeedReportClosureArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runMechanismSeedReportClosure(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.blockedCount > 0 && options.failOnBlocked) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
