import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_AUDIT_FILES = [
  'scripts/run-autonomous-research-repair-loop.mjs',
  'scripts/_shared/seed-child-bottleneck-decomposition.mjs',
  'scripts/_shared/thesis-validation-memo-dry-run.mjs',
  'scripts/_shared/valuation-expectation-bridge-dry-run.mjs',
  'scripts/_shared/seed-bias-diagnostics.mjs',
  'tests/autonomous-research-repair-loop.test.mjs',
];

const DOMAIN_PATTERNS = [
  { key: 'pwr_acm_j', pattern: /\b(PWR|ACM)\b|\bJ\b(?!\.)/g, concern: 'issuer-specific positive-path symbols' },
  { key: 'abf', pattern: /\b(ABF|advanced substrate|build-up film|substrate capacity)\b/gi, concern: 'ABF/substrate positive-path vocabulary' },
  { key: 'interconnection', pattern: /\b(interconnection study capacity|transmission and substation EPC backlog|utility grid infrastructure execution capacity)\b/gi, concern: 'grid route-mismatch positive path vocabulary' },
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function classifyFinding(filePath = '', line = '', options = {}) {
  const normalized = filePath.replace(/\\/g, '/');
  if (/\/tests\//.test(`/${normalized}`) || /fixtures?\//.test(normalized)) {
    return 'OK_FIXTURE_ONLY';
  }
  if (/seed-child-bottleneck-decomposition|seed-bias-diagnostics|external-data|theme-ontology|evidence-class-playbooks|universal-evidence-contract/.test(normalized)) {
    return 'OK_CONFIG_DRIVEN_PRIOR';
  }
  if (/thesis-validation-memo-dry-run|valuation-expectation-bridge-dry-run|run-autonomous-research-repair-loop/.test(normalized)) {
    return options.strictCore === true ? 'RISKY_CORE_HARDCODING' : 'NEEDS_CONFIG_EXTRACTION';
  }
  if (/PWR|ACM|ABF|interconnection study capacity/i.test(line)) {
    return 'RISKY_CORE_HARDCODING';
  }
  return 'OK_CONFIG_DRIVEN_PRIOR';
}

function readAuditFile(cwd, filePath, virtualFiles) {
  if (virtualFiles && Object.prototype.hasOwnProperty.call(virtualFiles, filePath)) {
    return String(virtualFiles[filePath] || '');
  }
  try {
    return readFileSync(path.resolve(cwd, filePath), 'utf8');
  } catch {
    return '';
  }
}

export function runAutonomousResearchHardcodingAudit(options = {}) {
  const cwd = options.cwd || process.cwd();
  const files = options.files || DEFAULT_AUDIT_FILES;
  const findings = [];

  for (const filePath of files) {
    const text = readAuditFile(cwd, filePath, options.virtualFiles);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of DOMAIN_PATTERNS) {
        pattern.pattern.lastIndex = 0;
        if (!pattern.pattern.test(line)) continue;
        findings.push({
          filePath,
          line: index + 1,
          pattern: pattern.key,
          concern: pattern.concern,
          status: classifyFinding(filePath, line, options),
          snippet: line.trim().slice(0, 220),
        });
      }
    });
  }

  const risky = findings.filter((finding) => ['RISKY_CORE_HARDCODING', 'REMOVE_OR_ISOLATE'].includes(finding.status));
  const needsExtraction = findings.filter((finding) => finding.status === 'NEEDS_CONFIG_EXTRACTION');
  const status = risky.length
    ? 'failed_risky_core_hardcoding'
    : needsExtraction.length
      ? 'passed_with_config_extraction_notes'
      : 'passed';

  return {
    ok: risky.length === 0,
    status,
    generatedAt: options.generatedAt || new Date().toISOString(),
    findings,
    summary: {
      filesScanned: files.length,
      findingCount: findings.length,
      riskyCount: risky.length,
      needsConfigExtractionCount: needsExtraction.length,
      classifications: findings.reduce((acc, finding) => {
        acc[finding.status] = (acc[finding.status] || 0) + 1;
        return acc;
      }, {}),
    },
    actionRequired: risky.length
      ? 'remove_or_isolate_risky_core_hardcoding_before_mvp_close'
      : needsExtraction.length
        ? 'non_blocking_config_extraction_backlog'
        : 'none',
    auditedConcepts: uniqueStrings(DOMAIN_PATTERNS.map((pattern) => pattern.concern), 20),
  };
}

export const __test = {
  classifyFinding,
  DEFAULT_AUDIT_FILES,
};
