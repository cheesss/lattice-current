/**
 * Standardised JSON-API route helper.
 *
 * Almost every route in scripts/event-dashboard-api.mjs followed this shape:
 *
 *   try {
 *     const payload = await build...();
 *     return buildJsonResponse(payload, ...);
 *   } catch (err) {
 *     logger.warn('<route> route failed', { error: String(err?.message || err) });
 *     return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
 *   }
 *
 * 17 routes shared this boilerplate — same try/catch, same logger.warn,
 * same 500 envelope. This helper deduplicates it.
 *
 * Usage:
 *   const r = await routeHandler('hot-events', logger, async () => {
 *     const payload = await buildHotEventsPayload(getPool(), opts);
 *     return { payload, statusCode: payload?.summary?.level === 'critical' ? 503 : 200 };
 *   });
 *   return buildJsonResponse(r.body, r.status);
 *
 * The handler returns either:
 *   { payload, statusCode? }   — success path; status defaults to 200
 *   a primitive payload         — wrapped as { payload }
 *   throws                      — caught, logged, returns 500 envelope
 */

export async function runRoute({ name, logger, build, buildJsonResponse }) {
  if (typeof build !== 'function') {
    return buildJsonResponse({ ok: false, error: `route ${name} build is not a function` }, 500);
  }
  try {
    const result = await build();
    if (result == null) {
      return buildJsonResponse({ ok: false, error: `route ${name} returned null` }, 500);
    }
    if (typeof result === 'object' && result.payload !== undefined) {
      return buildJsonResponse(result.payload, result.statusCode ?? 200);
    }
    return buildJsonResponse(result, 200);
  } catch (err) {
    const errorMessage = String(err?.message || err);
    if (logger?.warn) {
      logger.warn(`${name} route failed`, { error: errorMessage });
    }
    return buildJsonResponse(
      {
        ok: false,
        error: errorMessage,
        generatedAt: new Date().toISOString(),
      },
      500,
    );
  }
}

/**
 * Convenience factory bound to a logger + buildJsonResponse so callers
 * can write `await handler('name', () => build())` without re-passing
 * the helpers every time.
 */
export function makeRouteHandler(logger, buildJsonResponse) {
  return (name, build) => runRoute({ name, logger, build, buildJsonResponse });
}
