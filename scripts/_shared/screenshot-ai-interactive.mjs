import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:8088/event-dashboard.html', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => window.switchSurface && window.switchSurface('investigate'));
await page.waitForTimeout(6000);

// Scroll to AI Lab
await page.evaluate(() => document.getElementById('ai-event-timeline')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(400);

// Hover an E2 or high-|t| dot
const dotHandle = await page.evaluateHandle(() => {
  const dots = document.querySelectorAll('#ai-event-timeline .tl-dot');
  let best = null, bestR = 0;
  for(const d of dots){ const r = parseFloat(d.getAttribute('r')); if(r > bestR){ bestR = r; best = d; } }
  return best;
});
if(dotHandle){
  await dotHandle.hover();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: 'tmp-screenshots/ai-interactive-timeline-hover.png', fullPage: false });
console.log('saved ai-interactive-timeline-hover.png');

// Scroll to scatter and hover
await page.evaluate(() => document.getElementById('corr-breaks-body')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
const ptHandle = await page.evaluateHandle(() => {
  const pts = document.querySelectorAll('#corr-breaks-body .cs-pt');
  let best = null, bestR = 0;
  for(const p of pts){ const r = parseFloat(p.getAttribute('r')); if(r > bestR){ bestR = r; best = p; } }
  return best;
});
if(ptHandle){
  await ptHandle.hover();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: 'tmp-screenshots/ai-interactive-scatter-hover.png', fullPage: false });
console.log('saved ai-interactive-scatter-hover.png');

await browser.close();
