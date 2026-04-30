/**
 * S-Tier A5 — first-user onboarding tour.
 *
 * Renders a small modal overlay with 5 steps the first time a user opens
 * the dashboard. Skips silently on subsequent loads (localStorage flag
 * 'lattice-onboarded'). User can dismiss with Skip or finish through
 * Next-Next-Done.
 *
 * Design note: this is intentionally a one-time modal, NOT a continuous
 * coachmark / spotlight. Spotlight overlays on a 7,971-line dashboard with
 * dynamic surfaces would require positional anchors that break across
 * resize / surface switch. A single modal that explains the system is a
 * better fit until the dashboard split (G2 PR 3) lands.
 */

import { el as $, ensureOverlayStylesheet, deferUntilIdle } from './shared/dom-utils.mjs';

const STORAGE_KEY = 'lattice-onboarded';
const STORAGE_VERSION = '1';

const STEPS = [
  {
    title: 'Welcome to Lattice Current',
    body: 'Validated market signals with proof, not noise. Lattice ranks news events by statistical evidence, not by Hawkes temperature alone.',
    cta: '5 surfaces, 1 minute · Next →',
  },
  {
    title: '1. Five surfaces, one workflow',
    body: 'Home shows top decisions. Decision Inbox is where you act. Investigate is the evidence workbench. Geo Lens maps signals geographically. Ops shows system health.',
    hint: 'Switch with the top tabs or press 1–5.',
    cta: 'Next →',
  },
  {
    title: '2. Lanes tell you trust',
    body: 'Validated (green) = E2+ evidence + matched controls. Pending (lime) = signal but blocked on a fixable gate. Watch (amber) = observable. Noise (gray) = below threshold — surfaced for context only.',
    hint: 'Click a card to see matched controls + |t-stat| + citations.',
    cta: 'Next →',
  },
  {
    title: '3. Decision Inbox keyboard',
    body: 'J/K to navigate items. A to accept, R to reject, S to snooze. Every action is audited (request id + body hash) and persists across refresh.',
    hint: 'Final-state items never reappear unless ?include_final=1.',
    cta: 'Next →',
  },
  {
    title: '4. Self-monitoring system',
    body: 'Look bottom-right: System Health pillars (data / pipeline / model / product) update every 60 s. Stale predictions auto-trigger a refresh task. Calibration warnings surface explicitly.',
    hint: 'The system is honest about what it does NOT know.',
    cta: 'Got it · Done',
  },
];

function markOnboarded() {
  try {
    localStorage.setItem(STORAGE_KEY, STORAGE_VERSION);
  } catch {
    /* localStorage may be blocked — fail silently */
  }
}

function shouldShow() {
  try {
    if (localStorage.getItem(STORAGE_KEY) === STORAGE_VERSION) return false;
  } catch {
    return false; // If localStorage is blocked, don't be annoying.
  }
  // Skip in iframes (e.g. preview embeds).
  if (window.self !== window.top) return false;
  // Skip on the e2e test entry — Playwright tests should not see the modal.
  if (window.location.search.includes('e2e=1')) return false;
  return true;
}

function render(stepIdx, onAdvance, onSkip) {
  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const dots = STEPS.map((_, i) => $('span', {
    class: `sl-onb-dot${i === stepIdx ? ' active' : ''}`,
  }));
  const next = $('button', {
    class: 'sl-onb-btn primary',
    type: 'button',
    onclick: () => onAdvance(),
  }, [step.cta || (isLast ? 'Done' : 'Next →')]);
  const skip = $('button', {
    class: 'sl-onb-skip',
    type: 'button',
    onclick: onSkip,
  }, ['Skip tour']);
  return $('div', { class: 'sl-onb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sl-onb-title' }, [
    $('div', { class: 'sl-onb-eyebrow' }, [`Lattice Current · Step ${stepIdx + 1} of ${STEPS.length}`]),
    $('div', { class: 'sl-onb-title', id: 'sl-onb-title' }, [step.title]),
    $('div', { class: 'sl-onb-body' }, [step.body]),
    step.hint ? $('div', { class: 'sl-onb-hint' }, [step.hint]) : null,
    $('div', { class: 'sl-onb-foot' }, [
      $('div', { class: 'sl-onb-progress' }, dots),
      $('div', { class: 'sl-onb-actions' }, [skip, next]),
    ]),
  ]);
}

function start() {
  ensureOverlayStylesheet();
  let backdrop = $('div', { class: 'sl-onb-backdrop', id: 'sl-onb-backdrop' });
  let stepIdx = 0;
  const close = () => {
    markOnboarded();
    backdrop.remove();
  };
  const advance = () => {
    if (stepIdx < STEPS.length - 1) {
      stepIdx += 1;
      const modal = render(stepIdx, advance, close);
      backdrop.replaceChildren(modal);
    } else {
      close();
    }
  };
  // Click outside the modal also dismisses (records as onboarded).
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  // Escape to dismiss.
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      advance();
    }
  };
  document.addEventListener('keydown', onKey);
  backdrop.appendChild(render(stepIdx, advance, close));
  document.body.appendChild(backdrop);
}

deferUntilIdle(() => {
  if (shouldShow()) start();
}, 2000);

export { start as startOnboarding, STEPS };
