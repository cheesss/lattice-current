import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const results = [];
const check = (name, pass, detail='') => {
  const mark = pass ? '✅' : '❌';
  console.log(mark + ' ' + name + (detail ? ' — ' + detail : ''));
  results.push({ name, pass, detail });
};

page.on('pageerror', err => console.log('⚠️  PAGE ERROR:', err.message.slice(0,160)));
page.on('console', msg => { if(msg.type()==='error') console.log('⚠️  CONSOLE ERROR:', msg.text().slice(0,160)); });

await page.goto('http://127.0.0.1:8088/event-dashboard.html', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(9000);

console.log('\n━━━━━━ 1. J/K navigation ━━━━━━');
await page.keyboard.press('j'); await page.waitForTimeout(200);
const f1 = await page.evaluate(() => document.querySelector('.evidence-row.focused')?.getAttribute('data-event-id'));
check('J focuses first row', !!f1, 'id=' + (f1||'none'));
await page.keyboard.press('j'); await page.waitForTimeout(200);
const f2 = await page.evaluate(() => document.querySelector('.evidence-row.focused')?.getAttribute('data-event-id'));
check('J again moves down', !!f2 && f2 !== f1, f1 + ' -> ' + f2);
await page.keyboard.press('k'); await page.waitForTimeout(200);
const f3 = await page.evaluate(() => document.querySelector('.evidence-row.focused')?.getAttribute('data-event-id'));
check('K moves back up', f3 === f1, 'back to ' + f3);

console.log('\n━━━━━━ 2. Peek overlay (Space/E) ━━━━━━');
await page.keyboard.press('Space'); await page.waitForTimeout(2500);
const peekOpen = await page.evaluate(() => document.getElementById('lattice-peek-overlay')?.classList.contains('active'));
check('Space opens peek', peekOpen);
const peekContent = await page.evaluate(() => document.getElementById('lattice-peek-overlay')?.innerText?.slice(0,80));
check('Peek has content', !!peekContent && peekContent.length > 10, (peekContent||'').slice(0,50));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const peekClosed = await page.evaluate(() => !document.getElementById('lattice-peek-overlay')?.classList.contains('active'));
check('Esc closes peek', peekClosed);
await page.keyboard.press('e'); await page.waitForTimeout(2500);
const ePeekOpen = await page.evaluate(() => document.getElementById('lattice-peek-overlay')?.classList.contains('active'));
check('E key also opens peek', ePeekOpen);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

console.log('\n━━━━━━ 3. Help overlay (?) ━━━━━━');
await page.keyboard.press('?'); await page.waitForTimeout(400);
const help = await page.evaluate(() => {
  const o = document.getElementById('lattice-peek-overlay');
  return { active: o?.classList.contains('active'), has: o?.innerText?.includes('KEYBOARD HELP') };
});
check('? opens help overlay', help.active);
check('Help contains "KEYBOARD HELP"', help.has);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

console.log('\n━━━━━━ 4. G-chord surface nav ━━━━━━');
for (const [combo, target] of [['gi','inbox'],['go','ops'],['gv','investigate'],['gh','home']]){
  await page.keyboard.press(combo[0]); await page.waitForTimeout(100);
  await page.keyboard.press(combo[1]); await page.waitForTimeout(1500);
  const active = await page.evaluate(() => document.querySelector('.surface.active')?.getAttribute('data-surface'));
  check('G+' + combo[1].toUpperCase() + ' -> ' + target, active === target, 'active=' + active);
}

console.log('\n━━━━━━ 5. Theme group hover ━━━━━━');
const themeInfo = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#hot-events-rows .evidence-row'));
  const byTheme = {};
  for(const r of rows){ const t = r.getAttribute('data-theme'); if(t){ (byTheme[t] = byTheme[t] || []).push(r.getAttribute('data-event-id')); } }
  return byTheme;
});
const multi = Object.entries(themeInfo).find(([,ids])=>ids.length>=2);
if(multi){
  const theme = multi[0];
  await page.locator('#hot-events-rows .evidence-row[data-theme="' + theme + '"]').first().hover();
  await page.waitForTimeout(400);
  const highlighted = await page.evaluate((t) => document.querySelectorAll('#hot-events-rows .evidence-row[data-theme="' + t + '"].theme-group').length, theme);
  check('Hover row highlights same-theme rows', highlighted >= 1, 'theme=' + theme + ' matched=' + highlighted);
  await page.mouse.move(0,0); await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => document.querySelectorAll('.evidence-row.theme-group').length);
  check('Mouse leave clears highlight', cleared === 0);
} else {
  check('2+ rows sharing theme', false, 'skipped — no shared theme in current data');
}

console.log('\n━━━━━━ 6. Evidence chain tooltip ━━━━━━');
const tt = await page.evaluate(() => {
  const row = document.querySelector('#hot-events-rows .evidence-row');
  if(!row) return null;
  const t = row.querySelector('.evidence-chain-tooltip');
  return { exists: !!t, len: t?.innerHTML?.length || 0, head: t?.innerHTML?.includes('chain-head') };
});
check('Tooltip DOM exists', tt?.exists);
check('Tooltip rich content (>100 chars)', tt?.len > 100, tt?.len + ' chars');
check('Tooltip has chain-head structure', tt?.head);

console.log('\n━━━━━━ 7. Trust Strip click -> ops ━━━━━━');
await page.evaluate(() => window.switchSurface('home')); await page.waitForTimeout(500);
await page.locator('.lattice-trust-strip .tstrip-chunk[data-trust="data"]').click();
await page.waitForTimeout(800);
const afterClick = await page.evaluate(() => document.querySelector('.surface.active')?.getAttribute('data-surface'));
check('DATA chunk click -> ops', afterClick === 'ops', 'active=' + afterClick);

console.log('\n━━━━━━ 8. Since reset ━━━━━━');
await page.evaluate(() => window.switchSurface('home')); await page.waitForTimeout(300);
const before = await page.evaluate(() => localStorage.getItem('lattice:since:v1'));
check('Baseline exists', !!before, (before||'').slice(0,60));
await page.locator('.lattice-since-strip .since-reset').click(); await page.waitForTimeout(400);
const after = await page.evaluate(() => localStorage.getItem('lattice:since:v1'));
check('Reset clears baseline', !after, after || 'cleared');

console.log('\n━━━━━━ 9. Focus-visible ring ━━━━━━');
await page.keyboard.press('Tab'); await page.waitForTimeout(300);
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  if(!el) return null;
  const s = getComputedStyle(el);
  return { tag: el.tagName, cls: el.className?.slice(0,40), w: s.outlineWidth, c: s.outlineColor };
});
check('Tab focuses an interactive', ['BUTTON','A','INPUT','SELECT'].includes(focused?.tag), focused?.tag + '.' + focused?.cls);
check('Focus ring 2px', focused?.w === '2px', 'width=' + focused?.w);

console.log('\n━━━━━━ 10. Inbox bulk simulate state ━━━━━━');
await page.evaluate(() => window.switchSurface('inbox')); await page.waitForTimeout(1500);
const dis = await page.evaluate(() => document.getElementById('inbox-bulk-simulate')?.disabled);
check('Simulate disabled with 0 selection', dis === true);
await page.locator('#inbox-list .inbox-item').first().click(); await page.waitForTimeout(500);
const after2 = await page.evaluate(() => ({
  disabled: document.getElementById('inbox-bulk-simulate')?.disabled,
  cnt: document.getElementById('inbox-bulk-count')?.textContent,
  type: document.querySelector('#inbox-list .inbox-item.selected')?.className,
}));
check('Triage selection stays disabled', after2.disabled === true, 'selected=' + after2.cnt);

console.log('\n━━━━━━ 11. Triage symbol chips ━━━━━━');
await page.evaluate(() => window.switchSurface('home')); await page.waitForTimeout(500);
const tri = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('#discovery-triage .interactive-row'));
  let withChips = 0;
  const ex = [];
  for(const c of cards){
    const tags = c.querySelectorAll('.tag-emerging');
    if(tags.length > 0){
      withChips++;
      if(ex.length < 3) ex.push({ title: c.querySelector('strong')?.textContent?.trim(), chips: Array.from(tags).slice(0,5).map(t=>t.textContent.trim()) });
    }
  }
  return { total: cards.length, withChips, ex };
});
check('Triage has symbol chips on >=1 card', tri.withChips >= 1, tri.withChips + '/' + tri.total);
for(const e of tri.ex) console.log('  ' + e.title + ' -> ' + e.chips.join(' | '));

console.log('\n━━━━━━ 12. Recent Transitions clickable ━━━━━━');
const trans = await page.evaluate(() => {
  const els = document.querySelectorAll('#recent-transitions-standalone .tag[onclick]');
  return { count: els.length, first: els[0]?.textContent };
});
check('Recent transitions clickable', trans.count >= 1, trans.count + ' tags');

console.log('\n━━━━━━ 13. Theme spectrum segments ━━━━━━');
const spec = await page.evaluate(() => document.querySelectorAll('.theme-spectrum-strip .ts-seg').length);
check('Spectrum has segments', spec > 0, spec + ' segments');

console.log('\n━━━━━━ 14. API endpoints reachable ━━━━━━');
const apis = await page.evaluate(async () => {
  const eps = ['/api/health','/api/hot-events?limit=3','/api/theme-symbols-bulk?themes=ai-ml','/api/trend-pyramid'];
  const out = [];
  for(const ep of eps){ try { const r = await fetch('http://127.0.0.1:46200'+ep); out.push({ ep, status: r.status }); } catch(e){ out.push({ ep, error: e.message }); } }
  return out;
});
for(const e of apis) console.log('  ' + (e.status || 'ERR') + ' ' + e.ep);
check('All 4 APIs return 200', apis.every(x=>x.status===200));

console.log('\n━━━━━━ SUMMARY ━━━━━━');
const passed = results.filter(r=>r.pass).length;
const failed = results.filter(r=>!r.pass).length;
console.log('PASSED: ' + passed + ' / ' + results.length + '  |  FAILED: ' + failed);
if(failed > 0){ console.log('\nFailed:'); for(const r of results.filter(x=>!x.pass)) console.log('  ❌ ' + r.name + (r.detail?' — '+r.detail:'')); }
await browser.close();
