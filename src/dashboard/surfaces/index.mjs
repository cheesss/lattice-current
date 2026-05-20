import { deferUntilIdle } from '../shared/dom-utils.mjs';
import { installDecisionInboxSurface } from './decision-inbox.mjs';
import { installReportBackfillSurface } from './report-backfill.mjs';
import { installModernShell } from './shell.mjs';

function installModernSurfaces() {
  installModernShell();
  installDecisionInboxSurface();
  installReportBackfillSurface();
}

deferUntilIdle(installModernSurfaces, 400);

window.addEventListener('lattice:surface-changed', (event) => {
  const surface = event?.detail?.surface;
  if (surface === 'inbox') installDecisionInboxSurface();
  if (surface === 'investigate' || surface === 'ops') installReportBackfillSurface();
});
