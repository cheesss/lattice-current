/**
 * V3 Phase 1 — Optimistic action wrapper.
 *
 * SWR-style helper:
 *   1. apply()    — mutate DOM/state immediately so the UI feels instant.
 *   2. commit()   — fire the network request.
 *   3. rollback() — invoked iff commit() rejects.
 *
 * Returns the commit promise so callers can `await` outcome (or chain).
 *
 * Example:
 *   await runOptimistic({
 *     apply:    () => row.classList.add('v3-row-accepted'),
 *     rollback: () => row.classList.remove('v3-row-accepted'),
 *     commit:   () => fetch('/api/inbox/accept', {...}).then(r => r.ok ? r : Promise.reject(r)),
 *   });
 *
 * Note: per project rule #7 (silent catch ban), this helper logs a console
 * warning on rollback so failures aren't invisible. Callers wanting silent
 * fallback can replace the warn in their own catch handler.
 */

/**
 * @template T
 * @param {{
 *   apply: () => void,
 *   rollback: () => void,
 *   commit: () => Promise<T>,
 * }} args
 * @returns {Promise<T>}
 */
export function runOptimistic(args) {
  const { apply, rollback, commit } = args;
  if (typeof apply !== 'function' || typeof rollback !== 'function' || typeof commit !== 'function') {
    return Promise.reject(new TypeError('runOptimistic requires { apply, rollback, commit } as functions'));
  }
  try {
    apply();
  } catch (err) {
    console.warn('[v3-optimistic] apply() threw — aborting before commit', err);
    return Promise.reject(err);
  }
  return Promise.resolve()
    .then(() => commit())
    .catch((err) => {
      try {
        rollback();
      } catch (rbErr) {
        console.warn('[v3-optimistic] rollback() threw', rbErr);
      }
      console.warn('[v3-optimistic] commit() rejected, rolled back', err);
      throw err;
    });
}
