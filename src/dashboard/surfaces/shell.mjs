import { ensureModernSurfaceStylesheet } from './surface-primitives.mjs';

const SURFACE_COPY = {
  home: {
    kicker: 'Signal Loop',
    title: 'Signals',
    copy: 'Rank live signals first. Brief, validate, or watch only after the signal has a clear next action.',
  },
  inbox: {
    kicker: 'Decision Queue',
    title: 'Decision Inbox',
    copy: 'Review lanes separate research backfill, source governance, canonical proposals, and E2 signal review.',
  },
  investigate: {
    kicker: 'Evidence Workbench',
    title: 'Investigate',
    copy: 'Read theme evidence, regime context, and scenario sensitivity without exposing raw queue mechanics.',
  },
  geo: {
    kicker: 'Context Lens',
    title: 'Geo Lens',
    copy: 'Use the map as spatial context for selected themes and reports, not as a competing primary surface.',
  },
  ops: {
    kicker: 'Operate',
    title: 'Operations',
    copy: 'Inspect runtime health, source quality, approval state, and report backfill closure.',
  },
};

function applySurfaceContext(surface) {
  const copy = SURFACE_COPY[surface] || SURFACE_COPY.home;
  const kicker = document.getElementById('surface-context-kicker');
  const title = document.getElementById('surface-context-title');
  const body = document.getElementById('surface-context-copy');
  if (kicker) kicker.textContent = copy.kicker;
  if (title) title.textContent = copy.title;
  if (body) body.textContent = copy.copy;
}

function enhanceSurfaceNav() {
  document.querySelectorAll('.surface-nav-btn').forEach((button) => {
    const surface = button.getAttribute('data-surface') || '';
    const copy = SURFACE_COPY[surface];
    if (!copy) return;
    button.setAttribute('title', `${copy.title}: ${copy.copy}`);
  });
}

function wrapSwitchSurface() {
  const original = window.switchSurface;
  if (typeof original !== 'function' || original.__modernWrapped) return;
  const wrapped = function modernSwitchSurface(surface, ...args) {
    const result = original.call(this, surface, ...args);
    applySurfaceContext(surface);
    window.dispatchEvent(new CustomEvent('lattice:surface-changed', { detail: { surface } }));
    return result;
  };
  wrapped.__modernWrapped = true;
  window.switchSurface = wrapped;
}

function normalizeVisibleText(value) {
  return String(value || '')
    .replace(/\s*쨌\s*/g, ' · ')
    .replace(/\s*\?\?\s*/g, ' — ')
    .replace(/\s+·\s+/g, ' · ')
    .replace(/\s+—\s+/g, ' — ');
}

function sanitizeVisibleCopy(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('script, style, pre, code, textarea')) return NodeFilter.FILTER_REJECT;
      return /쨌|\?\?/.test(node.nodeValue || '')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const next = normalizeVisibleText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  });
}

function normalizeSurfaceNavCount() {
  const count = document.getElementById('inbox-total-count');
  if (!count) return;
  const text = normalizeVisibleText(count.textContent || '').trim();
  const numeric = text.match(/\b(\d{1,4})\b(?!.*\b\d{1,4}\b)/)?.[1];
  const next = numeric || (text.includes('...') || /inbox|ago/i.test(text) ? '...' : text.slice(0, 4));
  if (count.dataset.modernCompactText === next && count.textContent.trim() === next) return;
  count.dataset.modernCompactText = next;
  count.textContent = next;
}

function installCopySanitizer() {
  if (window.__modernCopySanitizerInstalled) return;
  window.__modernCopySanitizerInstalled = true;
  sanitizeVisibleCopy();
  normalizeSurfaceNavCount();
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        const next = normalizeVisibleText(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      } else {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const next = normalizeVisibleText(node.nodeValue);
            if (next !== node.nodeValue) node.nodeValue = next;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            sanitizeVisibleCopy(node);
          }
        });
      }
    });
    normalizeSurfaceNavCount();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function installModernShell() {
  ensureModernSurfaceStylesheet();
  document.documentElement.dataset.visualSystem = 'modern-cyan-cockpit';
  enhanceSurfaceNav();
  wrapSwitchSurface();
  applySurfaceContext(document.body?.dataset?.surface || 'home');
  installCopySanitizer();
}
