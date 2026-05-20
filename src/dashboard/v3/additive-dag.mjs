/**
 * V3 Phase 3 — Matched-control DAG (additive)
 *
 * Renders a static SVG showing a treatment event on the left and the
 * matched control set on the right, with edges labeled by score.
 *
 *   mountMatchedDag(host, {
 *     event:    { id, label, date? },
 *     controls: [{ id, label, score, date? }, ...],
 *   })
 *
 * Layout is hand-rolled — d3-dag is too heavy for this static case.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const NODE_W = 168;
const NODE_H = 44;
const COL_GAP = 220;
const ROW_GAP = 14;
const PAD = 12;

function makeText(content, attrs) {
  const t = document.createElementNS(SVG_NS, 'text');
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, String(v));
  t.textContent = content;
  return t;
}

function makeRectNode(x, y, label, sublabel, isTreatment) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', `v3-dag-node ${isTreatment ? 'v3-dag-node-treatment' : 'v3-dag-node-control'}`);
  g.setAttribute('transform', `translate(${x},${y})`);

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('width', String(NODE_W));
  rect.setAttribute('height', String(NODE_H));
  rect.setAttribute('rx', '8');
  rect.setAttribute('ry', '8');
  rect.setAttribute('fill', 'var(--v3-bg-850)');
  rect.setAttribute('stroke', isTreatment ? 'var(--v3-lane-validated)' : 'var(--v3-border-soft)');
  rect.setAttribute('stroke-width', isTreatment ? '1.6' : '1');
  g.appendChild(rect);

  g.appendChild(
    makeText(String(label ?? ''), {
      x: 10,
      y: 18,
      fill: 'var(--v3-text-loud)',
      'font-size': '12',
      'font-weight': '600',
    }),
  );
  if (sublabel) {
    g.appendChild(
      makeText(String(sublabel), {
        x: 10,
        y: 33,
        fill: 'var(--v3-text-soft)',
        'font-size': '10',
        class: 'v3-num',
      }),
    );
  }
  return g;
}

function makeEdge(x1, y1, x2, y2, score) {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'v3-dag-edge');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('stroke', 'var(--v3-border-strong)');
  line.setAttribute('stroke-width', '1');
  line.setAttribute('stroke-linecap', 'round');
  group.appendChild(line);

  if (Number.isFinite(score)) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 4;
    const text = makeText(formatScore(score), {
      x: midX,
      y: midY,
      'text-anchor': 'middle',
      fill: 'var(--v3-text-base)',
      'font-size': '10',
      class: 'v3-num',
    });
    group.appendChild(text);
  }
  return group;
}

function formatScore(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return '';
  if (n >= 0 && n <= 1) return n.toFixed(2);
  return n.toFixed(1);
}

/**
 * @param {Element} host
 * @param {{ event: any, controls: any[] }} payload
 * @returns {() => void} cleanup
 */
export function mountMatchedDag(host, payload) {
  if (!host) return () => {};
  host.textContent = '';

  const event = payload && payload.event ? payload.event : null;
  const controls = Array.isArray(payload && payload.controls) ? payload.controls : [];

  if (!event || controls.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'v3-dag v3-dag-empty';
    empty.textContent = 'No matched controls to render.';
    host.appendChild(empty);
    return () => {
      if (empty.parentNode === host) host.removeChild(empty);
    };
  }

  const totalH = PAD * 2 + controls.length * NODE_H + Math.max(0, controls.length - 1) * ROW_GAP;
  const totalW = PAD * 2 + NODE_W * 2 + COL_GAP;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'v3-dag');
  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(totalH));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `matched controls for ${event.label ?? event.id ?? 'event'}`);

  // Treatment node — vertically centered against the control column.
  const treatmentX = PAD;
  const treatmentY = Math.max(PAD, (totalH - NODE_H) / 2);
  const treatmentRight = treatmentX + NODE_W;
  const treatmentMidY = treatmentY + NODE_H / 2;

  for (let i = 0; i < controls.length; i += 1) {
    const ctrl = controls[i];
    const cx = treatmentX + NODE_W + COL_GAP;
    const cy = PAD + i * (NODE_H + ROW_GAP);
    const cMidY = cy + NODE_H / 2;
    svg.appendChild(makeEdge(treatmentRight, treatmentMidY, cx, cMidY, Number(ctrl.score)));
  }

  // Nodes drawn after edges so they sit on top.
  svg.appendChild(
    makeRectNode(
      treatmentX,
      treatmentY,
      event.label ?? event.id ?? 'event',
      event.date ?? null,
      true,
    ),
  );

  for (let i = 0; i < controls.length; i += 1) {
    const ctrl = controls[i];
    const cx = treatmentX + NODE_W + COL_GAP;
    const cy = PAD + i * (NODE_H + ROW_GAP);
    svg.appendChild(makeRectNode(cx, cy, ctrl.label ?? ctrl.id ?? `control ${i + 1}`, ctrl.date ?? null, false));
  }

  host.appendChild(svg);
  return () => {
    if (svg.parentNode === host) host.removeChild(svg);
  };
}

/* Smoke harness (manual):
 *   mountMatchedDag(host, {
 *     event: { id: 'evt-1', label: 'AI selloff', date: '2026-04-12' },
 *     controls: [
 *       { id: 'c-1', label: 'Mar 04 baseline', score: 0.92, date: '2026-03-04' },
 *       { id: 'c-2', label: 'Feb 18 baseline', score: 0.88, date: '2026-02-18' },
 *     ],
 *   });
 */
