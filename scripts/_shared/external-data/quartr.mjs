/*
 * Quartr API adapter — earnings transcripts + IR data.
 *
 * Paid. ~$$ tier varies (contact sales). Adds:
 *   - Earnings call transcripts (full text, by quarter)
 *   - Slide decks
 *   - Investor reports
 *   - Event summaries (capital markets days, conferences)
 *
 * This is the highest-impact paid provider for analyst-tier reports —
 * it lets the report quote management's exact language on guidance,
 * capex, AI infrastructure spending, etc.
 *
 * Get a key:
 *   1. https://quartr.com/api → "Request API access" / "Contact sales"
 *   2. Pricing depends on volume; expect monthly subscription
 *   3. Add to .env.local: QUARTR_API_KEY=your-key
 *
 * NOTE: This adapter is scaffolded. The actual endpoint paths must be
 * confirmed against Quartr's API docs once a key is provisioned. Keep the
 * loadFor() shape stable — the orchestrator and downstream prose code
 * already expect { ok, pack: { available, transcripts, slides, ... } }.
 */

import { safeFetchJson, resolveEnvKey, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'quartr',
  displayName: 'Quartr (transcripts + IR)',
  keyEnvVar: 'QUARTR_API_KEY',
  signupUrl: 'https://quartr.com/api',
  subjectKinds: [SUBJECT_KINDS.SYMBOL],
  pricing: 'paid',
  monthlyCost: 'contact_sales',
  dataKinds: ['transcripts', 'slides', 'reports', 'events'],
};

export function isAvailable() {
  return resolveEnvKey('QUARTR_API_KEY') !== null;
}

export async function loadFor(subject, opts = {}) {
  const apiKey = resolveEnvKey('QUARTR_API_KEY');
  if (!apiKey) return { ok: false, errors: [{ kind: 'no_key', message: 'QUARTR_API_KEY not set.' }] };
  const symbol = subject?.kind === SUBJECT_KINDS.SYMBOL ? subject.key : (opts.symbol || subject?.symbol);
  if (!symbol) return { ok: false, errors: [{ kind: 'no_symbol' }] };

  /* Quartr API endpoint scaffold. Confirm exact paths after key provisioning.
   * Common shape: GET /v1/companies/{ticker}/transcripts?limit=4 with
   *               Authorization: Bearer {key} or X-Api-Key header. */
  const baseUrl = process.env.QUARTR_API_BASE || 'https://api.quartr.com/v1';
  const headers = { Authorization: `Bearer ${apiKey}` };

  const transcripts = await safeFetchJson(
    `${baseUrl}/companies/${encodeURIComponent(symbol)}/transcripts?limit=4`,
    { headers },
  );
  const events = await safeFetchJson(
    `${baseUrl}/companies/${encodeURIComponent(symbol)}/events?limit=8`,
    { headers },
  );
  const errors = [];
  if (!transcripts.ok) errors.push({ kind: 'transcripts_failed', error: transcripts.error });
  if (!events.ok) errors.push({ kind: 'events_failed', error: events.error });

  /* Normalize. Adjust field names once API contract is confirmed. */
  const normalizedTranscripts = (transcripts.json?.data || transcripts.json?.transcripts || []).slice(0, 4).map((t) => ({
    id: t.id,
    quarter: t.quarter || t.period,
    fiscalYear: t.fiscal_year || t.fy,
    eventDate: t.event_date || t.date,
    eventType: t.event_type || 'earnings',
    /* Full transcript text can be huge — keep an excerpt + URL */
    excerpt: typeof t.transcript_text === 'string' ? t.transcript_text.slice(0, 1200) : null,
    url: t.url || t.transcript_url,
    speakerCount: t.speakers?.length || null,
  }));
  const normalizedEvents = (events.json?.data || events.json?.events || []).slice(0, 8).map((e) => ({
    id: e.id,
    title: e.title,
    eventDate: e.event_date || e.date,
    eventType: e.type || e.event_type,
    summary: typeof e.summary === 'string' ? e.summary.slice(0, 500) : null,
    url: e.url,
  }));

  return {
    ok: true,
    pack: {
      available: normalizedTranscripts.length > 0 || normalizedEvents.length > 0,
      symbol,
      transcripts: normalizedTranscripts,
      events: normalizedEvents,
    },
    errors,
  };
}
