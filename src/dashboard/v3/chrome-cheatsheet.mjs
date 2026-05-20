/**
 * V3 Phase 2 — Sidebar cheatsheet (Slack-style slide-in).
 *
 * Right-edge 320px panel that toggles on `?`. Stays mounted (not modal) so
 * the user can practice shortcuts while reading. Closes on `?` again or Esc.
 *
 * Static catalog — we do NOT reverse-engineer existing handlers.
 */

import { el } from '../shared/dom-utils.mjs';

const PANEL_ID = 'v3-cheat-root';

/**
 * @typedef {{key:string, label:string}} CheatRow
 * @typedef {{group:string, rows:CheatRow[]}} CheatGroup
 */

/** @type {CheatGroup[]} */
const CATALOG = [
  {
    group: 'Navigation',
    rows: [
      { key: 'G H', label: 'Home' },
      { key: 'G I', label: 'Decision Inbox' },
      { key: 'G V', label: 'Investigate' },
      { key: 'G M', label: 'Geo Lens' },
      { key: 'G O', label: 'Ops' },
      { key: 'Ctrl+K', label: 'Command palette' },
      { key: '?', label: 'Toggle this cheatsheet' },
    ],
  },
  {
    group: 'Inbox',
    rows: [
      { key: 'J / K', label: 'Next / previous item' },
      { key: 'A', label: 'Accept' },
      { key: 'R', label: 'Reject' },
      { key: 'S', label: 'Snooze' },
      { key: 'Space', label: 'Peek' },
      { key: 'Shift+S', label: 'Bulk simulate' },
      { key: 'Esc', label: 'Clear selection' },
    ],
  },
  {
    group: 'General',
    rows: [
      { key: 'E', label: 'Explain' },
      { key: 'Ctrl+[ / Ctrl+]', label: 'Back / forward (history stack)' },
      { key: '/', label: 'Focus search' },
      { key: 'Esc', label: 'Dismiss modal / clear focus' },
    ],
  },
];

function buildPanel() {
  const groups = CATALOG.map((g) => el('section', { class: 'v3-cheat-group' }, [
    el('h3', { class: 'v3-cheat-group-title' }, [g.group]),
    el('ul', { class: 'v3-cheat-list' }, g.rows.map((r) => el('li', { class: 'v3-cheat-row' }, [
      el('kbd', { class: 'v3-cheat-kbd' }, [r.key]),
      el('span', { class: 'v3-cheat-label' }, [r.label]),
    ]))),
  ]));

  return el('aside', {
    id: PANEL_ID,
    class: 'v3-cheat',
    role: 'complementary',
    'aria-label': 'Keyboard shortcuts',
    'aria-hidden': 'true',
    tabindex: '-1',
  }, [
    el('div', { class: 'v3-cheat-panel' }, [
      el('header', { class: 'v3-cheat-header' }, [
        el('span', { class: 'v3-cheat-title' }, ['Keyboard shortcuts']),
        el('button', {
          class: 'v3-cheat-close',
          type: 'button',
          'aria-label': 'Close cheatsheet',
          onclick: () => closePanel(),
        }, ['×']),
      ]),
      el('div', { class: 'v3-cheat-body' }, groups),
      el('footer', { class: 'v3-cheat-footer' }, [
        'Press ',
        el('kbd', { class: 'v3-cheat-kbd' }, ['?']),
        ' or ',
        el('kbd', { class: 'v3-cheat-kbd' }, ['Esc']),
        ' to dismiss.',
      ]),
    ]),
  ]);
}

function getPanel() {
  return document.getElementById(PANEL_ID);
}

function isOpen() {
  const p = getPanel();
  return !!p && p.classList.contains('is-open');
}

function openPanel() {
  const p = getPanel();
  if (!p) return;
  p.classList.add('is-open');
  p.setAttribute('aria-hidden', 'false');
}

function closePanel() {
  const p = getPanel();
  if (!p) return;
  p.classList.remove('is-open');
  p.setAttribute('aria-hidden', 'true');
}

function togglePanel() {
  if (isOpen()) closePanel();
  else openPanel();
}

/**
 * True if the keystroke originated inside an editable surface — we never
 * intercept `?` while the user is typing into a text field.
 */
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function onKeydown(ev) {
  // Don't fight modifier-shortcuts (Ctrl+/, Cmd+?, etc.).
  if (ev.ctrlKey || ev.metaKey || ev.altKey) {
    if (ev.key === 'Escape' && isOpen()) {
      closePanel();
      ev.preventDefault();
    }
    return;
  }
  if (ev.key === 'Escape') {
    if (isOpen()) {
      closePanel();
      ev.preventDefault();
    }
    return;
  }
  if (ev.key !== '?') return;
  if (isEditableTarget(ev.target)) return;
  ev.preventDefault();
  togglePanel();
}

let cheatBound = false;

export function mountCheatsheet() {
  if (typeof document === 'undefined') return;
  if (getPanel()) return; // already mounted
  document.body.appendChild(buildPanel());
  if (!cheatBound) {
    cheatBound = true;
    document.addEventListener('keydown', onKeydown);
  }
}
