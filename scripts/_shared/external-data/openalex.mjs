/*
 * OpenAlex adapter.
 *
 * Free, no key required (polite-pool email recommended). Returns scholarly
 * works for a theme query. Useful for adding a research-pulse signal
 * (papers per month, top-cited works, top concepts) to theme reports.
 *
 * For a "cloud infrastructure" theme report, OpenAlex returns recent
 * papers on data centers / hyperscalers / power efficiency / network
 * fabric — all of which thicken the analyst's understanding of where
 * the technology is moving.
 */

import { safeFetchJson, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'openalex',
  displayName: 'OpenAlex',
  keyEnvVar: null,
  signupUrl: 'https://docs.openalex.org/how-to-use-the-api/authentication#the-polite-pool',
  subjectKinds: [SUBJECT_KINDS.THEME, SUBJECT_KINDS.CROSS_THEME],
  pricing: 'free',
  monthlyCost: 0,
  dataKinds: ['research_papers', 'citations', 'concepts'],
};

const POLITE_EMAIL = process.env.LATTICE_OPENALEX_EMAIL || process.env.LATTICE_CONTACT_EMAIL || null;

export function isAvailable() { return true; }

function buildQuery(themeKey) {
  /* Convert hyphenated theme key to a more readable search phrase.
   * 'cloud-infrastructure' → 'cloud infrastructure'. OpenAlex search
   * accepts plain English and matches abstract + title. */
  return String(themeKey).replace(/-/g, ' ');
}

export async function loadFor(subject, opts = {}) {
  const themeKey = subject?.kind === SUBJECT_KINDS.THEME ? subject.key : (opts.theme || subject?.theme);
  if (!themeKey) {
    return { ok: false, errors: [{ kind: 'no_theme', message: 'OpenAlex adapter needs a theme key.' }] };
  }
  const query = buildQuery(themeKey);
  const since = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().slice(0, 10);
  })();
  const baseUrl = 'https://api.openalex.org/works';
  const params = new URLSearchParams({
    search: query,
    'filter': `from_publication_date:${since}`,
    'sort': 'cited_by_count:desc',
    'per_page': '12',
  });
  if (POLITE_EMAIL) params.set('mailto', POLITE_EMAIL);
  const url = `${baseUrl}?${params.toString()}`;
  const r = await safeFetchJson(url, { timeoutMs: 15_000 });
  if (!r.ok) {
    return { ok: false, errors: [{ kind: 'fetch_failed', message: r.error, status: r.status }] };
  }
  const works = (r.json?.results || []).map((w) => ({
    id: w.id,
    title: w.title,
    publishedAt: w.publication_date,
    citedByCount: w.cited_by_count,
    isOpenAccess: w.open_access?.is_oa === true,
    primaryTopic: w.primary_topic?.display_name || null,
    primaryConcept: (w.concepts || [])[0]?.display_name || null,
    authors: (w.authorships || []).slice(0, 3).map((a) => a.author?.display_name).filter(Boolean),
    sourceVenue: w.primary_location?.source?.display_name || null,
    doi: w.doi,
  }));
  /* Aggregate concept counts so the narrator can see "top research themes
   * around cloud-infrastructure right now". */
  const conceptCounts = {};
  for (const w of r.json?.results || []) {
    for (const c of (w.concepts || []).slice(0, 5)) {
      if (!c.display_name) continue;
      conceptCounts[c.display_name] = (conceptCounts[c.display_name] || 0) + 1;
    }
  }
  const topConcepts = Object.entries(conceptCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ concept: name, papers: count }));
  return {
    ok: true,
    pack: {
      available: works.length > 0,
      themeKey,
      query,
      lookbackDays: 365,
      paperCount: r.json?.meta?.count || works.length,
      works,
      topConcepts,
    },
    errors: [],
  };
}
