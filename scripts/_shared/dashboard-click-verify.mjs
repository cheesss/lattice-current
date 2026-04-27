import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const errors = [], failures = [], passed = [];
page.on('pageerror', e => errors.push('PAGEERR: ' + e.message.slice(0,200)));
page.on('console', m => { if(m.type()==='error') errors.push('[console] ' + m.text().slice(0,200)); });
page.on('requestfailed', r => failures.push(r.url().slice(0,120)));

const check = (name, ok, detail='') => {
  const m = ok ? '✓' : '✗';
  console.log(`  ${m} ${name}${detail?' — '+detail:''}`);
  passed.push({name, ok, detail});
};

await page.goto('http://localhost:3000/event-dashboard.html', { waitUntil: 'load' });
await page.waitForTimeout(8000);

// ─── HOME ───
console.log('\n━━ HOME ━━');
const home = await page.evaluate(() => ({
  trustChunks: document.querySelectorAll('.tstrip-chunk').length,
  hotEventsRows: document.querySelectorAll('#hot-events-rows .evidence-row').length,
  themeSpectrum: document.querySelectorAll('.theme-spectrum-strip .ts-seg').length,
  transitions: document.querySelectorAll('#recent-transitions-standalone .tag').length,
  geoCountries: document.querySelectorAll('.geo-pressure-row, [class*="country"]').length,
  alerts: document.querySelectorAll('[id*="structural-alerts"] [class*="alert"], [class*="alert-card"]').length,
  triageItems: document.querySelectorAll('#discovery-triage .interactive-row').length,
  approvalItems: document.querySelectorAll('#approval-list .approval-item, #approval-queue-body .approval-row').length,
  loadingWithSkeleton: (() => {
    let count = 0;
    for (const el of document.querySelectorAll('.loading')) {
      const s = getComputedStyle(el);
      if (s.animationName === 'lat-sk-sweep' && el.children.length > 0) count++;
    }
    return count;
  })(),
}));
check('Trust strip 4 chunks', home.trustChunks >= 4, home.trustChunks);
check('Hot events 1+ rows (filter applied)', home.hotEventsRows > 0, home.hotEventsRows);
check('Theme spectrum segments', home.themeSpectrum > 0, home.themeSpectrum);
check('Recent transitions clickable', home.transitions > 0, home.transitions);
check('Triage items', home.triageItems > 0, home.triageItems);
check('NO skeleton over content (CSS fix)', home.loadingWithSkeleton === 0, home.loadingWithSkeleton + ' broken');

// ─── DECISION INBOX ───
console.log('\n━━ DECISION INBOX ━━');
await page.evaluate(() => window.switchSurface('inbox'));
await page.waitForTimeout(4000);
const inbox = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('#inbox-list .inbox-item'));
  return { count: items.length, types: [...new Set(items.map(it => it.querySelector('.trust-chip')?.textContent?.trim()))] };
});
check('Inbox 1+ items (no stuck Loading...)', inbox.count > 0, inbox.count + ' items');
check('Inbox has multiple types', inbox.types.length >= 2, inbox.types.join(','));

if (inbox.count > 0) {
  await page.locator('#inbox-list .inbox-item').first().click();
  await page.waitForTimeout(800);
  const proof = await page.evaluate(() => {
    const card = document.getElementById('selected-proof-card');
    return {
      text: card?.innerText?.replace(/\s+/g,' ').slice(0,200),
      hasEmptyChain: /DIRECTION\s+--/.test(card?.innerText||''),
    };
  });
  check('Proof card type-aware (no empty DIRECTION--UPLIFT--)', !proof.hasEmptyChain, proof.text.slice(0,80));
}

// ─── INVESTIGATE / AI LAB ───
console.log('\n━━ INVESTIGATE / AI LAB ━━');
await page.evaluate(() => window.switchSurface('investigate'));
await page.waitForTimeout(8000);
await page.evaluate(() => document.getElementById('ai-event-timeline')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(500);

const ail = await page.evaluate(() => ({
  timelineDots: document.querySelectorAll('#ai-event-timeline .tl-dot').length,
  scatterPts: document.querySelectorAll('#corr-breaks-body .cs-pt').length,
  scenarioInputs: document.querySelectorAll('#scenario-lab input[type=range]').length,
  scenarioPredictions: document.querySelectorAll('.scenario-pred-row').length,
  dossierBody: document.getElementById('dossier-body')?.innerText?.length || 0,
}));
check('Timeline 100+ dots', ail.timelineDots >= 100, ail.timelineDots);
check('Scatter has points', ail.scatterPts > 0, ail.scatterPts);
check('Scenario sliders 3', ail.scenarioInputs === 3, ail.scenarioInputs);
check('Scenario predictions', ail.scenarioPredictions > 0, ail.scenarioPredictions);
check('Asset dossier rendered', ail.dossierBody > 100, ail.dossierBody + ' chars');

// Hover a timeline dot — verify tooltip
const firstDot = await page.$('#ai-event-timeline .tl-dot');
if (firstDot) {
  // Dispatch synthetic mousemove because real hover can be intercepted by
  // overlapping dots when many circles share the same x position.
  await firstDot.evaluate(d => {
    const box = d.getBoundingClientRect();
    d.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.x + box.width/2, clientY: box.y + box.height/2 }));
  });
  await page.waitForTimeout(250);
  const tip = await page.evaluate(() => {
    const t = document.querySelector('#ai-event-timeline .ai-tl-tip');
    return { show: t?.classList?.contains('show'), text: t?.innerText?.slice(0,160) };
  });
  check('Timeline dot hover tooltip', tip.show === true, tip.text?.replace(/\s+/g,' ').slice(0,60));
  await page.mouse.move(10, 10);
}

// Hover a scatter point
const firstPt = await page.$('#corr-breaks-body .cs-pt');
if (firstPt) {
  await firstPt.hover();
  await page.waitForTimeout(250);
  const tip = await page.evaluate(() => {
    const t = document.querySelector('#corr-breaks-body .cs-tip');
    return { show: t?.classList?.contains('show'), text: t?.innerText?.slice(0,100) };
  });
  check('Scatter hover tooltip', tip.show === true, tip.text?.replace(/\s+/g,' ').slice(0,60));
}

// Move VIX slider — verify scenario predictions update
const vixSlider = page.locator('#scenario-vix');
if (await vixSlider.isVisible().catch(()=>false)) {
  const before = await page.evaluate(() => document.querySelector('.scenario-predictions')?.innerText?.slice(0,50));
  await page.evaluate(() => {
    const el = document.getElementById('scenario-vix');
    el.value = '32'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    regime: document.getElementById('scenario-regime-badge')?.textContent,
    predFirst: document.querySelector('.scenario-predictions')?.innerText?.slice(0,50),
  }));
  check('VIX 32 triggers regime change', /crisis|risk-off/i.test(after.regime || ''), after.regime);
  check('Predictions changed after slider', before !== after.predFirst, '');
}

// ─── GEO ───
console.log('\n━━ GEO LENS ━━');
await page.evaluate(() => window.switchSurface('geo'));
await page.waitForTimeout(7000);
const geo = await page.evaluate(() => {
  const frame = document.getElementById('geo-lens-frame');
  if (!frame?.contentDocument) return { ok: false };
  const fd = frame.contentDocument;
  return {
    canvases: fd.querySelectorAll('canvas').length,
    canvasSize: (() => { const c = fd.querySelector('canvas'); return c ? `${c.width}x${c.height}` : null; })(),
    deckGl: !!fd.defaultView?.deck,
  };
});
check('Geo iframe loaded with DeckGL canvas', geo.canvases > 0, geo.canvasSize);

// ─── OPS ───
console.log('\n━━ OPS ━━');
await page.evaluate(() => window.switchSurface('ops'));
await page.waitForTimeout(5000);
const ops = await page.evaluate(() => ({
  budget: document.getElementById('automation-budget')?.innerText?.slice(0,80),
  health: document.getElementById('operator-health')?.innerText?.slice(0,80),
  dataQuality: document.getElementById('operator-data-quality')?.innerText?.slice(0,80),
  runtimeIssues: document.getElementById('runtime-issues-list')?.innerText?.slice(0,80),
}));
check('Ops health card has content', ops.health?.length > 10, ops.health);
check('Ops budget card has content', ops.budget?.length > 10, ops.budget?.slice(0,60));
check('Ops data quality has content', ops.dataQuality?.length > 10, ops.dataQuality?.slice(0,60));

// ─── META MODEL HEALTH ───
console.log('\n━━ META MODEL HEALTH ━━');
const metaHealth = await page.evaluate(async () => {
  const r = await fetch('http://127.0.0.1:46200/api/meta-model-health');
  const d = await r.json();
  return {
    hasEval: d.summary?.hasEvalTable,
    hasPred: d.summary?.hasPredictionsTable,
    recent: d.summary?.recentPredictions?.recentCount,
    level: d.summary?.level,
  };
});
check('Meta-model has eval', metaHealth.hasEval === true);
check('Meta-model has predictions', metaHealth.hasPred === true);
check('Recent predictions populated', metaHealth.recent > 100, metaHealth.recent);

console.log('\n━━ ERRORS ━━');
console.log('console errors:', errors.length);
for (const e of errors.slice(0, 8)) console.log('  ', e);
console.log('failed reqs:', failures.length);
for (const f of failures.slice(0, 5)) console.log('  ', f);

console.log('\n━━ SUMMARY ━━');
const ok = passed.filter(p => p.ok).length;
console.log(`PASSED: ${ok} / ${passed.length}`);
if (passed.some(p => !p.ok)) {
  console.log('FAILED:');
  for (const p of passed.filter(x => !x.ok)) console.log(`  ✗ ${p.name} — ${p.detail}`);
}
await browser.close();
process.exit(ok === passed.length && errors.length === 0 ? 0 : 1);
