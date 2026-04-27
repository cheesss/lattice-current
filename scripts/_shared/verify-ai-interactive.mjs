import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const results = [];
const check = (n,p,d='')=>{ console.log((p?'✅':'❌')+' '+n+(d?' — '+d:'')); results.push({n,p,d}); };

page.on('pageerror', err => console.log('⚠️ PAGE ERROR:', err.message.slice(0,200)));
await page.goto('http://localhost:3000/event-dashboard.html', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(2000);

// Jump to Investigate (surface where the AI Lab lives)
await page.evaluate(() => window.switchSurface && window.switchSurface('investigate'));
await page.waitForTimeout(6000);
// Scroll AI Lab into view (it's below the fold on Investigate)
await page.evaluate(() => document.getElementById('ai-event-timeline')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);

console.log('\n━ 1. Timeline SVG present ━');
const tlSvg = await page.$('#ai-event-timeline svg');
check('timeline SVG exists', !!tlSvg);
const dotCount = await page.$$eval('#ai-event-timeline .tl-dot', els => els.length);
check('timeline has dots', dotCount > 0, dotCount + ' dots');

console.log('\n━ 2. Dot hover → tooltip ━');
const firstDot = await page.$('#ai-event-timeline .tl-dot');
if(firstDot){
  await firstDot.evaluate(d => {
    const box = d.getBoundingClientRect();
    d.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.x + box.width/2, clientY: box.y + box.height/2 }));
  });
  await page.waitForTimeout(300);
  const tipShown = await page.evaluate(() => {
    const t = document.querySelector('#ai-event-timeline .ai-tl-tip');
    return { show: t?.classList.contains('show'), text: t?.innerText?.slice(0,240) };
  });
  check('hover shows tooltip', tipShown.show === true, (tipShown.text||'').replace(/\s+/g,' ').slice(0,80));
  check('tooltip has |t| + uplift', /\|t\|.*\|uplift\|/.test(tipShown.text||''), 'text: ' + (tipShown.text||'').replace(/\s+/g,' ').slice(0,140));
  await page.mouse.move(10, 10);
  await page.waitForTimeout(150);
} else check('hover shows tooltip', false, 'no dot');

console.log('\n━ 3. Brush drag → zoom ━');
await page.evaluate(() => document.getElementById('ai-event-timeline')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);
const svgBox = await page.$eval('#ai-event-timeline svg', el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; });
const midY = svgBox.y + svgBox.height * 0.9;  // bottom area (avoid dots)
const startX = svgBox.x + svgBox.width * 0.3;
const endX = svgBox.x + svgBox.width * 0.55;
await page.mouse.move(startX, midY);
await page.mouse.down();
await page.mouse.move(endX, midY, { steps: 10 });
await page.waitForTimeout(150);
const brushVisible = await page.$('#ai-event-timeline svg .tl-brush');
check('brush rect appears mid-drag', !!brushVisible);
await page.mouse.up();
await page.waitForTimeout(400);
const afterZoom = await page.evaluate(() => {
  const badge = document.getElementById('ai-timeline-badge')?.textContent || '';
  const btn = document.querySelector('#ai-event-timeline .tl-reset-btn');
  return { badge, resetShown: btn?.classList.contains('show') };
});
check('zoom badge updates', afterZoom.badge.includes('zoom'), 'badge: ' + afterZoom.badge);
check('reset button visible', afterZoom.resetShown === true);

console.log('\n━ 4. Reset zoom ━');
await page.click('#ai-event-timeline .tl-reset-btn');
await page.waitForTimeout(300);
const afterReset = await page.evaluate(() => {
  const badge = document.getElementById('ai-timeline-badge')?.textContent || '';
  const btn = document.querySelector('#ai-event-timeline .tl-reset-btn');
  return { badge, resetShown: btn?.classList.contains('show') };
});
check('reset clears zoom', !afterReset.badge.includes('zoom'), 'badge: ' + afterReset.badge);
check('reset button hidden', afterReset.resetShown === false);

console.log('\n━ 5. Correlation scatter ━');
// Scroll scatter into view
await page.evaluate(() => document.getElementById('corr-breaks-body')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);
const scatterSvg = await page.$('#corr-breaks-body .corr-scatter svg');
check('scatter SVG exists', !!scatterSvg);
const ptCount = await page.$$eval('#corr-breaks-body .cs-pt', els => els.length);
check('scatter has points', ptCount > 0, ptCount + ' points');
const firstPt = await page.$('#corr-breaks-body .cs-pt');
if(firstPt){
  const pbox = await firstPt.boundingBox();
  await page.mouse.move(pbox.x + pbox.width/2, pbox.y + pbox.height/2);
  await page.waitForTimeout(220);
  const csTip = await page.evaluate(() => {
    const t = document.querySelector('#corr-breaks-body .cs-tip');
    return { show: t?.classList.contains('show'), text: t?.innerText?.slice(0,100) };
  });
  check('scatter hover tooltip', csTip.show === true, (csTip.text||'').slice(0,80));
  check('scatter tooltip has pair + Δ', /30d=.*90d=/.test(csTip.text||''), (csTip.text||'').slice(0,100));
}

console.log('\n━ 6. Dot size varies by |t| ━');
const radii = await page.$$eval('#ai-event-timeline .tl-dot', els => els.map(el => parseFloat(el.getAttribute('r'))));
const uniqueR = [...new Set(radii)];
check('radii vary (>3 unique sizes)', uniqueR.length > 3, uniqueR.length + ' unique r');

console.log('\n━ 7. Double-click resets zoom ━');
// Re-scroll timeline into view
await page.evaluate(() => document.getElementById('ai-event-timeline')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);
const svgBox2 = await page.$eval('#ai-event-timeline svg', el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; });
await page.mouse.move(svgBox2.x + svgBox2.width*0.3, svgBox2.y + svgBox2.height*0.9);
await page.mouse.down();
await page.mouse.move(svgBox2.x + svgBox2.width*0.55, svgBox2.y + svgBox2.height*0.9, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(250);
await page.dblclick('#ai-event-timeline svg', { position: { x: svgBox2.width*0.5, y: svgBox2.height*0.5 } });
await page.waitForTimeout(300);
const afterDbl = await page.evaluate(() => document.getElementById('ai-timeline-badge')?.textContent || '');
check('double-click resets', !afterDbl.includes('zoom'), 'badge: ' + afterDbl);

console.log('\n━ SUMMARY ━');
const passed = results.filter(r=>r.p).length;
console.log(`PASSED: ${passed}/${results.length}`);
if(results.some(r=>!r.p)){ console.log('FAILED:'); for(const r of results.filter(r=>!r.p)) console.log(' ❌ '+r.n+' — '+r.d); }
await browser.close();
process.exit(passed === results.length ? 0 : 1);
