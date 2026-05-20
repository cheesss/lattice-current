/**
 * US equity market calendar helper for nowcast confidence scaling.
 *
 * Sessions used by the rate/oil/dollar nowcasts:
 *   - regular:    09:30–16:00 ET, Mon–Fri, non-holiday. Confidence ≥ 0.80.
 *   - post-close: 16:00–20:00 ET, Mon–Fri. Confidence ~0.65.
 *   - pre-open:   04:00–09:30 ET, Mon–Fri. Confidence ~0.65.
 *   - overnight:  20:00–04:00 ET, Mon–Fri weeknights. Confidence ~0.55.
 *   - weekend:    Sat 00:00 → Sun 18:00 ET. Confidence ~0.40 or abstain.
 *   - holiday:    confidence floor 0.45, or abstain if proxies missing.
 *
 * Holidays follow the standard NYSE observed schedule (fixed lookup table; not
 * exhaustive — edge cases around half-days are approximated).
 */

const NYSE_HOLIDAYS_2026 = new Set([
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Jr. Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed; Jul 4 is Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas Day
]);

/**
 * Convert a Date to the corresponding ET Date fields. This avoids pulling in
 * a full tz library by using Intl.DateTimeFormat with America/New_York.
 */
function etFields(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '00' : parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday, // 'Mon', 'Tue', ...
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function classifyMarketSession(now = new Date()) {
  const et = etFields(now);
  const isWeekend = et.weekday === 'Sat' || et.weekday === 'Sun';
  const isHoliday = NYSE_HOLIDAYS_2026.has(et.dateKey);
  const minutesOfDay = et.hour * 60 + et.minute;

  if (isWeekend) {
    return {
      session: 'weekend',
      isOpen: false,
      holiday: false,
      confidenceFloor: 0.40,
      abstainEligible: true,
    };
  }
  if (isHoliday) {
    return {
      session: 'holiday',
      isOpen: false,
      holiday: true,
      confidenceFloor: 0.45,
      abstainEligible: true,
    };
  }
  // Weekday sessions
  if (minutesOfDay >= 9 * 60 + 30 && minutesOfDay < 16 * 60) {
    return { session: 'regular', isOpen: true, holiday: false, confidenceFloor: 0.80, abstainEligible: false };
  }
  if (minutesOfDay >= 16 * 60 && minutesOfDay < 20 * 60) {
    return { session: 'post-close', isOpen: false, holiday: false, confidenceFloor: 0.65, abstainEligible: false };
  }
  if (minutesOfDay >= 4 * 60 && minutesOfDay < 9 * 60 + 30) {
    return { session: 'pre-open', isOpen: false, holiday: false, confidenceFloor: 0.65, abstainEligible: false };
  }
  return { session: 'overnight', isOpen: false, holiday: false, confidenceFloor: 0.55, abstainEligible: false };
}

/**
 * Apply the session floor to a raw confidence. Nowcast callers should
 * clip their model-derived confidence to at least the floor so overly
 * optimistic posteriors do not override real session limits.
 */
export function adjustConfidenceForSession(rawConfidence, now = new Date()) {
  const session = classifyMarketSession(now);
  const adjusted = Math.min(1, Math.max(session.confidenceFloor, Number(rawConfidence) || 0));
  return { confidence: Number(adjusted.toFixed(3)), session };
}
