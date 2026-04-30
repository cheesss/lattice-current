/**
 * S-Tier A5 — first-user onboarding tour.
 *
 * Renders a small modal overlay with 5 steps the first time a user opens
 * the dashboard. Skips silently on subsequent loads (localStorage flag
 * 'lattice-onboarded'). User can dismiss with Skip or finish through
 * Next-Next-Done.
 *
 * Loaded from event-dashboard.html via:
 *   <script type="module" src="/src/dashboard/sl-onboarding.mjs"></script>
 *
 * Design note: this is intentionally a one-time modal, NOT a continuous
 * coachmark / spotlight. Spotlight overlays on a 7,971-line dashboard with
 * dynamic surfaces would require positional anchors that break across
 * resize / surface switch. A single modal that explains the system is a
 * better fit until the dashboard split (G2 PR 3) lands.
 */

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

function $(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function ensureOnboardingStyles() {
  if (document.getElementById('sl-onboarding-styles')) return;
  const style = $('style', { id: 'sl-onboarding-styles' });
  style.textContent = `
    .sl-onb-backdrop{position:fixed;inset:0;background:rgba(7,8,10,.78);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:center;justify-content:center;animation:sl-onb-fade .25s ease-out}
    .sl-onb-modal{width:min(540px,calc(100vw - 32px));background:var(--bg-surface,#13161d);border:1px solid var(--border-base,rgba(255,255,255,.1));border-radius:18px;padding:28px;color:var(--text-loud,rgba(255,255,255,.95));font-family:var(--font-sans,'Geist',Inter,system-ui,sans-serif);box-shadow:0 32px 80px rgba(0,0,0,.5)}
    .sl-onb-eyebrow{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent,#d8f99d);margin-bottom:10px}
    .sl-onb-title{font-size:22px;font-weight:600;margin-bottom:14px;line-height:1.2}
    .sl-onb-body{font-size:14px;line-height:1.55;color:var(--text-base,rgba(255,255,255,.85));margin-bottom:14px}
    .sl-onb-hint{font-size:12px;color:var(--text-soft,rgba(255,255,255,.55));font-family:var(--font-mono,'JetBrains Mono',Consolas,monospace);padding:8px 10px;background:rgba(255,255,255,.04);border-radius:8px;border:1px solid var(--border-dim,rgba(255,255,255,.04));margin-bottom:18px}
    .sl-onb-foot{display:flex;justify-content:space-between;align-items:center;gap:12px}
    .sl-onb-progress{display:flex;gap:6px}
    .sl-onb-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.15)}
    .sl-onb-dot.active{background:var(--accent,#d8f99d)}
    .sl-onb-actions{display:flex;gap:10px}
    .sl-onb-btn{appearance:none;border:1px solid var(--border-base,rgba(255,255,255,.12));background:transparent;color:var(--text-loud,rgba(255,255,255,.9));font-family:inherit;font-size:13px;padding:9px 18px;border-radius:999px;cursor:pointer;font-weight:500;transition:background .15s ease,border-color .15s ease}
    .sl-onb-btn:hover{background:rgba(255,255,255,.06)}
    .sl-onb-btn.primary{background:var(--accent,#d8f99d);color:var(--bg-void,#07080a);border-color:var(--accent,#d8f99d)}
    .sl-onb-btn.primary:hover{filter:brightness(1.08)}
    .sl-onb-skip{background:transparent;border:0;color:var(--text-soft,rgba(255,255,255,.4));font-size:11px;padding:0;cursor:pointer;font-family:inherit}
    .sl-onb-skip:hover{color:var(--text-loud,rgba(255,255,255,.9))}
    @keyframes sl-onb-fade{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
  `;
  document.head.appendChild(style);
}

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
  ensureOnboardingStyles();
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

if (typeof window !== 'undefined') {
  // Defer to after the dashboard's heavy boot finishes.
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (shouldShow()) start();
      }, 2000);
    }, { once: true });
  } else {
    setTimeout(() => {
      if (shouldShow()) start();
    }, 2000);
  }
}

export { start as startOnboarding, STEPS };
