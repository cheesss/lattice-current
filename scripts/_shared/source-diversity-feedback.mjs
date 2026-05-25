import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SOURCE_DIVERSITY_FEEDBACK_VERSION = 'source-diversity-feedback-v1';
export const DEFAULT_SOURCE_DIVERSITY_FEEDBACK_PATH = path.join(process.cwd(), 'data', 'runtime', 'source-diversity-feedback.latest.json');

const EXPECTED_BUCKETS = [
  'official_filing',
  'company_ir',
  'government_official',
  'grid_operator',
  'trade_media',
  'technical_standard',
  'patent_or_paper',
  'market_local_cache',
  'generated_report',
  'prior_report',
  'provider_gap',
  'evidence_gap_ledger',
];

const UNDERREPRESENTED_CLASSES = [
  'material_input',
  'technical_qualification',
  'permitting_regulatory',
  'test_facility_capacity',
  'engineering_process',
  'provider_data_gap',
];

const OVERREPRESENTED_CLASSES = [
  'power_constraint',
  'supplier_capacity',
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactKey(value = '') {
  return compact(value).toLowerCase().replace(/\s+/g, '_') || 'unknown';
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function addHours(iso, hours) {
  const date = new Date(iso || Date.now());
  date.setUTCHours(date.getUTCHours() + Number(hours || 0));
  return date.toISOString();
}

export function normalizeSourceBucket(input = {}) {
  const text = compact([
    input.sourceBucket,
    input.sourceGroup,
    input.sourceType,
    input.providerName,
    input.provider,
    input.source,
    input.providerRoute,
    input.reportPath,
    input.evidenceClass,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (/generated|dry[-_ ]?run|memo|report-source|final-investment-report|thesis/.test(text)) return 'generated_report';
  if (/prior[_ -]?report|historical[_ -]?report/.test(text)) return 'prior_report';
  if (/gap|adapter|provider_data_gap/.test(text)) return 'provider_gap';
  if (/ledger|evidence_gap/.test(text)) return 'evidence_gap_ledger';
  if (/mops|edinet|tdnet|dart|sec|10-k|10-q|20-f|filing|primary_filing/.test(text)) return 'official_filing';
  if (/ir|investor|annual|company/.test(text)) return 'company_ir';
  if (/ferc|government|official_industry|official_government|permit|regulator|utility_planning/.test(text)) return 'government_official';
  if (/grid|iso|rto|pjm|miso|caiso|ercot|spp|interconnection/.test(text)) return 'grid_operator';
  if (/trade|media|news/.test(text)) return 'trade_media';
  if (/standard|certification|qualification/.test(text)) return 'technical_standard';
  if (/patent|paper|technical_paper|research_dataset/.test(text)) return 'patent_or_paper';
  if (/market|quote|fundamental|valuation|local_controlled/.test(text)) return 'market_local_cache';
  return 'unknown';
}

function countBuckets(rows = []) {
  const counts = {};
  for (const row of asArray(rows)) {
    const bucket = normalizeSourceBucket(row);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

function shareMap(counts = {}) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const shares = {};
  for (const [key, value] of Object.entries(counts)) {
    shares[key] = total > 0 ? Number((Number(value || 0) / total).toFixed(4)) : 0;
  }
  return shares;
}

function entropyFromShares(shares = {}) {
  let entropy = 0;
  for (const value of Object.values(shares)) {
    const p = Number(value || 0);
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(4));
}

function classCounts(tasks = [], evidenceRows = []) {
  const counts = {};
  for (const row of [...asArray(tasks), ...asArray(evidenceRows)]) {
    const klass = compact(row.evidenceClass || row.desiredEvidenceClass || row.bottleneckClass);
    if (!klass) continue;
    counts[klass] = (counts[klass] || 0) + 1;
  }
  return counts;
}

function reportCooldownRows({ reportSourceQuarantine = {}, reports = [], repairLoop = {}, finalReport = {}, generatedAt }) {
  reportSourceQuarantine = reportSourceQuarantine || {};
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const rows = [];
  for (const key of asArray(reportSourceQuarantine.quarantinedSubjectKeys)) {
    rows.push({
      subjectKey: key,
      cooldownUntil: reportSourceQuarantine.cooldownUntil || addHours(generatedAt, 168),
      reason: 'report_source_quarantine_active',
    });
  }
  for (const report of asArray(reports)) {
    rows.push({
      subjectKey: compact(report.subject || report.subjectLabel || report.reportId || report.reportPath),
      cooldownUntil: addHours(generatedAt, 168),
      reason: 'recent_generated_report_cooldown',
    });
  }
  const generatedSubject = compact(
    repairLoop.dryRunReportSubject?.subjectLabel
    || finalReport.subject?.subjectLabel
    || finalReport.subjectLabel
    || repairLoop.selectedChildSeed?.bottleneckNode
    || '',
  );
  if (generatedSubject) {
    rows.push({
      subjectKey: generatedSubject,
      cooldownUntil: addHours(generatedAt, 168),
      reason: 'latest_repair_or_final_report_cooldown',
    });
  }
  return rows.filter((row) => row.subjectKey);
}

function repeatedSubjectWarnings(rows = []) {
  const text = compact(rows.map((row) => row.subjectKey || row.title || row.summary || row.bottleneckNode || '').join(' ')).toLowerCase();
  const warnings = [];
  if (/data center|datacenter|grid|power|interconnection|substation/.test(text)) {
    warnings.push({
      warning: 'repeated_grid_power_or_data_center_subject',
      penalty: 'overrepresented_subject_cooldown',
      nextAction: 'apply_source_bucket_quota',
    });
  }
  return warnings;
}

export function buildSourceDiversityFeedback({
  sourceProviderActivation = {},
  stagedProviderLiveExecution = {},
  backfillQueue = {},
  reportSourceQuarantine = {},
  repairLoop = {},
  finalReport = {},
  biasDiagnostics = {},
  reports = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  biasDiagnostics = biasDiagnostics || {};
  const activationRecords = asArray(sourceProviderActivation.records);
  const evidenceRows = [
    ...asArray(stagedProviderLiveExecution.rawEvidence),
    ...asArray(stagedProviderLiveExecution.acceptedEvidence),
    ...asArray(backfillQueue.rawEvidence),
    ...asArray(backfillQueue.acceptedEvidence),
  ];
  const tasks = [
    ...asArray(backfillQueue.tasks),
    ...asArray(backfillQueue.taskResults),
  ];
  const bucketCounts = countBuckets([
    ...activationRecords,
    ...evidenceRows,
    ...tasks,
    ...reports.map((report) => ({ ...report, sourceBucket: 'generated_report' })),
  ]);
  for (const bucket of EXPECTED_BUCKETS) bucketCounts[bucket] = bucketCounts[bucket] || 0;
  const bucketShares = shareMap(bucketCounts);
  const countsByClass = classCounts(tasks, evidenceRows);
  const acceptedClasses = new Set([
    ...asArray(stagedProviderLiveExecution.acceptedPromotionEvidence),
    ...asArray(backfillQueue.acceptedPromotionEvidence),
  ].filter(Boolean).map((row) => compactKey(row.evidenceClass)));
  const underrepresentedEvidenceClasses = UNDERREPRESENTED_CLASSES
    .filter((klass) => !acceptedClasses.has(compactKey(klass)))
    .map((klass) => ({
      evidenceClass: klass,
      observedCount: countsByClass[klass] || 0,
      acceptedPromotionCount: 0,
      bonus: 0.15,
      recommendedAction: 'create_targeted_backfill_task',
    }));
  const classWarnings = [];
  for (const klass of OVERREPRESENTED_CLASSES) {
    if (Number(countsByClass[klass] || 0) >= 2 || Number(biasDiagnostics.classDistribution?.counts?.[klass] || 0) > 0) {
      classWarnings.push({
        evidenceClass: klass,
        warning: 'overrepresented_bottleneck_class',
        penalty: 0.2,
        recommendedAction: 'apply_source_bucket_quota',
      });
    }
  }
  const cooldowns = reportCooldownRows({ reportSourceQuarantine, reports, repairLoop, finalReport, generatedAt });
  const sourceBucketQuotaWarnings = [
    ...repeatedSubjectWarnings(cooldowns),
  ];
  const generatedShare = bucketShares.generated_report || 0;
  if (generatedShare > 0.2) {
    sourceBucketQuotaWarnings.push({
      warning: 'generated_artifact_bucket_over_quota',
      share: generatedShare,
      recommendedAction: 'apply_source_bucket_quota',
    });
  }
  const missingBuckets = EXPECTED_BUCKETS.filter((bucket) => !bucketCounts[bucket]);
  const nextAction = underrepresentedEvidenceClasses.length
    ? 'create_targeted_backfill_task'
    : sourceBucketQuotaWarnings.length
      ? 'apply_source_bucket_quota'
      : 'continue_diversified_source_collection';
  return {
    ok: true,
    version: SOURCE_DIVERSITY_FEEDBACK_VERSION,
    generatedAt,
    sourceBucketDistribution: {
      counts: bucketCounts,
      shares: bucketShares,
      entropy: entropyFromShares(bucketShares),
      missingBuckets,
    },
    classDistribution: countsByClass,
    underrepresentedEvidenceClasses,
    overrepresentedWarnings: classWarnings,
    sourceBucketQuotaWarnings,
    reportCooldowns: cooldowns,
    sourceSelectionPolicy: {
      generatedReportCooldownHours: 168,
      topOneParentSelectionAllowed: false,
      rawEvidenceRaisesReadiness: false,
      acceptedEvidenceRequiredForPromotion: true,
    },
    recommendedNextAction: nextAction,
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  };
}

export async function writeSourceDiversityFeedbackArtifact(payload, filePath = DEFAULT_SOURCE_DIVERSITY_FEEDBACK_PATH) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export async function loadSourceDiversityFeedback(filePath = DEFAULT_SOURCE_DIVERSITY_FEEDBACK_PATH) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
