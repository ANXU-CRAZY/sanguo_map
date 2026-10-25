const assert=require('node:assert/strict');
const path=require('node:path');

async function desktop({page,check,go,output}){
  await go(page,'overview');
  await check('cockpit map fills the workspace and panel/dock surfaces do not overlap',async()=>{
    const map=await page.locator('#overview-map').boundingBox(),screen=page.viewportSize();
    assert.ok(map.width>=screen.width-80);assert.ok(map.height>=screen.height-70);
    const evidence=await page.locator('#overview-evidence').boundingBox(),dock=await page.locator('#command-dock').boundingBox();
    assert.ok(evidence.y+evidence.height<=dock.y);
    return {viewport:screen,map:{width:map.width,height:map.height},overlapping_panels:0};
  });
  await check('scene panel collapses and focus mode restores via keyboard',async()=>{
    await page.locator('#scene-collapse').click();assert.ok(await page.locator('#scene-panel-body').isHidden());
    await page.locator('#scene-collapse').click();assert.ok(await page.locator('#scene-panel-body').isVisible());
    await page.keyboard.press('f');assert.ok(await page.locator('#command-dock').isHidden());
    assert.equal(await page.locator('#map-focus').getAttribute('aria-pressed'),'true');
    await page.screenshot({path:path.join(output,'desktop-map-focus.png')});
    await page.keyboard.press('Escape');assert.ok(await page.locator('#command-dock').isVisible());
    assert.equal(await page.locator('#map-focus').getAttribute('aria-pressed'),'false');
  });
  await check('quick search opens a named persons independent track',async()=>{
    await page.keyboard.press('Control+k');await page.locator('#quick-search-input').fill('曹操');
    const dialog=await page.locator('#quick-search-dialog').boundingBox(),footer=await page.locator('.quick-search-footer').boundingBox();
    assert.ok(footer.y+footer.height<=dialog.y+dialog.height+1);
    await page.screenshot({path:path.join(output,'desktop-quick-search.png')});
    await page.locator('.quick-result').filter({hasText:'人物 ·'}).first().click();
    await page.waitForFunction(()=>document.getElementById('track-map-title').textContent.includes('曹操'));
    assert.ok(Number(await page.locator('#track-map').getAttribute('data-track-location-count'))>1);
    assert.equal(await page.locator('#quick-search-dialog').evaluate(node=>node.open),false);
  });
  await check('quick place search focuses the actual candidate and reopens evidence',async()=>{
    await go(page,'overview');await page.locator('#evidence-toggle').click();assert.ok(await page.locator('#overview-evidence').isHidden());
    await page.keyboard.press('/');await page.locator('#quick-search-input').fill('洛阳');
    await page.locator('.quick-result').filter({hasText:'地名 ·'}).first().click();
    assert.equal(await page.locator('#selection-content h3').textContent(),'洛阳');assert.ok(await page.locator('#overview-evidence').isVisible());
    const evidence=await page.evaluate(()=>{const geo=geocodeByName('洛阳'),map=state.maps.overview,center=map.getCenter();return {dx:Math.abs(center.lng-geo.longitude),dy:Math.abs(center.lat-geo.latitude),screen_offset_px:map.latLngToContainerPoint([geo.latitude,geo.longitude]).distanceTo(map.getSize().divideBy(2)),period:geo.matched_period};});
    // Leaflet's view center rounds to CSS pixels; source coordinates are not rounded.
    assert.ok(evidence.screen_offset_px<=1.5,JSON.stringify(evidence));return evidence;
  });
  await check('quick chapter search retains the source edition numbering',async()=>{
    await page.keyboard.press('Control+k');await page.locator('#quick-search-input').fill('065');
    await page.locator('.quick-result').filter({hasText:'原文序号 065'}).click();
    assert.match(await page.locator('#reader-title').textContent(),/^第一章/);
    assert.equal(await page.locator('#reader-position').textContent(),'65 / 119');
  });
  await check('night and paper themes change painted basemaps without changing camera coordinates',async()=>{
    await go(page,'overview');
    const camera=()=>page.evaluate(()=>{const m=state.maps.overview,p=m.getCenter();return {latitude:p.lat,longitude:p.lng,zoom:m.getZoom()};});
    const color=()=>page.evaluate(()=>state.maps.overview._atlasBaseLayers.adminGroup.getLayers()[0].getLayers()[0].options.fillColor);
    const before=await camera(),night=await color();await page.locator('[data-atlas-theme="paper"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'paper');assert.notEqual(await color(),night);assert.deepEqual(await camera(),before);
    await page.screenshot({path:path.join(output,'desktop-cockpit-paper.png')});
    await page.reload();await page.waitForFunction(()=>document.getElementById('app-loading').hidden);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'paper');
    await page.locator('[data-atlas-theme="night"]').click();
    const map=page.locator('#overview-map');await map.locator('.leaflet-control-zoom-in').click();
    await page.waitForFunction(()=>document.getElementById('overview-map').dataset.adminBoundaryLevel==='city');
    assert.equal(await color(),night);await page.locator('#overview-reset').click();
    return {theme_persistence:true,camera_unchanged:true,zoom_retains_theme:true};
  });
  await check('data layer toggles hide and restore identical existing candidate counts',async()=>{
    const count=()=>page.evaluate(()=>state.layers.overview.getLayers().length);
    const initial=await count();assert.ok(initial>0);
    for(const id of ['layer-events','layer-historic','layer-modern'])await page.locator('#'+id).uncheck();
    assert.equal(await count(),0);
    for(const id of ['layer-events','layer-historic','layer-modern'])await page.locator('#'+id).check();
    assert.equal(await count(),initial);return {original_candidates:initial,restored_candidates:initial};
  });
}

async function mobile({mobile,check,go,output}){
  await mobile.setViewportSize({width:390,height:844});await go(mobile,'overview',true);
  await check('mobile cockpit opens one panel at a time and keeps the map full size',async()=>{
    await mobile.locator('[data-cockpit-sheet="scene"]').click();assert.ok(await mobile.locator('#scene-panel').isVisible());
    assert.ok(await mobile.locator('#command-dock').isHidden());assert.ok(await mobile.locator('#overview-evidence').isHidden());
    await mobile.screenshot({path:path.join(output,'mobile-cockpit-scene.png')});
    await mobile.locator('[data-cockpit-sheet="evidence"]').click();assert.ok(await mobile.locator('#scene-panel').isHidden());
    assert.ok(await mobile.locator('#overview-evidence').isVisible());
    assert.ok(await mobile.locator('#overview-map .leaflet-control-layers').isHidden());
    await mobile.screenshot({path:path.join(output,'mobile-cockpit-evidence.png')});
    await mobile.locator('#evidence-close').click();assert.ok(await mobile.locator('#overview-evidence').isHidden());
    const map=await mobile.locator('#overview-map').boundingBox();assert.ok(map.width>=389&&map.height>=740);
  });
  await check('mobile timeline and quick search are reachable from the bottom tabs',async()=>{
    await mobile.locator('[data-cockpit-sheet="timeline"]').click();assert.ok(await mobile.locator('#chapter-play').isVisible());
    await mobile.screenshot({path:path.join(output,'mobile-cockpit-timeline.png')});
    await mobile.locator('#mobile-cockpit-search').click();await mobile.locator('#quick-search-input').fill('曹操');
    assert.ok(await mobile.locator('.quick-result').count()>0);await mobile.locator('#quick-search-close').click();
    assert.equal(await mobile.locator('#quick-search-dialog').evaluate(node=>node.open),false);
    await mobile.locator('[data-cockpit-sheet="timeline"]').click();
  });
}
module.exports={desktop,mobile};
