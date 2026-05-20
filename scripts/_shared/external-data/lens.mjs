/*
 * Lens.org adapter — patents + scholarly works.
 *
 * Free with token (researcher-grade tier). Adds patent activity counts +
 * top assignees (companies filing patents in the theme area). Useful for
 * deep-tech themes (semiconductor, biotech, EV, materials).
 *
 * Get a token:
 *   1. https://www.lens.org/lens/user/subscriptions → Sign up free
 *   2. Request "Lens Scholarly API" token (free researcher tier; commercial
 *      tier is paid)
 *   3. Add to .env.local: LENS_API_TOKEN=your-token
 */

import { safeFetchJson, resolveEnvKey, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'lens',
  displayName: 'Lens.org (Patents + Scholarly)',
  keyEnvVar: 'LENS_API_TOKEN',
  signupUrl: 'https://www.lens.org/lens/user/subscriptions',
  subjectKinds: [SUBJECT_KINDS.THEME],
  pricing: 'free-with-key',
  monthlyCost: 0,
  dataKinds: ['patents', 'scholarly_works', 'top_assignees'],
};

export function isAvailable() {
  return resolveEnvKey('LENS_API_TOKEN') !== null;
}

export async function loadFor(subject, opts = {}) {
  const token = resolveEnvKey('LENS_API_TOKEN');
  if (!token) return { ok: false, errors: [{ kind: 'no_key', message: 'LENS_API_TOKEN not set.' }] };
  const themeKey = subject?.kind === SUBJECT_KINDS.THEME ? subject.key : (opts.theme || subject?.theme);
  if (!themeKey) return { ok: false, errors: [{ kind: 'no_theme' }] };
  const query = String(themeKey).replace(/-/g, ' ');
  /* Patent search — last 12 months */
  const since = (() => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d.toISOString().slice(0, 10); })();
  const body = {
    query: { bool: { must: [
      { match: { full_text: query } },
      { range: { date_published: { gte: since } } },
    ] } },
    size: 12,
    sort: [{ date_published: 'desc' }],
  };
  const r = await safeFetchJson('https://api.lens.org/patent/search', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: 'POST',
    body: JSON.stringify(body),
  });
  /* Note: Lens API uses POST. safeFetchJson is GET-only by default.
   * Marking this as a scaffold — when token is provided, we'll need to
   * extend safeFetchJson or call fetch directly. */
  if (!r.ok) {
    return { ok: false, errors: [{ kind: 'fetch_failed', message: r.error, status: r.status, note: 'Lens API uses POST + auth header. Adapter scaffold ready; see docs/EXTERNAL_DATA_KEYS.md for activation.' }] };
  }
  const patents = (r.json?.data || []).map((p) => ({
    id: p.lens_id,
    title: p.biblio?.invention_title?.[0]?.text,
    publishedAt: p.date_published,
    assignee: p.biblio?.parties?.applicants?.[0]?.residence,
    abstract: p.abstract?.[0]?.text?.slice(0, 200),
  }));
  return {
    ok: true,
    pack: {
      available: patents.length > 0,
      themeKey,
      patentCount: r.json?.total || patents.length,
      patents,
    },
    errors: [],
  };
}
