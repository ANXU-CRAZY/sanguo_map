import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const debug = "http://127.0.0.1:9222";
const app = "http://127.0.0.1:8765/";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const targetResponse = await fetch(`${debug}/json/new?${encodeURIComponent(app)}`, { method: "PUT" });
if (!targetResponse.ok) throw new Error(`Chrome DevTools target create failed: ${targetResponse.status}`);
const target = await targetResponse.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, {once:true}); ws.addEventListener("error", reject, {once:true}); });
let nextId = 0;
const pending = new Map();
const externalRequests = [];
const httpErrors = [];
const pageErrors = [];
ws.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const slot = pending.get(message.id); pending.delete(message.id);
    if (message.error) slot.reject(new Error(JSON.stringify(message.error)));
    else slot.resolve(message.result);
  }
  if (message.method === "Network.requestWillBeSent") {
    const url = message.params.request.url;
    if (!url.startsWith("http://127.0.0.1:8765/")) externalRequests.push(url);
  }
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
    httpErrors.push({url:message.params.response.url,status:message.params.response.status});
  }
  if (message.method === "Runtime.exceptionThrown") pageErrors.push(message.params.exceptionDetails.text || "page exception");
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    pageErrors.push(message.params.args.map(arg=>arg.value||arg.description||"").join(" "));
  }
});
function cdp(method, params={}) {
  const id=++nextId;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression) {
  const result=await cdp("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression, predicate, limit=100) {
  for(let i=0;i<limit;i++){const value=await evaluate(expression);if(predicate(value))return value;await wait(250);}
  throw new Error(`Timed out waiting for ${expression}`);
}
async function click(selector) {
  const found=await evaluate(`(()=>{const x=document.querySelector(${JSON.stringify(selector)});if(!x)return false;x.click();return true})()`);
  if(!found) throw new Error(`Missing UI control ${selector}`);
  await wait(180);
}
async function screenshot(name) {
  const value=await cdp("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  const output=path.join(root,"outputs","figures",name);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,Buffer.from(value.data,"base64"));
  return path.relative(root,output).replaceAll("\\","/");
}

await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
await cdp("Emulation.setDeviceMetricsOverride",{width:1440,height:1120,deviceScaleFactor:1,mobile:false});
const navigation=await cdp("Page.navigate",{url:app});
await until("document.querySelector('#load-status')?.textContent||''",value=>value.includes("已载入"),180);
const desktopOverview=await evaluate(`({title:document.title,ready:document.readyState,chapters:document.querySelectorAll('#chapter-list .chapter-item').length,stats:[...document.querySelectorAll('.stat-card')].map(x=>x.innerText),map:document.querySelector('#overview-map')?.classList.contains('leaflet-container')||false,eventCanvas:document.querySelectorAll('#overview-map canvas').length})`);
const basemap=await evaluate(`({attribution:document.querySelector('#overview-map .leaflet-control-attribution')?.innerText||'',layerControls:document.querySelectorAll('#overview-map .leaflet-control-layers-selector').length,localSources:performance.getEntriesByType('resource').filter(x=>x.name.includes('/frontend/data/basemap/')).map(x=>new URL(x.name).pathname)})`);
await click('#overview-map .leaflet-control-layers-toggle');
const basemapLayerMenuOpen=await evaluate("document.querySelector('#overview-map .leaflet-control-layers')?.classList.contains('leaflet-control-layers-expanded')");
await click('#overview-map .leaflet-control-layers-toggle');

const chapterOne=await evaluate(`({status:document.querySelector('#map-dynamic-status')?.textContent||'',labels:document.querySelectorAll('#overview-map .historical-place-label').length,events:document.querySelector('#chapter-event-count')?.textContent||''})`);
await evaluate(`(()=>{const x=document.querySelector('#chapter-range');x.value='49';x.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const timeline=await until("document.querySelector('#chapter-value')?.textContent||''",value=>value.includes("49"));
const chapterFortyNine=await evaluate(`({status:document.querySelector('#map-dynamic-status')?.textContent||'',labels:document.querySelectorAll('#overview-map .historical-place-label').length,events:document.querySelector('#chapter-event-count')?.textContent||''})`);
await click("#chapter-play"); await wait(850);
const playback=await evaluate(`({chapter:document.querySelector('#chapter-value')?.textContent||'',playing:document.querySelector('#chapter-play')?.getAttribute('aria-pressed')})`);
await click("#chapter-play");
await evaluate(`(()=>{const x=document.querySelector('#chapter-range');x.value='49';x.dispatchEvent(new Event('input',{bubbles:true}));const f=document.querySelector('#event-filter');f.value='war';f.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const eventFilter=await evaluate("document.querySelector('#map-dynamic-status')?.textContent||''");
await evaluate(`(()=>{const x=document.querySelector('#event-filter');x.value='all';x.dispatchEvent(new Event('change',{bubbles:true}));const labels=document.querySelector('#place-label-toggle');labels.checked=false;labels.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const labelsOff=await evaluate("document.querySelectorAll('#overview-map .historical-place-label').length");
await evaluate(`(()=>{const x=document.querySelector('#place-label-toggle');x.checked=true;x.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const labelsOn=await evaluate("document.querySelectorAll('#overview-map .historical-place-label').length");
const provinceLevel=await evaluate("document.querySelector('#overview-map')?.dataset.adminBoundaryLevel");
const provinceFeatures=await evaluate("Number(document.querySelector('#overview-map')?.dataset.adminBoundaryFeatureCount||0)");
for(let i=0;i<8;i++){await click("#overview-map .leaflet-control-zoom-in");await wait(220)} await wait(500);
const zoomedLabels=await evaluate("document.querySelectorAll('#overview-map .historical-place-label').length");
const countyLevel=await evaluate("document.querySelector('#overview-map')?.dataset.adminBoundaryLevel");
const countyFeatures=await evaluate("Number(document.querySelector('#overview-map')?.dataset.adminBoundaryFeatureCount||0)");
const countyScreenshot=await screenshot("webgis-county-detail.png");
await click(".nav-item[data-page='reader']");
await evaluate(`(()=>{document.querySelector('#text-search').value='赤壁';document.querySelector('#search-button').click()})()`);
await wait(300);
const search={hits:await evaluate("document.querySelectorAll('.search-hit').length"),hasSeededBattlefield:await evaluate("[...document.querySelectorAll('.search-hit')].some(x=>x.innerText.includes('赤壁'))")};
if(search.hits) { await click(".search-hit"); await wait(300); }
search.readerChapter=await evaluate("document.querySelector('#reader-title')?.textContent");
search.highlightCount=await evaluate("document.querySelectorAll('#reader-text mark').length");

await click(".nav-item[data-page='people']"); await wait(350);
const peopleInitial=await evaluate(`({
  selected:document.querySelector('#track-person option:checked')?.textContent||'',
  personId:document.querySelector('#track-map')?.dataset.trackPersonId||'',
  selectorOptions:document.querySelectorAll('#track-person option').length,
  comparisonControls:document.querySelectorAll('#track-person-b,#compare-tracks').length,
  sourceRows:document.querySelectorAll('#track-records .list-row').length,
  nodeCount:Number(document.querySelector('#track-map')?.dataset.trackNodeCount||0),
  locationCount:Number(document.querySelector('#track-map')?.dataset.trackLocationCount||0),
  lineCount:Number(document.querySelector('#track-map')?.dataset.trackLineCount||0),
  status:document.querySelector('#track-status')?.textContent||''
})`);
const singlePersonScreenshot=await screenshot("webgis-single-person-track.png");
await evaluate(`(()=>{const x=document.querySelector('#track-person');x.selectedIndex=Math.min(2,x.options.length-1);x.dispatchEvent(new Event('change',{bubbles:true}))})()`); await wait(220);
const peopleChanged=await evaluate(`({personId:document.querySelector('#track-map')?.dataset.trackPersonId||'',sourceRows:document.querySelectorAll('#track-records .list-row').length,nodeCount:Number(document.querySelector('#track-map')?.dataset.trackNodeCount||0),lineCount:Number(document.querySelector('#track-map')?.dataset.trackLineCount||0)})`);
await evaluate(`(()=>{const x=document.querySelector('#track-person');const o=[...x.options].findIndex(option=>option.textContent==='袁术');if(o>=0){x.selectedIndex=o;x.dispatchEvent(new Event('change',{bubbles:true}))}})()`); await wait(220);
const singlePointTrack=await evaluate(`({selected:document.querySelector('#track-person option:checked')?.textContent||'',sourceRows:document.querySelectorAll('#track-records .list-row').length,nodeCount:Number(document.querySelector('#track-map')?.dataset.trackNodeCount||0),locationCount:Number(document.querySelector('#track-map')?.dataset.trackLocationCount||0),markerCount:Number(document.querySelector('#track-map')?.dataset.trackMarkerCount||0),lineCount:Number(document.querySelector('#track-map')?.dataset.trackLineCount||0),status:document.querySelector('#track-status')?.textContent||''})`);
const peopleSinglePointOK=singlePointTrack.selected==='袁术'&&singlePointTrack.nodeCount===1&&singlePointTrack.locationCount===1&&singlePointTrack.markerCount===1&&singlePointTrack.lineCount===0;
await click("#track-records .list-row"); await wait(220);
const trackPopup=await evaluate(`({open:!!document.querySelector('#track-map .leaflet-popup'),text:document.querySelector('#track-map .leaflet-popup-content')?.innerText||'',button:!!document.querySelector('#track-map .leaflet-popup-content button')})`);
if(trackPopup.button) { await click("#track-map .leaflet-popup-content button"); await wait(250); }
const trackSourceJump=await evaluate(`({page:document.querySelector('#page-reader')?.classList.contains('active')||false,highlight:!!document.querySelector('#reader-text .target-paragraph')})`);
await click(".nav-item[data-page='people']"); await wait(220);
await evaluate(`(()=>{const x=document.querySelector('#track-person');x.selectedIndex=0;x.dispatchEvent(new Event('change',{bubbles:true}))})()`); await wait(220);
const people={...peopleInitial,changedPersonId:peopleChanged.personId,changedNodeCount:peopleChanged.nodeCount,singlePointTrack,trackPopup,trackSourceJump,screenshot:singlePersonScreenshot};
const peopleSinglePersonOK=peopleInitial.selectorOptions>1&&peopleInitial.comparisonControls===0&&peopleInitial.personId&&peopleInitial.nodeCount>0&&peopleInitial.locationCount>0&&peopleInitial.lineCount>0&&peopleChanged.personId!==peopleInitial.personId&&peopleChanged.nodeCount>0&&trackPopup.open&&trackPopup.button&&trackSourceJump.page&&trackSourceJump.highlight;
await click(".nav-item[data-page='analysis']"); await wait(400);
const analysis={status:await evaluate("document.querySelector('#kde-status')?.textContent"),bufferCards:await evaluate("document.querySelectorAll('#buffer-list .buffer-card').length"),caption:await evaluate("document.querySelector('#kde-caption')?.textContent"),canvasCount:await evaluate("document.querySelectorAll('#analysis-map canvas').length")};
await click(".nav-item[data-page='places']");
await evaluate(`(()=>{const x=document.querySelector('#place-search');x.value='赤壁';x.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const places={rows:await evaluate("document.querySelectorAll('#place-table .place-row:not(.header)').length"),content:await evaluate("document.querySelector('#place-table')?.innerText.slice(0,500)")};
await click(".nav-item[data-page='network']");
const networkNodes=await evaluate("document.querySelectorAll('#network-graph .graph-node').length");
await click(".nav-item[data-page='findings']");
const findingCards=await evaluate("document.querySelectorAll('#findings-summary .finding-card').length");
await click(".nav-item[data-page='overview']");
await cdp("Page.navigate",{url:app});
await until("document.querySelector('#load-status')?.textContent||''",value=>value.includes("已载入"),180);
await evaluate("window.scrollTo(0,0)"); await wait(350);
const desktopScreenshot=await screenshot("webgis-desktop.png");

await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
await evaluate("window.dispatchEvent(new Event('resize'))"); await wait(300);
await click("#menu-toggle");
const mobile={menuOpen:await evaluate("document.querySelector('#main-nav')?.classList.contains('open')"),horizontalOverflow:await evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth"),navItems:await evaluate("document.querySelectorAll('#main-nav .nav-item').length")};
await evaluate("window.scrollTo(0,0)"); await wait(250);
const mobileScreenshot=await screenshot("webgis-mobile.png");

const dynamicOK=chapterOne.status!==chapterFortyNine.status&&playback.playing==="true"&&!playback.chapter.includes("49")&&labelsOff===0&&labelsOn>0&&zoomedLabels>0&&eventFilter!==chapterFortyNine.status&&provinceLevel==="province"&&countyLevel==="county"&&provinceFeatures===42&&countyFeatures===2898;
const has2024Layers=basemap.localSources.filter(source=>source.includes('/china_admin_2024/')).length===3;
const report={status:navigation.error||httpErrors.length||pageErrors.length||externalRequests.length||!desktopOverview.map||desktopOverview.chapters!==119||search.hits===0||findingCards!==4||!mobile.menuOpen||!basemap.attribution.includes('2024')||basemap.layerControls!==4||basemap.localSources.length!==6||!has2024Layers||!basemapLayerMenuOpen||!dynamicOK||!peopleSinglePersonOK||!peopleSinglePointOK?"PARTIAL":"PASS",http:navigation,desktopOverview,basemap,has2024Layers,basemapLayerMenuOpen,chapterOne,chapterFortyNine,timeline,playback,eventFilter,labelsOff,labelsOn,zoomedLabels,provinceLevel,provinceFeatures,countyLevel,countyFeatures,dynamicOK,search,people,peopleSinglePersonOK,peopleSinglePointOK,analysis,places,networkNodes,findingCards,mobile,externalRequests,httpErrors,pageErrors,screenshots:[desktopScreenshot,mobileScreenshot,countyScreenshot,singlePersonScreenshot],tool:"Chromium headless via Chrome DevTools Protocol; no browser automation package or external service"};
const reportPath=path.join(root,"outputs","logs","browser_acceptance.json");
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n","utf8");
ws.close();
process.stdout.write(JSON.stringify(report,null,2)+"\n");
