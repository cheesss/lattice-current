import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REPORT_SOURCE_QUARANTINE_VERSION = 'report-source-quarantine-v1';
export const DEFAULT_REPORT_SOURCE_QUARANTINE_PATH = path.join(process.cwd(), 'data', 'runtime', 'report-source-quarantine.latest.json');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slug(value = '') {
  return compact(value).toLowerCase().replace(/[^a-z0-9가-힣一-龥ぁ-んァ-ヶ]+/gi, '-').replace(/^-+|-+$/g, '');
}

function parseDate(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function hoursBetween(a, b) {
  return Math.max(0, (a.getTime() - b.getTime()) / (60 * 60 * 1000));
}

function reportSubjectTerms(report = {}) {
  return asArray([
    report.subject,
    report.subjectLabel,
    report.title,
    report.reportSubject,
    report.childSeedId,
    report.parentSeedId,
    report.bottleneckNode,
    report.seedId,
  ]).flatMap(asArray).map(compact).filter(Boolean);
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export function buildReportSourceQuarantine({ reports = [], now = new Date(), cooldownHours = 168 } = {}) {
  const nowDate = parseDate(now, new Date());
  const rows = asArray(reports).map((report, index) => {
    const generatedAt = parseDate(report.generatedAt || report.createdAt || report.updatedAt, nowDate);
    const ageHours = hoursBetween(nowDate, generatedAt);
    const withinCooldown = ageHours <= Number(cooldownHours || 168);
    const terms = reportSubjectTerms(report);
    return {
      reportId: report.reportId || report.id || `report-${index}`,
      reportPath: report.reportPath || report.path || report.clientMemoPath || null,
      generatedAt: generatedAt.toISOString(),
      ageHours,
      subjectTerms: terms,
      subjectKeys: terms.map(slug).filter(Boolean),
      status: withinCooldown ? 'quarantined_as_seed_source' : 'cooldown_expired',
      cooldownHours,
      reason: withinCooldown
        ? 'recent generated report is quarantined from immediate seed feedback'
        : 'report is outside seed feedback cooldown',
    };
  });
  const active = rows.filter((row) => row.status === 'quarantined_as_seed_source');
  return {
    ok: true,
    version: REPORT_SOURCE_QUARANTINE_VERSION,
    generatedAt: nowDate.toISOString(),
    cooldownHours,
    reportCount: rows.length,
    activeQuarantineCount: active.length,
    quarantinedSubjectKeys: [...new Set(active.flatMap((row) => row.subjectKeys))],
    rows,
    policy: {
      recentReportSubjectCooldown: true,
      generatedArtifactQuarantine: true,
      sourceBucketQuotaHint: 'generated reports should not dominate seed discovery buckets',
    },
  };
}

export function applyReportSourceQuarantineToSeeds(seeds = [], quarantine = {}) {
  const blockedKeys = new Set(asArray(quarantine.quarantinedSubjectKeys));
  return asArray(seeds).map((seed) => {
    const terms = asArray([
      seed.seedTitle,
      seed.bottleneck?.label,
      seed.bottleneckNode,
      seed.childSeedId,
      seed.parentSeedId,
      seed.seedId,
      seed.theme,
    ]).flatMap(asArray).map(slug).filter(Boolean);
    const matched = terms.filter((term) => blockedKeys.has(term));
    return {
      ...seed,
      reportSourceQuarantine: matched.length > 0 ? {
        applied: true,
        matchedSubjectKeys: matched,
        penalty: 'recent_report_subject_cooldown',
      } : {
        applied: false,
        matchedSubjectKeys: [],
      },
    };
  });
}

export async function writeReportSourceQuarantineArtifact(payload, filePath = DEFAULT_REPORT_SOURCE_QUARANTINE_PATH) {
  const artifactPath = await writeJson(filePath, payload);
  return { ...payload, artifactPath };
}

export async function loadReportSourceQuarantineArtifact(filePath = DEFAULT_REPORT_SOURCE_QUARANTINE_PATH) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
