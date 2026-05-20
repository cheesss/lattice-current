import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERR: ' + e.message.slice(0,200)));
page.on('console', m => { if(m.type()==='error') errs.push('[err] ' + m.text().slice(0,200)); });

await page.goto('http://localhost:3000/event-dashboard.html', { waitUntil: 'load' });
await page.waitForTimeout(7000);

// ───── 1. Try Codex narrative on a hot event ─────
console.log('\n━━ A. Codex narrative roundtrip ━━');
await page.evaluate(() => window.switchSurface('investigate'));
await page.waitForTimeout(5000);
await page.evaluate(() => document.getElementById('ai-event-timeline')?.scrollIntoView({block:'center'}));
await page.waitForTimeout(400);

const seedDot = await page.evaluateHandle(() => {
  const dots = Array.from(document.querySelectorAll('#ai-event-timeline .tl-dot.grade-E2, #ai-event-timeline .tl-dot.grade-E1'));
  if (dots.length === 0) return null;
  return dots[Math.floor(Math.random() * Math.min(5, dots.length))];
});
if (await seedDot.evaluate(d => !!d)) {
  await seedDot.evaluate(d => d.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(1500);
  // Look for peek overlay
  const peekVisible = await page.evaluate(() => document.getElementById('lattice-peek-overlay')?.classList?.contains('active'));
  console.log('  peek opened from dot:', peekVisible);
  // Click "Generate narrative" button if present
  const narrativeBtn = await page.locator('button:has-text("Generate narrative"), button:has-text("narrative")').first();
  const btnVisible = await narrativeBtn.isVisible().catch(()=>false);
  console.log('  narrative button visible:', btnVisible);
  if (btnVisible) {
    await narrativeBtn.click();
    console.log('  awaiting Codex…');
    // Wait up to 100s for narrative content to appear
    const narrative = await page.locator('#peek-narrative-slot').first();
    let result = null;
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(2000);
      const txt = await narrative.innerText().catch(()=>'');
      if (txt && txt.length > 80 && !/loading|generating/i.test(txt)) { result = txt.slice(0,500); break; }
    }
    console.log('  narrative result:', (result||'(timeout/empty)').slice(0,400));
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// ───── 2. Scenario lab slider interaction ─────
console.log('\n━━ B. Scenario lab — move VIX slider ━━');
const vixSlider = await page.locator('#scenario-vix').first();
if (await vixSlider.isVisible().catch(()=>false)) {
  // Get slider bbox
  const before = await page.evaluate(() => {
    const el = document.getElementById('scenario-vix');
    const valEl = el?.parentElement?.querySelector('.val');
    return { value: el?.value, valShown: valEl?.textContent };
  });
  console.log('  before: vix=', before);
  // Set to 35 (crisis)
  await page.evaluate(() => {
    const el = document.getElementById('scenario-vix');
    el.value = '35';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    value: document.getElementById('scenario-vix')?.value,
    regime: document.getElementById('scenario-regime-badge')?.textContent,
    predictionsHtml: document.querySelector('.scenario-predictions')?.innerHTML?.length || 0,
    predictionsText: document.querySelector('.scenario-predictions')?.innerText?.slice(0,300),
  }));
  console.log('  after vix=35:', after);
}

// ───── 3. Asset Dossier — type ticker ─────
console.log('\n━━ C. Asset Dossier — query SPY ━━');
const dossierInput = await page.locator('#asset-dossier-input, input[placeholder*="ticker" i], input[placeholder*="symbol" i]').first();
if (await dossierInput.isVisible().catch(()=>false)) {
  await dossierInput.fill('SPY');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const dossier = await page.evaluate(() => {
    const body = document.getElementById('asset-dossier-body');
    return body?.innerText?.slice(0,400);
  });
  console.log('  dossier:', dossier);
}

// ───── 4. Inbox — try Accept on first approval ─────
console.log('\n━━ D. Inbox — select approval and check actions ━━');
await page.evaluate(() => window.switchSurface('inbox'));
await page.waitForTimeout(3000);
const apprItem = await page.locator('#inbox-list .inbox-item').first();
if (await apprItem.isVisible().catch(()=>false)) {
  await apprItem.click();
  await page.waitForTimeout(1000);
  const proof = await page.evaluate(() => {
    const sel = document.getElementById('inbox-selected-proof');
    const buttons = Array.from(sel?.querySelectorAll('button') || []).map(b => b.textContent?.trim());
    return { text: sel?.innerText?.replace(/\s+/g,' ').slice(0,400), buttons };
  });
  console.log('  proof preview text:', proof.text);
  console.log('  available buttons:', proof.buttons);
}

// ───── 5. Geo Lens — let map fully load and inspect ─────
console.log('\n━━ E. Geo Lens deeper inspection ━━');
await page.evaluate(() => window.switchSurface('geo'));
await page.waitForTimeout(8000);
const geo = await page.evaluate(() => {
  const frame = document.getElementById('geo-lens-frame');
  if (!frame?.contentDocument) return { error: 'no frame doc' };
  const fd = frame.contentDocument;
  const allText = fd.body?.innerText?.replace(/\s+/g,' ');
  return {
    pinpoints: fd.querySelectorAll('[data-event-id], [class*="hotspot"], [class*="event-pin"], [class*="marker"]').length,
    canvasCount: fd.querySelectorAll('canvas').length,
    canvasSize: (() => { const c = fd.querySelector('canvas'); return c ? `${c.width}x${c.height}` : null; })(),
    legendOrPanel: fd.querySelector('[class*="legend"], [class*="panel"]')?.innerText?.slice(0,200),
    eventsLoaded: !/AWAITING NEXT DISCOVERY CYCLE/.test(allText || ''),
    snippet: (allText || '').slice(0,300),
  };
});
console.log('  geo:', JSON.stringify(geo, null, 2).slice(0, 600));

console.log('\n━━ ERRORS ━━');
console.log('console errors:', errs.length);
for (const e of errs.slice(0, 8)) console.log('  ', e);

await browser.close();
