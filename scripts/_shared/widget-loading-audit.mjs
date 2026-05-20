import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 } });
const page = await ctx.newPage();

const reqs = [];
const failures = [];
page.on('response', r => {
  const u = r.url();
  if (u.includes('/api/')) reqs.push({ status: r.status(), path: u.slice(u.indexOf('/api')) });
});
page.on('requestfailed', r => failures.push({ url: r.url().slice(0, 80), err: r.failure()?.errorText }));

await page.goto('http://localhost:3000/event-dashboard.html', { waitUntil: 'load' });
await page.waitForTimeout(15000); // give widgets ample time

for (const surface of ['investigate', 'ops']) {
  await page.evaluate((s) => window.switchSurface(s), surface);
  await page.waitForTimeout(8000);

  const stuck = await page.evaluate(() => {
    const surface = document.querySelector('.surface.active');
    const loading = Array.from(surface.querySelectorAll('.loading'));
    return loading.map(el => ({
      id: el.id || null,
      parentTitle: el.closest('.card')?.querySelector('.card-title')?.textContent?.trim()?.slice(0,80) || null,
      text: el.textContent?.trim().slice(0,80),
      classes: el.className,
    }));
  });
  console.log(`\n━━ surface=${surface} stuck loading widgets: ${stuck.length} ━━`);
  for (const s of stuck) console.log(`  ${s.id || '(no-id)'} :: ${s.parentTitle || '?'} :: ${s.text}`);
}

console.log(`\n━━ all api requests (${reqs.length}) ━━`);
const grouped = {};
for (const r of reqs) {
  const key = r.path.split('?')[0];
  grouped[key] = grouped[key] || { count: 0, statuses: new Set() };
  grouped[key].count += 1;
  grouped[key].statuses.add(r.status);
}
for (const [path, info] of Object.entries(grouped).sort()) {
  console.log(`  ${[...info.statuses].join(',').padStart(3)} ×${info.count}  ${path}`);
}
console.log(`\n━━ failures (${failures.length}) ━━`);
for (const f of failures.slice(0,15)) console.log(`  ${f.url} :: ${f.err}`);

await browser.close();
