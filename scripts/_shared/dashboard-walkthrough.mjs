import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const SCREEN_DIR = 'tmp-screenshots/walkthrough';
await fs.mkdir(SCREEN_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();

const observations = [];
const note = (kind, msg) => { console.log(`[${kind}] ${msg}`); observations.push({ kind, msg }); };

const consoleErrs = [];
const reqFails = [];
page.on('pageerror', err => consoleErrs.push('PAGEERR: ' + err.message.slice(0,200)));
page.on('console', msg => { if (msg.type() === 'error') consoleErrs.push('[err] ' + msg.text().slice(0,200)); });
page.on('requestfailed', req => reqFails.push(req.url().slice(0,120) + ' ' + (req.failure()?.errorText||'')));

// ─────────────────────────────────────────────────────────────────────
// 1. OpenClaw Web UI
// ─────────────────────────────────────────────────────────────────────
console.log('\n═══ 1. OpenClaw Web UI (http://127.0.0.1:18789) ═══');
await page.goto('http://127.0.0.1:18789/', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SCREEN_DIR}/01-openclaw-home.png`, fullPage: false });
const ocText = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,800));
note('openclaw', 'home text snippet: ' + ocText.slice(0,300));

// Look for Lattice plugin link
const latticeLinks = await page.$$eval('a, button', els =>
  els.filter(el => /lattice/i.test(el.textContent || el.getAttribute('href') || ''))
     .slice(0,5)
     .map(el => ({ tag: el.tagName, text: (el.textContent||'').trim().slice(0,80), href: el.getAttribute('href') }))
);
note('openclaw', 'Lattice nav items found: ' + latticeLinks.length + ' — ' + JSON.stringify(latticeLinks).slice(0,300));

// ─────────────────────────────────────────────────────────────────────
// 2. Lattice Dashboard — Home
// ─────────────────────────────────────────────────────────────────────
console.log('\n═══ 2. Lattice — Home surface ═══');
await page.goto('http://localhost:3000/event-dashboard.html', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(8000); // let refreshAll() complete

const home = await page.evaluate(() => {
  const surfaces = ['home','inbox','investigate','geo','ops'];
  const tabs = surfaces.map(s => {
    const btn = document.querySelector(`.surface-nav-btn[data-surface="${s}"]`);
    return { surface: s, label: btn?.textContent?.trim()?.slice(0,80), exists: !!btn };
  });
  const trustChips = Array.from(document.querySelectorAll('.tstrip-chunk')).map(c => ({
    label: c.querySelector('.tstrip-label')?.textContent?.trim(),
    score: c.querySelector('.tstrip-score')?.textContent?.trim(),
    state: c.getAttribute('data-state'),
  }));
  const sinceLabel = document.querySelector('.lattice-since-strip')?.innerText?.replace(/\s+/g,' ').slice(0,200);
  const hotEventsCount = document.querySelectorAll('#hot-events-rows .evidence-row').length;
  const goldStrip = document.querySelector('.lattice-gold-strip')?.innerText?.replace(/\s+/g,' ').slice(0,200);
  const themeSpectrum = document.querySelectorAll('.theme-spectrum-strip .ts-seg').length;
  const transitions = document.querySelectorAll('#recent-transitions-standalone .tag').length;
  const bodyHasError = /failed|error/i.test(document.body.innerText);
  return { tabs, trustChips, sinceLabel, hotEventsCount, goldStrip, themeSpectrum, transitions, bodyHasError };
});
note('home', 'tabs: ' + home.tabs.map(t => `${t.surface}=${t.label}`).join(' | '));
note('home', 'trust chunks: ' + JSON.stringify(home.trustChips));
note('home', 'since strip: ' + home.sinceLabel);
note('home', 'hot events rows: ' + home.hotEventsCount);
note('home', 'gold strip: ' + (home.goldStrip||'(none)').slice(0,180));
note('home', 'theme spectrum segs: ' + home.themeSpectrum + ' | recent transitions: ' + home.transitions);
note('home', 'body mentions failed/error: ' + home.bodyHasError);
await page.screenshot({ path: `${SCREEN_DIR}/02-home-top.png`, fullPage: false });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(800);
await page.screenshot({ path: `${SCREEN_DIR}/03-home-bottom.png`, fullPage: false });

// ─────────────────────────────────────────────────────────────────────
// 3. Decision Inbox
// ─────────────────────────────────────────────────────────────────────
console.log('\n═══ 3. Decision Inbox ═══');
await page.evaluate(() => window.switchSurface('inbox'));
await page.waitForTimeout(5000);
const inbox = await page.evaluate(() => {
  const list = document.getElementById('inbox-list');
  const items = Array.from(document.querySelectorAll('#inbox-list .inbox-item')).slice(0,5).map(el => ({
    type: el.querySelector('.trust-chip')?.textContent?.trim(),
    title: el.querySelector('.inbox-item-title')?.textContent?.slice(0,80),
    meta: el.querySelector('.inbox-item-meta')?.textContent?.slice(0,80),
  }));
  return {
    listText: list?.innerText?.replace(/\s+/g,' ').slice(0,200),
    itemCount: document.querySelectorAll('#inbox-list .inbox-item').length,
    sample: items,
    counts: {
      total: document.getElementById('inbox-total-count')?.textContent,
      e2: document.getElementById('e2-queue-count')?.textContent,
    },
    bulkSimulate: document.getElementById('inbox-bulk-simulate')?.disabled,
  };
});
note('inbox', 'count: total=' + inbox.counts.total + ' e2=' + inbox.counts.e2);
note('inbox', 'items shown: ' + inbox.itemCount);
note('inbox', 'samples: ' + JSON.stringify(inbox.sample).slice(0,400));
note('inbox', 'list text fallback: ' + inbox.listText);
note('inbox', 'bulk simulate disabled at zero selection: ' + inbox.bulkSimulate);
await page.screenshot({ path: `${SCREEN_DIR}/04-inbox.png`, fullPage: false });

// Try clicking first item to verify proof card preview works
if (inbox.itemCount > 0) {
  await page.locator('#inbox-list .inbox-item').first().click();
  await page.waitForTimeout(800);
  const proof = await page.evaluate(() => {
    const sel = document.getElementById('inbox-selected-proof') || document.querySelector('[id*="proof"]');
    return { text: sel?.innerText?.replace(/\s+/g,' ').slice(0,300), html: sel?.innerHTML?.length };
  });
  note('inbox', 'proof preview after click: ' + proof.text);
  await page.screenshot({ path: `${SCREEN_DIR}/05-inbox-proof.png`, fullPage: false });
}

// ─────────────────────────────────────────────────────────────────────
// 4. Investigate (AI Lab is here)
// ─────────────────────────────────────────────────────────────────────
console.log('\n═══ 4. Investigate / AI Lab ═══');
await page.evaluate(() => window.switchSurface('investigate'));
await page.waitForTimeout(7000);
const investigate = await page.evaluate(() => ({
  surfaceText: document.querySelector('.surface[data-surface="investigate"]')?.innerText?.replace(/\s+/g,' ').slice(0,400),
  timelineEvents: document.querySelectorAll('#ai-event-timeline .tl-dot').length,
  scatterPoints: document.querySelectorAll('#corr-breaks-body .cs-pt').length,
  scenarioInputs: document.querySelectorAll('#scenario-lab input').length,
  digestText: document.getElementById('digest-body')?.innerText?.slice(0,200),
  dossierHtml: document.getElementById('asset-dossier-body')?.innerHTML?.length || 0,
  loadingCount: document.querySelectorAll('.surface[data-surface="investigate"] .loading').length,
}));
note('investigate', 'timeline dots: ' + investigate.timelineEvents);
note('investigate', 'corr scatter pts: ' + investigate.scatterPoints);
note('investigate', 'scenario sliders: ' + investigate.scenarioInputs);
note('investigate', 'digest preview: ' + investigate.digestText);
note('investigate', 'asset dossier html len: ' + investigate.dossierHtml);
note('investigate', 'still-loading widgets: ' + investigate.loadingCount);
await page.evaluate(() => document.getElementById('ai-event-timeline')?.scrollIntoView({block:'start'}));
await page.waitForTimeout(400);
await page.screenshot({ path: `${SCREEN_DIR}/06-investigate-ai-lab.png`, fullPage: false });

// ─────────────────────────────────────────────────────────────────────
// 5. Geo Lens
// ─────────────────────────────────────────────────────────────────────
console.log('\n═══ 5. Geo Lens ═══');
await page.evaluate(() => window.switchSurface('geo'));
await page.waitForTimeout(7000);
const geo = await page.evaluate(() => {
  const frame = document.getElementById('geo-lens-frame');
  if (!frame) return { exists: false };
  let inner = null;
  try {
    inner = {
      title: frame.contentDocument?.title,
      bodyTextSnippet: frame.contentDocument?.body?.innerText?.replace(/\s+/g,' ').slice(0,200),
      canvasCount: frame.contentDocument?.querySelectorAll('canvas')?.length || 0,
      mapCount: frame.contentDocument?.querySelectorAll('[id*="map"], [class*="map"]')?.length || 0,
      svgCount: frame.contentDocument?.querySelectorAll('svg').length,
    };
  } catch (e) {
    inner = { error: e.message };
  }
  return {
    exists: true,
    src: frame.getAttribute('src'),
    contentDocument: !!frame.contentDocument,
    inner,
  };
});
note('geo', 'iframe src: ' + geo.src);
note('geo', 'inner: ' + JSON.stringify(geo.inner).slice(0,400));
await page.screenshot({ path: `${SCREEN_DIR}/07-geo.png`, fullPage: false });

// ─────────────────────────────────────────────────────────────────────
// 6. Ops surface
// ─────────────────────────────────────────────────────────────────────
console.log('\n═══ 6. Ops surface ═══');
await page.evaluate(() => window.switchSurface('ops'));
await page.waitForTimeout(5000);
const ops = await page.evaluate(() => ({
  surfaceText: document.querySelector('.surface[data-surface="ops"]')?.innerText?.replace(/\s+/g,' ').slice(0,400),
  loadingCount: document.querySelectorAll('.surface[data-surface="ops"] .loading').length,
  runtimeIssues: document.getElementById('runtime-issues-list')?.innerText?.slice(0,200),
  budgetText: document.getElementById('automation-budget')?.innerText?.slice(0,200),
  health: document.getElementById('operator-health')?.innerText?.slice(0,200),
  dataQuality: document.getElementById('operator-data-quality')?.innerText?.slice(0,200),
}));
note('ops', 'loading widgets still: ' + ops.loadingCount);
note('ops', 'runtime issues: ' + ops.runtimeIssues);
note('ops', 'budget: ' + ops.budgetText);
note('ops', 'health: ' + ops.health);
note('ops', 'data quality: ' + ops.dataQuality);
await page.screenshot({ path: `${SCREEN_DIR}/08-ops.png`, fullPage: false });

// ─────────────────────────────────────────────────────────────────────
// 7. Errors collected throughout
// ─────────────────────────────────────────────────────────────────────
console.log('\n═══ 7. Errors / failed requests ═══');
note('errors', 'console errors: ' + consoleErrs.length);
for (const e of consoleErrs.slice(0, 12)) console.log('  ', e);
note('errors', 'failed requests: ' + reqFails.length);
for (const r of reqFails.slice(0, 12)) console.log('  ', r);

await browser.close();
console.log('\n═══ DONE — screenshots in', SCREEN_DIR);
