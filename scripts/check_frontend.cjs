/* Run against scripts/serve.py. Playwright is QA tooling, not an app dependency.
 * Optional SANGUO_PLAYWRIGHT_PATH may point to an existing Playwright installation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.SANGUO_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.SANGUO_UI_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(__dirname, '../outputs/ui');
const report = { base_url: base, checks: [], errors: [], failed_responses: [], external_requests: [] };
let browser;
async function check(name, action) {
  try { const evidence = await action(); report.checks.push({ name, status: 'PASS', evidence }); console.log('PASS', name); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: error.message }); throw error; }
}
function observe(page) {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.failed_responses.push({ url: response.url(), status: response.status() }); });
  page.on('request', request => { if (!request.url().startsWith(new URL(base).origin) && /^https?:/.test(request.url())) report.external_requests.push(request.url()); });
}
async function loaded(page) {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('.stat-card').length === 5 && document.getElementById('load-status').textContent.includes('已载入'));
}
async function go(page, name, mobile = false) {
  if (mobile && !(await page.locator('#main-nav').evaluate(node => node.classList.contains('open')))) await page.locator('#menu-toggle').click();
  await page.locator(`.nav-item[data-page="${name}"]`).click();
  await page.waitForFunction(name => document.querySelector('.page.active').id === `page-${name}`, name);
  // Allow the existing Leaflet resize/fitBounds timers to finish before inspecting layout.
  await page.waitForTimeout(160);
}
async function noOverflow(page) {
  const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(result.scrollWidth <= result.width + 1, JSON.stringify(result));
  return result;
}
async function chapter(page, value) {
  await page.locator('#chapter-range').evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  observe(page); await loaded(page);
  await check('desktop: all seven pages, breadcrumb and active navigation', async () => {
    for (const name of ['overview', 'reader', 'people', 'analysis', 'places', 'network', 'findings']) {
      await go(page, name); await noOverflow(page);
      assert.equal(await page.locator(`.nav-item[data-page="${name}"]`).getAttribute('aria-current'), 'page');
      assert.ok((await page.locator('#current-page-label').textContent()).length > 0);
      await page.screenshot({ path: path.join(output, `desktop-${name}.png`) });
    }
    return { pages: 7, viewport: '1440x1000' };
  });
  await go(page, 'overview');
  await check('chapter navigation: boundaries, title, range and play/pause', async () => {
    await chapter(page, 1); assert.ok(await page.locator('#chapter-prev').isDisabled());
    await page.locator('#chapter-next').click();
    assert.equal(await page.locator('#chapter-range').inputValue(), '2');
    await page.locator('#chapter-play').click();
    await page.waitForFunction(() => Number(document.getElementById('chapter-range').value) >= 4);
    await page.locator('#chapter-play').click();
    assert.equal(await page.locator('#chapter-play').getAttribute('aria-pressed'), 'false');
    assert.ok((await page.locator('#timeline-chapter-title').textContent()).length > 0);
    await chapter(page, 119); assert.ok(await page.locator('#chapter-next').isDisabled());
    await chapter(page, 1);
    return { first: 1, last: 119, playback_advanced: true };
  });
  await check('ancient place labels can be hidden and restored', async () => {
    const initial = await page.locator('#overview-map .historical-place-label').count(); assert.ok(initial > 0);
    await page.locator('#place-label-toggle').uncheck(); assert.equal(await page.locator('#overview-map .historical-place-label').count(), 0);
    await page.locator('#place-label-toggle').check(); assert.ok(await page.locator('#overview-map .historical-place-label').count() > 0);
    return { visible_labels: initial };
  });
  await check('2024 administrative layers switch at province/city/county zooms', async () => {
    const map = page.locator('#overview-map');
    assert.equal(await map.getAttribute('data-admin-boundary-feature-count'), '42');
    await map.locator('.leaflet-control-zoom-in').click();
    await page.waitForFunction(() => document.getElementById('overview-map').dataset.adminBoundaryLevel === 'city');
    await page.waitForFunction(() => !state.maps.overview._animatingZoom);
    assert.equal(await map.getAttribute('data-admin-boundary-feature-count'), '388');
    await map.locator('.leaflet-control-zoom-in').click();
    await page.waitForFunction(() => state.maps.overview.getZoom() >= 6.5 && !state.maps.overview._animatingZoom);
    await map.locator('.leaflet-control-zoom-in').click();
    await page.waitForFunction(() => document.getElementById('overview-map').dataset.adminBoundaryLevel === 'county');
    assert.equal(await map.getAttribute('data-admin-boundary-feature-count'), '2898');
    await page.locator('#overview-reset').click();
    await page.waitForFunction(() => document.getElementById('overview-map').dataset.adminBoundaryLevel === 'province');
    return { province: 42, city: 388, county: 2898 };
  });
  await check('event evidence opens source text at the selected paragraph', async () => {
    await page.locator('#chapter-event-list .list-row').first().press('Enter');
    assert.ok(await page.locator('#read-selected').isVisible());
    await page.locator('#read-selected').click();
    await page.waitForFunction(() => document.querySelector('#page-reader').classList.contains('active'));
    assert.equal(await page.locator('.target-paragraph').count(), 1);
    return { highlighted_paragraph: await page.locator('.target-paragraph').getAttribute('id') };
  });
  await check('full text search retains source text highlighting', async () => {
    await page.locator('#text-search').fill('曹操'); await page.locator('#search-button').click();
    const hits = await page.locator('.search-hit').count(); assert.ok(hits > 0);
    await page.locator('.search-hit').first().click();
    assert.ok(await page.locator('#reader-text mark').count() > 0);
    return { query: '曹操', chapter_hits: hits };
  });
  await check('single-person tracks render independently and update on person change', async () => {
    await go(page, 'people');
    const choices = await page.locator('#track-person option').evaluateAll(options => options.map(node => ({ id: node.value, name: node.textContent })));
    const evidence = [];
    for (const person of choices.slice(0, 3)) {
      await page.locator('#track-person').selectOption(person.id);
      await page.waitForFunction(id => document.getElementById('track-map').dataset.trackPersonId === id, person.id);
      const counts = await page.locator('#track-map').evaluate(node => ({ nodes: Number(node.dataset.trackNodeCount), locations: Number(node.dataset.trackLocationCount), lines: Number(node.dataset.trackLineCount) }));
      assert.ok(counts.nodes > 0); assert.ok(counts.locations > 1); assert.equal(counts.lines, 1);
      evidence.push({ name: person.name, ...counts });
    }
    await page.locator('#track-records .list-row').first().click();
    assert.ok(await page.locator('#track-map .leaflet-popup-content').isVisible());
    assert.equal(await page.locator('#track-records .list-row.active').count(), 1);
    return evidence;
  });
  await check('place search and keyboard selection open the correct evidence panel', async () => {
    await go(page, 'places');
    const row = page.locator('.place-row[data-place]').filter({ has: page.locator('.status-tag.ok') }).first();
    const name = await row.getAttribute('data-place');
    await page.locator('#place-search').fill(name);
    const target = page.locator(`.place-row[data-place="${name}"]`);
    await target.press('Enter');
    await page.waitForFunction(() => document.getElementById('page-overview').classList.contains('active'));
    assert.equal(await page.locator('#selection-content h3').textContent(), name);
    return { place: name, no_reference_error: true };
  });
  await check('knowledge network nodes display evidence', async () => {
    await go(page, 'network'); await page.locator('.graph-node').first().click();
    assert.ok((await page.locator('#network-detail h3').textContent()).length > 0);
    return { nodes: await page.locator('.graph-node').count() };
  });
  await check('leaving overview pauses background chapter playback', async () => {
    await go(page, 'overview'); await page.locator('#chapter-play').click(); await go(page, 'findings');
    assert.equal(await page.locator('#chapter-play').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.finding-card').count(), 4);
  });
  await require('./check_frontend_details.cjs')({page,check,go,chapter});
  await require('./check_cockpit.cjs').desktop({page,check,go,output});
  await check('tablet: seven pages without document overflow', async () => {
    // Compact visual layout remains a public UI contract across breakpoints.
    await page.setViewportSize({ width: 1024, height: 900 });
    for (const name of ['overview','reader','people','analysis','places','network','findings']) { await go(page, name); await noOverflow(page); }
    return { pages: 7, viewport: '1024x900' };
  });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  mobile.setDefaultTimeout(15000);
  observe(mobile); await loaded(mobile);
  await check('mobile: seven pages, accessible navigation and no document overflow', async () => {
    for (const name of ['overview','reader','people','analysis','places','network','findings']) {
      await go(mobile, name, true); await noOverflow(mobile);
      assert.equal(await mobile.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
    }
    await go(mobile, 'overview', true);
    await mobile.screenshot({ path: path.join(output,'mobile-overview.png'), fullPage: true });
    await go(mobile, 'people', true);
    await mobile.screenshot({ path: path.join(output,'mobile-people.png'), fullPage: true });
    return { pages: 7, viewport: '390x844' };
  });
  await check('mobile menu closes with Escape', async () => {
    await mobile.locator('#menu-toggle').click(); assert.equal(await mobile.locator('#menu-toggle').getAttribute('aria-expanded'), 'true');
    await mobile.keyboard.press('Escape'); assert.equal(await mobile.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  });
  await check('small mobile: seven pages fit a 320px viewport',async()=>{
    await mobile.setViewportSize({width:320,height:740});
    for(const name of ['overview','reader','people','analysis','places','network','findings']){await go(mobile,name,true);await noOverflow(mobile);}
    await mobile.setViewportSize({width:390,height:844});return {pages:7,viewport:'320x740'};
  });
  await check('mobile chapter speed, play and navigation controls do not overlap',async()=>{
    for(const width of [390,320]){
      await mobile.setViewportSize({width,height:844});await go(mobile,'overview',true);
      if(await mobile.locator('[data-cockpit-sheet="timeline"]').getAttribute('aria-expanded')!=='true')await mobile.locator('[data-cockpit-sheet="timeline"]').click();
      const speed=await mobile.locator('#chapter-speed').boundingBox(),play=await mobile.locator('#chapter-play').boundingBox();
      assert.ok(speed.x+speed.width<=play.x,JSON.stringify({width,speed,play}));
      assert.ok(play.width>=100);assert.ok(play.height>=36);
      await mobile.locator('#chapter-next').click();assert.equal(await mobile.locator('#chapter-range').inputValue(),width===390?'2':'3');
    }
    await mobile.setViewportSize({width:390,height:844});
    return {viewports:[390,320],overlapping_controls:0};
  });
  await check('mobile navigation dismisses when clicking outside',async()=>{
    await mobile.locator('#menu-toggle').click();await mobile.locator('#overview-map').click({position:{x:150,y:180}});
    assert.equal(await mobile.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
  });
  await require('./check_cockpit.cjs').mobile({mobile,check,go,output});
  await check('offline rendering has no JavaScript errors, failed HTTP responses or external requests', async () => {
    // Includes the command palette, both map themes and the mobile cockpit sheets.
    assert.deepEqual(report.errors, []); assert.deepEqual(report.failed_responses, []); assert.deepEqual(report.external_requests, []);
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await loaded(page);
  await page.screenshot({ path: path.join(output, 'desktop-overview.png'), fullPage: true });
})().catch(error => { report.fatal = error.stack; console.error(error); process.exitCode = 1; })
  .finally(async () => {
    if (browser) await browser.close();
    report.passed = report.checks.filter(check => check.status === 'PASS').length;
    report.failed = report.checks.filter(check => check.status === 'FAIL').length;
    report.status = report.failed || report.fatal ? 'FAIL' : 'PASS';
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'ui-validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`UI validation: ${report.status} (${report.passed} passed)`);
  });
