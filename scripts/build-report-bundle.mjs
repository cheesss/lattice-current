#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPORT_TYPES,
  buildCrossThemeBottleneckReportBundle,
  buildEventSignalReportBundle,
  buildRegimeTransmissionReportBundle,
  buildSampleReportBundle,
  buildSymbolSignalReportBundle,
  buildSystemQualityReportBundle,
  buildThemeReportBundle,
  createEvidenceBundle,
} from './_shared/report-evidence-bundle.mjs';
import { planReportFigures } from './_shared/report-chart-planner.mjs';
import { buildDbReportBundle, withReportDbClient } from './_shared/report-db-adapter.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function loadInput(filePath) {
  if (!filePath) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function buildBundleFromPayload(payload = {}, args = {}) {
  const type = args.type || payload.reportType || payload.type || REPORT_TYPES.THEME;
  const subject = args.subject || payload.subject?.displayName || payload.theme?.label || payload.candidate?.name;
  const withSubject = subject
    ? { ...payload, subject: { ...(payload.subject || {}), displayName: subject } }
    : payload;
  let bundle;
  if (args.sample || payload.sample) {
    bundle = buildSampleReportBundle(type, { subject });
  } else if (type === REPORT_TYPES.THEME || type === 'theme') {
    bundle = buildThemeReportBundle(withSubject);
  } else if (type === REPORT_TYPES.CROSS_THEME || type === 'cross-theme' || type === 'cross_theme') {
    bundle = buildCrossThemeBottleneckReportBundle(withSubject);
  } else if (type === REPORT_TYPES.EVENT_SIGNAL || type === 'event' || type === 'event_signal') {
    bundle = buildEventSignalReportBundle(withSubject);
  } else if (type === REPORT_TYPES.REGIME || type === 'regime') {
    bundle = buildRegimeTransmissionReportBundle(withSubject);
  } else if (type === REPORT_TYPES.SYMBOL || type === 'symbol') {
    bundle = buildSymbolSignalReportBundle(withSubject);
  } else if (type === REPORT_TYPES.SYSTEM_QUALITY || type === 'system' || type === 'ops') {
    bundle = buildSystemQualityReportBundle(withSubject);
  } else {
    bundle = createEvidenceBundle({ ...withSubject, reportType: type });
  }
  return planReportFigures(bundle);
}

async function main() {
  const args = parseArgs();
  const payload = await loadInput(args.input);
  const useDb = Boolean(args.db || args.live || payload?.db || payload?.live || payload?.source === 'db');
  const bundle = useDb
    ? await withReportDbClient((client) => buildDbReportBundle(client, { ...(payload || {}), ...args }))
    : buildBundleFromPayload(payload || {}, args);
  const json = JSON.stringify(bundle, null, 2);
  if (args.output) {
    await mkdir(path.dirname(args.output), { recursive: true });
    await writeFile(args.output, `${json}\n`, 'utf8');
  } else {
    console.log(json);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
