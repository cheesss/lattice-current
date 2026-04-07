export const ALLOWED_BACKFILL_SOURCES = Object.freeze({
  hackernews: Object.freeze({
    script: 'scripts/fetch-hackernews-archive.mjs',
    description: 'Hacker News stories',
    args: Object.freeze({
      since: { type: 'date', required: false },
      limit: { type: 'int', min: 1, max: 50000, default: 10000 },
      minScore: { type: 'int', min: 0, max: 1000, default: 50 },
    }),
    minIntervalHours: 24,
    requiresApproval: false,
    estimatedDurationHours: 6,
  }),
  arxiv: Object.freeze({
    script: 'scripts/fetch-arxiv-archive.mjs',
    description: 'arXiv academic papers by category',
    args: Object.freeze({
      categories: { type: 'array', required: true, maxLength: 5 },
      from: { type: 'date', required: true },
      limit: { type: 'int', min: 1, max: 30000, default: 10000 },
    }),
    minIntervalHours: 24,
    requiresApproval: false,
    estimatedDurationHours: 5,
  }),
  'gdelt-articles': Object.freeze({
    script: 'scripts/fetch-gdelt-articles.mjs',
    description: 'GDELT raw articles',
    args: Object.freeze({
      keywords: { type: 'array', required: false, maxLength: 10 },
      from: { type: 'date', required: true },
      limit: { type: 'int', min: 1, max: 100000, default: 20000 },
    }),
    minIntervalHours: 48,
    requiresApproval: false,
    estimatedDurationHours: 3,
  }),
  'guardian-keyword': Object.freeze({
    script: 'scripts/fetch-keyword-news-backfill.mjs',
    description: 'Guardian/NYT keyword search',
    args: Object.freeze({
      query: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      from: { type: 'date', required: true },
      limit: { type: 'int', min: 1, max: 5000, default: 1000 },
    }),
    minIntervalHours: 24,
    requiresApproval: true,
    estimatedDurationHours: 2,
  }),
});

function isValidDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeValue(rule, value) {
  if (value == null) return value;
  switch (rule.type) {
    case 'int': {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.floor(parsed) : NaN;
    }
    case 'array':
      return Array.isArray(value) ? value : [value];
    case 'string':
      return String(value);
    case 'date':
      return String(value);
    default:
      return value;
  }
}

export function validateBackfillArgs(source, args = {}) {
  const config = ALLOWED_BACKFILL_SOURCES[String(source || '').trim().toLowerCase()];
  if (!config) {
    return { ok: false, error: `source '${source}' not in whitelist` };
  }

  const normalized = {};
  for (const [name, rule] of Object.entries(config.args || {})) {
    const incoming = args[name] ?? rule.default;
    if ((incoming == null || incoming === '') && rule.required) {
      return { ok: false, error: `missing required arg '${name}'` };
    }
    if (incoming == null || incoming === '') continue;
    const value = normalizeValue(rule, incoming);
    if (rule.type === 'int') {
      if (!Number.isFinite(value)) return { ok: false, error: `arg '${name}' must be int` };
      if (rule.min != null && value < rule.min) return { ok: false, error: `arg '${name}' below min ${rule.min}` };
      if (rule.max != null && value > rule.max) return { ok: false, error: `arg '${name}' above max ${rule.max}` };
    } else if (rule.type === 'array') {
      if (!Array.isArray(value)) return { ok: false, error: `arg '${name}' must be array` };
      if (rule.maxLength != null && value.length > rule.maxLength) {
        return { ok: false, error: `arg '${name}' exceeds maxLength ${rule.maxLength}` };
      }
    } else if (rule.type === 'string') {
      if (rule.minLength != null && value.length < rule.minLength) {
        return { ok: false, error: `arg '${name}' below minLength ${rule.minLength}` };
      }
      if (rule.maxLength != null && value.length > rule.maxLength) {
        return { ok: false, error: `arg '${name}' exceeds maxLength ${rule.maxLength}` };
      }
    } else if (rule.type === 'date' && !isValidDateString(value)) {
      return { ok: false, error: `arg '${name}' must be valid date` };
    }
    normalized[name] = value;
  }

  return { ok: true, value: normalized, config };
}
