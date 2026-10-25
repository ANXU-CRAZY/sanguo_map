const assert = require('node:assert/strict');
module.exports = async ({page,check,go,chapter}) => {
  await check('directory search and chapter paging preserve original source numbering',async()=>{
    await go(page,'reader');await page.locator('#chapter-search').fill('065');
    assert.equal(await page.locator('.chapter-item').count(),1);
    await page.locator('.chapter-item').click();assert.match(await page.locator('#reader-title').textContent(),/^第一章/);
    assert.equal(await page.locator('#reader-position').textContent(),'65 / 119');
    await page.locator('#chapter-search').fill('');assert.equal(await page.locator('.chapter-item').count(),119);
    await page.locator('.chapter-item[data-chapter-order="1"]').click();
    await page.locator('#reader-next').click();assert.equal(await page.locator('#reader-position').textContent(),'2 / 119');
    await page.locator('#reader-prev').click();assert.ok(await page.locator('#reader-prev').isDisabled());
    return {source_ordinal_65_original_title_prefix:'第一章',directory_records:119};
  });
  await check('reader font changes real text size and persists after reload',async()=>{
    const before=await page.locator('#reader-text').evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
    await page.locator('#reader-font-larger').click();
    assert.equal(await page.locator('#reader-text').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),before+1);
    await page.reload();await page.waitForFunction(()=>document.getElementById('app-loading').hidden);
    assert.equal(await page.locator('#reader-text').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),before+1);
    await page.locator('#reader-font-smaller').click();return {before_px:before,persisted_px:before+1};
  });
  await check('search returns all matching chapters and jumps to the correct paragraph',async()=>{
    await page.locator('#text-search').fill('曹操');await page.locator('#search-button').click();
    const hits=await page.locator('.search-hit').count();assert.ok(hits>25);
    await page.locator('.search-hit').first().press('Enter');assert.ok((await page.locator('.target-paragraph').textContent()).includes('曹操'));
    await page.locator('#clear-text-search').click();assert.equal(await page.locator('#reader-text mark').count(),0);
    await page.locator('#text-search').fill('不存在的检索词_987654');await page.locator('#search-button').click();
    assert.ok((await page.locator('#search-results').textContent()).includes('没有找到'));
    await page.locator('#clear-text-search').click();return {matching_chapters:hits,correct_paragraph:true};
  });
  await check('place pagination, Chinese state search and empty reset work',async()=>{
    await go(page,'places');await page.locator('#place-search').fill('');await page.locator('[data-place-filter="all"]').click();
    const first=await page.locator('.place-row[data-place]').first().getAttribute('data-place');
    assert.equal(await page.locator('.place-row[data-place]').count(),50);
    await page.locator('#place-page-next').click();assert.notEqual(await page.locator('.place-row[data-place]').first().getAttribute('data-place'),first);
    assert.match(await page.locator('#place-page-summary').textContent(),/^51–100/);
    await page.locator('#place-search').fill('唯一坐标');assert.match(await page.locator('#place-page-summary').textContent(),/^1–50/);
    assert.equal(await page.locator('.place-row[data-place] .status-tag:not(.ok)').count(),0);
    await page.locator('#place-search').fill('不存在的地名_987654');await page.locator('#place-clear').click();
    assert.equal(await page.locator('#place-search').inputValue(),'');assert.equal(await page.locator('[data-place-filter="all"]').getAttribute('aria-pressed'),'true');
    return {page_size:50,second_page_first_record:51};
  });
  await check('chapter evidence follows event filters and fast playback',async()=>{
    await go(page,'overview');await chapter(page,1);await page.locator('#event-filter').selectOption('war');
    assert.ok(await page.locator('#overview-clear-filters').isVisible());
    assert.ok((await page.locator('#chapter-event-list .event-type').allTextContents()).every(label=>label==='战争'));
    await page.locator('#overview-clear-filters').click();assert.ok(await page.locator('#chapter-event-list .list-row').count()>0);
    await page.locator('#chapter-speed').selectOption('400');await page.locator('#chapter-play').click();
    await page.waitForFunction(()=>Number(document.getElementById('chapter-range').value)>=3);
    await page.locator('#chapter-play').click();await page.locator('#chapter-speed').selectOption('720');
  });
  await check('track evidence supports record stepping and full-view reset',async()=>{
    await go(page,'people');await page.locator('#track-next-record').click();
    assert.equal(await page.locator('#track-records .list-row.active').getAttribute('data-track-index'),'0');
    await page.locator('#track-next-record').click();assert.equal(await page.locator('#track-records .list-row.active').getAttribute('data-track-index'),'1');
    await page.locator('#track-prev-record').click();assert.ok(await page.locator('#track-prev-record').isDisabled());
    assert.ok((await page.locator('#track-records .list-row-excerpt').first().textContent()).length>10);
    await page.locator('#track-reset').click();await page.waitForFunction(()=>state.maps.tracks.getZoom()<=5.6);
  });
  await check('analysis layer controls restore identical existing layer counts',async()=>{
    await go(page,'analysis');const initial=await page.evaluate(()=>state.layers.analysis.getLayers().length);assert.ok(initial>0);
    for(const id of ['analysis-density','analysis-buffers','analysis-events'])await page.locator('#'+id).uncheck();
    assert.equal(await page.evaluate(()=>state.layers.analysis.getLayers().length),0);
    for(const id of ['analysis-density','analysis-buffers','analysis-events'])await page.locator('#'+id).check();
    assert.equal(await page.evaluate(()=>state.layers.analysis.getLayers().length),initial);
    assert.ok(!(await page.locator('#kde-status').textContent()).includes('COMPUTED_'));return {rendered_layers:initial};
  });
  await check('network keyboard selection highlights neighbors and clears cleanly',async()=>{
    await go(page,'network');await page.locator('.graph-node').first().press('Enter');
    assert.equal(await page.locator('.graph-node.selected').count(),1);
    assert.ok(await page.locator('.graph-edge.related').count()>0);assert.ok(await page.locator('.graph-node.related').count()>1);
    assert.ok((await page.locator('#network-detail .list-row-excerpt').first().textContent()).length>10);
    await page.locator('#network-clear').click();assert.equal(await page.locator('.graph-node.selected').count(),0);
    assert.equal(await page.locator('.graph-edge.related').count(),0);
  });
};
