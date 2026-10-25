const assert = require('node:assert/strict');
const path = require('node:path');
async function seek(page, value) {
  await page.locator('#track-range').evaluate((node, value) => {node.value = String(value); node.dispatchEvent(new Event('input', {bubbles:true}));}, value);
}
exports.desktop = async ({page, check, go, output}) => {
  await go(page, 'people');
  await check('single playback: pause, rewind and source-bounded nodes', async () => {
    await page.locator('button[data-track-mode=single]').click();
    const full = Number(await page.locator('#track-map').getAttribute('data-track-node-count'));
    await page.locator('#track-speed').selectOption('175');
    await page.locator('#track-play').click();
    await page.waitForFunction(() => Number(document.getElementById('track-range').value) >= 3 && Number(document.getElementById('track-range').value) < 119);
    await page.locator('#track-play').click();
    const paused = await page.locator('#track-range').inputValue();
    await page.waitForTimeout(450); assert.equal(await page.locator('#track-range').inputValue(), paused);
    await seek(page, 5);
    const accounting = await page.evaluate(() => ({
      actual: Number(document.getElementById('track-map').dataset.trackNodeCount),
      expected: collectTrackNodes(document.getElementById('track-person').value).filter(n => n.row.chapter_order <= 5).length,
      future: trackPlayback.visibleNodes.filter(n => n.row.chapter_order > 5).length
    }));
    assert.equal(accounting.actual, accounting.expected); assert.equal(accounting.future, 0);
    assert.ok(accounting.actual < full);
    await page.locator('#track-reset').click();
    assert.equal(Number(await page.locator('#track-map').getAttribute('data-track-node-count')), full);
    return {full_nodes: full, chapter_5: accounting, pause_stable:true};
  });
  await check('comparison: shared chapter clock with independent colored paths', async () => {
    await page.locator('button[data-track-mode=compare]').click();
    assert.equal(await page.locator('[data-track-series]').count(), 3);
    await seek(page, 40);
    const result = await page.evaluate(() => {
      const lines = state.layers.tracks.getLayers().filter(layer => layer instanceof L.Polyline);
      const expected = trackPlayback.series.map(series => {
        const coords=[];
        for(const n of series.nodes.filter(n=>n.row.chapter_order<=40)) {
          const p=[n.latitude,n.longitude],last=coords.at(-1);
          if(!last||last[0]!==p[0]||last[1]!==p[1])coords.push(p);
        }
        return {id:series.id,color:series.color,coords};
      }).filter(row=>row.coords.length>=2);
      return {expected, actual:lines.map(line=>({color:line.options.color,coords:line.getLatLngs().map(p=>[p.lat,p.lng])})), future:trackPlayback.visibleNodes.some(n=>n.row.chapter_order>40)};
    });
    assert.equal(result.future,false); assert.equal(result.actual.length,result.expected.length);
    assert.equal(new Set(result.expected.map(row=>row.color)).size,result.expected.length);
    result.expected.forEach((row,i)=>{assert.equal(result.actual[i].color,row.color);assert.deepEqual(result.actual[i].coords,row.coords);});
    await page.locator('#track-play').click();
    await page.waitForFunction(()=>Number(document.getElementById('track-range').value)>40);
    await page.locator('#track-play').click();
    await page.screenshot({path:path.join(output,'desktop-comparison-playback.png'),fullPage:true});
    return {people:3,independent_lines:result.actual.length,no_cross_person_segments:true};
  });
  await check('comparison: four-person cap, empty selection and timer lifecycle', async () => {
    const inputs=page.locator('#track-compare-options input');
    const extra=page.locator('#track-compare-options input:not(:checked)').first(); await extra.check();
    assert.equal(await page.locator('#track-compare-options input:checked').count(),4);
    assert.equal(await page.locator('#track-compare-options input:not(:checked):not(:disabled)').count(),0);
    await page.locator('#track-play').click();
    await go(page,'assistant');
    assert.equal(await page.locator('#track-play').getAttribute('aria-pressed'),'false');
    await go(page,'people');
    while(await page.locator('#track-compare-options input:checked').count()) await page.locator('#track-compare-options input:checked').first().uncheck();
    assert.equal(await page.locator('#track-play').isDisabled(),true);
    assert.equal(await page.locator('#track-map').getAttribute('data-track-node-count'),'0');
    await inputs.first().check(); await page.locator('#track-play').click();
    await inputs.first().uncheck();
    assert.equal(await page.locator('#track-play').getAttribute('aria-pressed'),'false');
    await page.locator('button[data-track-mode=single]').click();
    return {max_people:4,empty_safe:true,page_exit_pauses:true,selection_change_pauses:true};
  });
  await check('place labels: direct click opens dossier with real source excerpts', async () => {
    await go(page,'overview');
    const name = await page.locator('#overview-map .historical-place-label').first().textContent();
    await page.locator('#overview-map .historical-place-label').first().click({force:true});
    assert.ok(await page.locator('#place-profile').isVisible());
    const title = await page.locator('#place-profile-title').textContent();
    assert.ok(name.includes(title));
    assert.ok(await page.locator('#place-profile .source-evidence').count()>0);
    const evidence=await page.locator('#place-profile .source-evidence').first().getAttribute('data-source-paragraph');
    await page.screenshot({path:path.join(output,'desktop-place-dossier.png')});
    await page.locator('#place-profile .source-evidence').first().click();
    assert.ok(await page.locator(`#${evidence}`).isVisible());
    assert.equal(await page.locator('#place-profile').isVisible(),false);
    return {place:title,paragraph:evidence};
  });
  await check('local assistant: factual counts, evidence and no unsupported history', async () => {
    await go(page,'assistant');
    await page.locator('#assistant-input').fill('洛阳有什么故事？');
    await page.locator('#assistant-form button[type=submit]').click();
    let answer=page.locator('.assistant-answer').last();
    const expected=await page.evaluate(()=>placeFacts('洛阳').mentions.length);
    assert.ok((await answer.textContent()).includes(`出现 ${expected} 次`));
    assert.ok(await answer.locator('.source-evidence').count()>0);
    const sources=await answer.locator('.source-evidence').evaluateAll(nodes=>nodes.map(n=>n.dataset.sourceParagraph));
    assert.equal(await page.evaluate(ids=>ids.every(id=>state.paragraphTexts.has(id)),sources),true);
    await page.locator('#assistant-input').fill('刘备和曹操有哪些共同地名？');await page.locator('#assistant-input').press('Enter');
    answer=page.locator('.assistant-answer').last();
    assert.ok((await answer.textContent()).includes('不能据此认定同地会面'));
    assert.ok(await answer.locator('[data-profile-name]').count()>0);
    await answer.locator('[data-answer-track]').click();
    assert.equal(await page.locator('#track-map').getAttribute('data-track-mode'),'compare');
    assert.equal(await page.locator('[data-track-series]').count(),2);
    assert.equal(await page.locator('#track-play').getAttribute('aria-pressed'),'true');
    await go(page,'assistant');
    await page.locator('#assistant-input').fill('为什么刘备死于这里？');await page.locator('#assistant-input').press('Enter');
    assert.ok((await page.locator('.assistant-answer').last().textContent()).includes('不能独立核实历史事实或因果'));
    await page.locator('#assistant-input').fill('赤壁在哪里？');await page.locator('#assistant-input').press('Enter');
    assert.ok((await page.locator('.assistant-answer').last().textContent()).includes('现代参照不代表三国位置'));
    await page.locator('#assistant-input').fill('洛阳和成都的数据对比');await page.locator('#assistant-input').press('Enter');
    assert.equal(await page.locator('.assistant-answer').last().locator('[data-profile-name]').count(),2);
    await page.locator('#assistant-input').fill('洛阳有哪些战争事件线索？');await page.locator('#assistant-input').press('Enter');
    assert.ok((await page.locator('.assistant-answer').last().textContent()).includes('这不是经过人工核验的战役清单'));
    await page.locator('[data-ask="地图里有什么有趣的现象？"]').click();
    assert.ok((await page.locator('.assistant-answer').last().textContent()).includes('三个可回查'));
    await page.locator('#assistant-input').fill('<img src=x onerror=alert(1)>月球在哪里');await page.locator('#assistant-input').press('Enter');
    assert.equal(await page.locator('.assistant-question img').count(),0);
    assert.ok((await page.locator('.assistant-answer').last().textContent()).includes('暂未匹配'));
    await page.screenshot({path:path.join(output,'desktop-map-assistant.png'),fullPage:true});
    return {luoyang_occurrences:expected,source_ids_valid:true,dynamic_map_action:true,unsupported_history_declined:true,place_comparison:true,event_candidates_labeled:true,html_escaped:true};
  });
};
exports.mobile = async ({mobile,check,go,output}) => {
  await check('mobile playback, comparison, dossiers and assistant fit 390px and 320px',async()=>{
    for(const width of [390,320]) {
      await mobile.setViewportSize({width,height:844});await go(mobile,'people',true);
      await mobile.locator('button[data-track-mode=compare]').click();
      await seek(mobile,30);
      await mobile.locator('#track-speed').selectOption('175');await mobile.locator('#track-play').click();
      await mobile.waitForFunction(()=>Number(document.getElementById('track-range').value)>30);
      await mobile.locator('#track-play').click();
      assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      const play=await mobile.locator('#track-play').boundingBox(),speed=await mobile.locator('#track-speed').boundingBox();
      assert.ok(play.width>=100); assert.ok(play.x+play.width<=width);assert.ok(speed.x+speed.width<=width);
      await go(mobile,'assistant',true);await mobile.locator('[data-ask="洛阳有什么故事？"]').click();
      await mobile.locator('.assistant-answer [data-profile-name]').last().click();
      assert.ok(await mobile.locator('#place-profile').isVisible());
      const modal=await mobile.locator('#place-profile').boundingBox();assert.ok(modal.width<=width-20);
      await mobile.locator('#profile-ask').click();
      assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      if(width===390)await mobile.screenshot({path:path.join(output,'mobile-map-assistant.png'),fullPage:true});
    }
    await mobile.setViewportSize({width:390,height:844});
    return {widths:[390,320],playback_advanced:true,profile_question_roundtrip:true,overflow:false};
  });
};
