/**
 * Lightweight DOM Diffing Utility
 *
 * Provides morphdom-style DOM patching without external dependencies.
 * Instead of replacing innerHTML (which destroys focus, scroll, selection),
 * this module patches the existing DOM tree to match the desired HTML string.
 *
 * Usage:
 *   patchContent(container, newHtmlString);
 *
 * Strategy:
 *  1. Parse the new HTML into a temporary container
 *  2. Reconcile children: keyed matching → type matching → insert/remove
 *  3. Patch attributes and text nodes in-place
 *
 * This preserves event listeners, focus, and scroll positions for
 * nodes that haven't structurally changed.
 */

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Patch an existing container's children to match the given HTML.
 * Returns `true` if any changes were made.
 */
export function patchContent(container: HTMLElement, newHtml: string): boolean {
  const template = document.createElement('template');
  template.innerHTML = newHtml;
  return reconcileChildren(container, template.content);
}

/**
 * Patch one existing element to match a new element (in-place).
 */
export function patchElement(existing: Element, desired: Element): void {
  syncAttributes(existing, desired);
  reconcileChildren(existing, desired);
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

/** A key extractor — prefers data-key, falls back to id. */
function getKey(node: Node): string | null {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  return el.getAttribute('data-key') || el.id || null;
}

function reconcileChildren(parent: Node, desired: Node): boolean {
  let changed = false;
  const oldChildren = Array.from(parent.childNodes);
  const newChildren = Array.from(desired.childNodes);

  // Build key → old-child map
  const oldKeyMap = new Map<string, Node>();
  for (const child of oldChildren) {
    const key = getKey(child);
    if (key) oldKeyMap.set(key, child);
  }

  let oldIdx = 0;

  for (let newIdx = 0; newIdx < newChildren.length; newIdx++) {
    const newChild = newChildren[newIdx]!;
    const newKey = getKey(newChild);

    // Try keyed match first
    if (newKey && oldKeyMap.has(newKey)) {
      const oldKeyed = oldKeyMap.get(newKey)!;
      if (oldKeyed !== oldChildren[oldIdx]) {
        parent.insertBefore(oldKeyed, oldChildren[oldIdx] ?? null);
        changed = true;
      }
      patchNode(oldKeyed, newChild);
      oldIdx++;
      continue;
    }

    // Positional match
    const oldChild = oldChildren[oldIdx];
    if (!oldChild) {
      // Append new node
      parent.appendChild(newChild.cloneNode(true));
      changed = true;
      continue;
    }

    if (isSameKind(oldChild, newChild)) {
      patchNode(oldChild, newChild);
      oldIdx++;
    } else {
      // Replace
      const clone = newChild.cloneNode(true);
      parent.insertBefore(clone, oldChild);
      changed = true;
      // Don't advance oldIdx — the old node is now "extra"
    }
  }

  // Remove excess old children
  while (oldIdx < oldChildren.length) {
    const excess = oldChildren[oldIdx];
    if (excess && excess.parentNode === parent) {
      parent.removeChild(excess);
      changed = true;
    }
    oldIdx++;
  }

  return changed;
}

function patchNode(existing: Node, desired: Node): void {
  if (existing.nodeType === Node.TEXT_NODE && desired.nodeType === Node.TEXT_NODE) {
    if (existing.textContent !== desired.textContent) {
      existing.textContent = desired.textContent;
    }
    return;
  }

  if (existing.nodeType === Node.ELEMENT_NODE && desired.nodeType === Node.ELEMENT_NODE) {
    syncAttributes(existing as Element, desired as Element);
    reconcileChildren(existing, desired);
  }
}

function isSameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === Node.ELEMENT_NODE) {
    return (a as Element).tagName === (b as Element).tagName;
  }
  return true;
}

function syncAttributes(existing: Element, desired: Element): void {
  // Add/update attributes
  const desiredAttrs = desired.attributes;
  for (let i = 0; i < desiredAttrs.length; i++) {
    const attr = desiredAttrs[i]!;
    if (existing.getAttribute(attr.name) !== attr.value) {
      existing.setAttribute(attr.name, attr.value);
    }
  }

  // Remove stale attributes
  const existingAttrs = existing.attributes;
  for (let i = existingAttrs.length - 1; i >= 0; i--) {
    const attr = existingAttrs[i]!;
    if (!desired.hasAttribute(attr.name)) {
      existing.removeAttribute(attr.name);
    }
  }
}
