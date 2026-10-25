/* Independent Sanguo map workspace. Design reference: God's Eye View;
 * no upstream source, imagery, feeds, or provider integrations are bundled. */
const cockpit = { sheet: null, evidenceOpen: true, sceneCollapsed: false, theme: "night", ready: false };

function applyAtlasMapTheme(map) {
  const layers = map._atlasBaseLayers;
  if (!layers) return;
  const night = document.documentElement.dataset.theme === "night";
  layers.countries.setStyle({color:night?"#33494f":"#b4bba7",fillColor:night?"#13232c":"#ececde",fillOpacity:1,weight:.7});
  layers.lakes.setStyle({color:night?"#335763":"#a9c0b5",fillColor:night?"#112f3c":"#c4d8cc",fillOpacity:.9});
  layers.rivers.setStyle({color:night?"#335d6c":"#9ebdb2",weight:night?.8:.85,opacity:.8});
  const level=map._adminBoundaryLevel;
  layers.adminGroup.eachLayer(layer=>layer.setStyle?.({color:night?"#38555e":level==="province"?"#9ea98f":"#aab49b",fillColor:night?"#14262f":"#f0efdf",fillOpacity:1,opacity:night?.65:.8,weight:level==="province"?.8:level==="city"?.6:.45}));
}

function setAtlasTheme(theme, persist=true) {
  cockpit.theme = theme === "paper" ? "paper" : "night";
  document.documentElement.dataset.theme = cockpit.theme;
  document.querySelector('meta[name="theme-color"]').setAttribute("content",cockpit.theme==="night"?"#0c1922":"#f5f4ef");
  document.querySelectorAll("[data-atlas-theme]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.atlasTheme===cockpit.theme)));
  $("theme-toggle")?.setAttribute("aria-label",cockpit.theme==="night"?"切换宣纸主题":"切换墨色主题");
  if ($("theme-toggle")) $("theme-toggle").textContent=cockpit.theme==="night"?"☼":"☾";
  Object.values(state.maps).forEach(applyAtlasMapTheme);
  if(persist){try{localStorage.setItem("sanguo-atlas-theme",cockpit.theme);}catch(_){}}
}

function refreshCockpitPanels() {
  const mobile=matchMedia("(max-width: 780px)").matches;
  const scene=$("scene-panel"),evidence=$("overview-evidence"),dock=$("command-dock");
  if(!scene||!evidence||!dock)return;
  scene.hidden=mobile?cockpit.sheet!=="scene":false;
  evidence.hidden=mobile?cockpit.sheet!=="evidence":!cockpit.evidenceOpen;
  dock.hidden=mobile?cockpit.sheet!=="timeline":false;
  $("scene-panel-body").hidden=!mobile&&cockpit.sceneCollapsed;
  $("scene-collapse").setAttribute("aria-expanded",String(!cockpit.sceneCollapsed));
  $("scene-collapse").textContent=cockpit.sceneCollapsed?"＋":"−";
  $("scene-panel").classList.toggle("is-collapsed",!mobile&&cockpit.sceneCollapsed);
  $("evidence-toggle").setAttribute("aria-expanded",String(!evidence.hidden));
  document.querySelectorAll("[data-cockpit-sheet]").forEach(button=>button.setAttribute("aria-expanded",String(cockpit.sheet===button.dataset.cockpitSheet)));
  document.body.classList.toggle("cockpit-sheet-open",mobile&&Boolean(cockpit.sheet));
  document.body.classList.toggle("evidence-collapsed",!mobile&&!cockpit.evidenceOpen);
  if(cockpit.ready)requestAnimationFrame(drawOverviewMap);
}

function openCockpitEvidence() {
  cockpit.evidenceOpen=true;
  if(matchMedia("(max-width: 780px)").matches)cockpit.sheet="evidence";
  document.body.classList.remove("map-focus");
  $("map-focus").setAttribute("aria-pressed","false");
  $("map-focus").setAttribute("aria-label","专注地图");
  $("map-focus").title="专注地图 · F";
  refreshCockpitPanels();
}

function toggleMapFocus() {
  const active=document.body.classList.toggle("map-focus");
  $("map-focus").setAttribute("aria-pressed",String(active));
  $("map-focus").setAttribute("aria-label",active?"退出专注地图":"专注地图");
  $("map-focus").title=active?"退出专注地图 · F":"专注地图 · F";
  if(!active)refreshCockpitPanels();
  requestAnimationFrame(drawOverviewMap);
}

function updateCockpitNavigation() {
  document.body.classList.toggle("is-cockpit",state.page==="overview");
  if($("map-focus"))$("map-focus").setAttribute("aria-pressed",String(document.body.classList.contains("map-focus")));
  if(state.page!=="overview"){cockpit.sheet=null;document.body.classList.remove("cockpit-sheet-open");}
}

function renderQuickSearch() {
  const input=$("quick-search-input"),host=$("quick-search-results"),query=input.value.trim().toLowerCase();
  const actions=[];
  if(!query){
    for(const [name,label] of Object.entries(PAGE_LABELS))actions.push({type:"page",key:name,title:label,detail:"打开工作区",symbol:name==="people"?"route":name==="reader"?"book":"map"});
  } else {
    for(const person of state.people.filter(row=>`${row.canonical_name} ${(row.aliases||[]).join(" ")}`.toLowerCase().includes(query)).slice(0,6))actions.push({type:"person",key:person.character_id,title:person.canonical_name,detail:"人物 · 查看独立叙事轨迹",symbol:"route"});
    for(const place of state.places.filter(row=>row.historical_toponym.toLowerCase().includes(query)).slice(0,12)){
      const geo=geocodeByName(place.historical_toponym);
      actions.push({type:"place",key:place.historical_toponym,title:place.historical_toponym,detail:`地名 · ${STATUS_LABELS[geo?.geocode_status]||"尚未运行"}${geo?.geocode_status==="OK"?geo.matched_period==="modern"?" · 现代参照坐标":" · 历史库候选坐标":""}`,symbol:"pin"});
    }
    for(const chapter of state.chapters.filter(row=>`${String(row.source_ordinal).padStart(3,"0")} ${row.original_title}`.toLowerCase().includes(query)).slice(0,8))actions.push({type:"chapter",key:chapter.source_ordinal,title:chapter.original_title,detail:`原文序号 ${String(chapter.source_ordinal).padStart(3,"0")} · 阅读本章`,symbol:"book"});
  }
  $("quick-search-count").textContent=query?`${actions.length} 条可显示结果`:'快速前往';
  host.innerHTML=actions.length?actions.map((action,index)=>`<button class="quick-result" data-result-index="${index}">${icon(action.symbol)}<span><strong>${escapeHTML(action.title)}</strong><small>${escapeHTML(action.detail)}</small></span>${icon("arrow")}</button>`).join(""):`<div class="empty-state"><h3>没有找到这个线索</h3><p>可试试原文古地名、人物名或章节序号。</p></div>`;
  host.querySelectorAll("[data-result-index]").forEach(button=>button.addEventListener("click",()=>{
    const action=actions[Number(button.dataset.resultIndex)];$("quick-search-dialog").close();
    if(action.type==="page")showPage(action.key);
    if(action.type==="person"){showPage("people");$("track-person").value=action.key;drawTracks();}
    if(action.type==="chapter"){selectChapter(Number(action.key));showPage("reader");document.querySelector(".reader-toolbar").scrollIntoView({block:"start"});}
    if(action.type==="place")locateCockpitPlace(action.key);
  }));
}

function openQuickSearch() {
  if(!cockpit.ready){toast("本地数据仍在装载，请稍候");return;}
  const dialog=$("quick-search-dialog");
  if(!dialog.open)dialog.showModal();
  $("quick-search-input").value="";renderQuickSearch();$("quick-search-input").focus();
}

function locateCockpitPlace(name) {
  const geo=geocodeByName(name);if(!geo)return;
  showPage("overview");
  if(geo.geocode_status==="OK"&&geo.longitude!=null)state.maps.overview.setView([geo.latitude,geo.longitude],6,{animate:false});
  selectPlace(geo);openCockpitEvidence();
}

function setupCockpitShell() {
  const overview=$("page-overview"),world=document.createElement("div"),oldGrid=overview.querySelector(".overview-grid");
  world.id="cockpit-world";world.className="cockpit-world";
  const mapStage=overview.querySelector(".map-stage");
  world.append(mapStage);
  const oldHeading=overview.querySelector(".page-heading");oldHeading.remove();
  const scene=document.createElement("aside");scene.id="scene-panel";scene.className="scene-panel glass-panel";scene.dataset.mapObstacle="";
  scene.innerHTML=`<div class="cockpit-panel-head"><span>${icon("layers")} 场景控制 <small>SCENE</small></span><button id="scene-collapse" class="icon-button" aria-controls="scene-panel-body" aria-expanded="true" aria-label="收起或展开场景控制">−</button></div><div id="scene-panel-body"><p class="cockpit-section-label">语料概况 <span>SOURCE COVERAGE</span></p><div id="scene-stats-slot"></div><div class="cockpit-section-heading"><span>事件筛选</span><span class="quiet-caption">随章节累计</span></div><div id="scene-filters-slot"></div><div class="cockpit-section-heading"><span>可视图层</span><span class="quiet-caption">本地矢量</span></div><div class="cockpit-layers"><label><span><i class="legend-dot war-dot"></i>事件候选</span><input id="layer-events" type="checkbox" checked></label><label><span><i class="legend-dot place-dot"></i>历史库地名坐标</span><input id="layer-historic" type="checkbox" checked></label><label><span><i class="legend-dot modern-dot"></i>现代参照坐标</span><input id="layer-modern" type="checkbox" checked></label><div id="scene-label-slot"></div></div><div class="cockpit-section-heading"><span>快速定位</span><span class="quiet-caption">原文地名</span></div><div id="scene-places" class="scene-places"></div><p class="scene-provenance">2024 现代行政界仅作方位参照。<br>历史含义与坐标身份仍需核验。</p></div>`;
  scene.querySelector("#scene-stats-slot").append($("overview-stats"));
  scene.querySelector("#scene-filters-slot").append(overview.querySelector(".map-controls"));
  scene.querySelector("#scene-label-slot").append(overview.querySelector(".label-toggle"));
  // Home reset belongs to the map toolbar, not to the filter group.
  const reset=scene.querySelector("#overview-reset");
  const evidence=overview.querySelector(".detail-panel");evidence.id="overview-evidence";evidence.dataset.mapObstacle="";
  const closeEvidence=document.createElement("button");closeEvidence.id="evidence-close";closeEvidence.className="icon-button";closeEvidence.setAttribute("aria-label","收起原文证据");closeEvidence.innerHTML=icon("close");evidence.querySelector(".panel-head").append(closeEvidence);
  const heading=document.createElement("div");heading.className="cockpit-heading";heading.dataset.mapObstacle="";
  heading.innerHTML=`<div><p class="eyebrow"><span class="live-dot"></span> SANGUO · NARRATIVE ATLAS</p><h1>三国 · 全境叙事<span>离线空间工作台</span></h1></div><div class="cockpit-map-actions"><button id="cockpit-search" class="secondary-button">${icon("search")} 检索 <kbd>/</kbd></button><button id="evidence-toggle" class="icon-button" aria-label="显示或收起原文证据" aria-controls="overview-evidence" aria-expanded="true" title="原文证据">${icon("file")}</button><button id="map-focus" class="icon-button" aria-label="专注地图" aria-pressed="false" title="专注地图 · F">${icon("focus")}</button><button id="map-fullscreen" class="icon-button" aria-label="全屏显示地图工作台" title="全屏">${icon("expand")}</button></div>`;
  heading.querySelector(".cockpit-map-actions").insertBefore(reset,heading.querySelector("#evidence-toggle"));
  const dock=document.createElement("div");dock.id="command-dock";dock.className="command-dock glass-panel";dock.dataset.mapObstacle="";
  dock.append(overview.querySelector(".timeline-control"));
  dock.insertAdjacentHTML("beforeend",`<div class="dock-display"><p class="cockpit-section-label">地图风格 <span>DISPLAY</span></p><div class="display-presets"><button data-atlas-theme="night" aria-pressed="true"><span>◒</span>墨色</button><button data-atlas-theme="paper" aria-pressed="false"><span>◯</span>宣纸</button></div><a href="#reader">${icon("book")} 阅读当前章 ${icon("arrow")}</a></div>`);
  const hud=document.createElement("div");hud.className="map-telemetry";hud.dataset.mapObstacle="";
  hud.innerHTML=`<span class="telemetry-mode">2D · LOCAL VECTOR</span><span>视图中心 <b id="hud-center">—</b></span><span>缩放 <b id="hud-zoom">—</b><span class="hud-separator">/</span>叙事 <b id="hud-chapter">001</b></span>`;
  const tabs=document.createElement("nav");tabs.className="cockpit-mobile-tabs";tabs.setAttribute("aria-label","地图工作台面板");
  tabs.innerHTML=`<button data-cockpit-sheet="scene" aria-controls="scene-panel" aria-expanded="false">${icon("layers")}<span>场景</span></button><button data-cockpit-sheet="timeline" aria-controls="command-dock" aria-expanded="false">${icon("route")}<span>时间轴</span></button><button data-cockpit-sheet="evidence" aria-controls="overview-evidence" aria-expanded="false">${icon("file")}<span>证据</span></button><button id="mobile-cockpit-search">${icon("search")}<span>检索</span></button>`;
  world.append(heading,scene,evidence,hud,dock,tabs);
  oldGrid.remove();overview.querySelector(".notice-bar")?.remove();overview.append(world);
  overview.classList.add("cockpit-page");
  document.querySelector(".map-inscription")?.remove();
  document.querySelector(".workspace-meta").insertAdjacentHTML("afterbegin",`<button id="global-search" class="global-search" aria-label="检索人物、地名与章节">${icon("search")}<span>检索人物、地名、章节</span><kbd>Ctrl K</kbd></button><button id="theme-toggle" class="icon-button" aria-label="切换宣纸主题" title="切换主题">☼</button>`);
  const sprite=document.querySelector(".icon-sprite defs");sprite.insertAdjacentHTML("beforeend",`<symbol id="icon-layers" viewBox="0 0 24 24"><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></symbol><symbol id="icon-focus" viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8"/></symbol><symbol id="icon-expand" viewBox="0 0 24 24"><path d="M8 3H3v5m18 0V3h-5M3 16v5h5m8 0h5v-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></symbol>`);
  document.body.insertAdjacentHTML("beforeend",`<dialog id="quick-search-dialog" class="quick-search-dialog" aria-labelledby="quick-search-title"><div class="quick-search-head"><div><p class="eyebrow">SEARCH THE NARRATIVE</p><h2 id="quick-search-title">寻找一条三国线索</h2></div><button id="quick-search-close" class="icon-button" aria-label="关闭快速检索">${icon("close")}</button></div><label class="quick-search-field">${icon("search")}<input id="quick-search-input" type="search" autocomplete="off" placeholder="人物、原文地名或章节序号…" aria-label="检索人物、地名或章节序号"></label><p id="quick-search-count" class="quick-search-count"></p><div id="quick-search-results" class="quick-search-results"></div><div class="quick-search-footer"><span>所有结果均来自本地原文与地名志</span><span><kbd>Esc</kbd> 关闭</span></div></dialog>`);
  $("scene-collapse").addEventListener("click",()=>{if(matchMedia("(max-width:780px)").matches)cockpit.sheet=null;else cockpit.sceneCollapsed=!cockpit.sceneCollapsed;refreshCockpitPanels();});
  $("evidence-close").addEventListener("click",()=>{cockpit.evidenceOpen=false;cockpit.sheet=null;refreshCockpitPanels();});
  $("evidence-toggle").addEventListener("click",()=>{if(matchMedia("(max-width:780px)").matches)cockpit.sheet=cockpit.sheet==="evidence"?null:"evidence";else cockpit.evidenceOpen=!cockpit.evidenceOpen;refreshCockpitPanels();});
  $("map-focus").addEventListener("click",toggleMapFocus);
  $("map-fullscreen").addEventListener("click",async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(_){toast("此浏览器暂不支持全屏，可使用专注地图");}});
  document.addEventListener("fullscreenchange",()=>{$("map-fullscreen").setAttribute("aria-label",document.fullscreenElement?"退出全屏":"全屏显示地图工作台");setTimeout(()=>Object.values(state.maps).forEach(map=>map.invalidateSize()),80);});
  for(const id of ["cockpit-search","global-search","mobile-cockpit-search"])$(id).addEventListener("click",openQuickSearch);
  $("quick-search-close").addEventListener("click",()=>$("quick-search-dialog").close());
  $("quick-search-dialog").addEventListener("click",event=>{if(event.target===$("quick-search-dialog")){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
  $("quick-search-input").addEventListener("input",renderQuickSearch);
  $("quick-search-input").addEventListener("keydown",event=>{if(event.key==="ArrowDown"){$("quick-search-results").querySelector("button")?.focus();event.preventDefault();}});
  document.querySelectorAll("[data-cockpit-sheet]").forEach(button=>button.addEventListener("click",()=>{cockpit.sheet=cockpit.sheet===button.dataset.cockpitSheet?null:button.dataset.cockpitSheet;refreshCockpitPanels();}));
  document.querySelectorAll("[data-atlas-theme]").forEach(button=>button.addEventListener("click",()=>setAtlasTheme(button.dataset.atlasTheme)));
  $("theme-toggle").addEventListener("click",()=>setAtlasTheme(cockpit.theme==="night"?"paper":"night"));
  for(const id of ["layer-events","layer-historic","layer-modern"])$(id).addEventListener("change",()=>{if(cockpit.ready)drawOverviewMap();});
  document.addEventListener("keydown",event=>{
    const typing=event.target.closest("input,textarea,select,[contenteditable=true]");
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();openQuickSearch();return;}
    if(!typing&&event.key==="/"){event.preventDefault();openQuickSearch();return;}
    if(event.key==="Escape"&&!$("quick-search-dialog").open){document.body.classList.remove("map-focus");cockpit.sheet=null;refreshCockpitPanels();updateCockpitNavigation();}
    if(!typing&&!event.ctrlKey&&!event.metaKey&&event.key.toLowerCase()==="f"&&state.page==="overview"&&!$("quick-search-dialog").open)toggleMapFocus();
  });
  matchMedia("(max-width:780px)").addEventListener("change",()=>{cockpit.sheet=null;refreshCockpitPanels();setTimeout(()=>Object.values(state.maps).forEach(map=>map.invalidateSize()),60);});
  try{setAtlasTheme(localStorage.getItem("sanguo-atlas-theme")||"night",false);}catch(_){setAtlasTheme("night",false);}
  refreshCockpitPanels();updateCockpitNavigation();
}

function cockpitReady() {
  cockpit.ready=true;
  const map=state.maps.overview;
  const telemetry=()=>{const center=map.getCenter();$("hud-center").textContent=`${Math.abs(center.lat).toFixed(3)}°${center.lat>=0?"N":"S"} ${Math.abs(center.lng).toFixed(3)}°${center.lng>=0?"E":"W"}`;$("hud-zoom").textContent=map.getZoom().toFixed(2);$("hud-chapter").textContent=String(state.selectedChapter).padStart(3,"0");};
  map.on("moveend",telemetry);telemetry();
  $("chapter-range").addEventListener("input",telemetry);
  const observer=new MutationObserver(telemetry);observer.observe($("chapter-value"),{childList:true});
  const places=["洛阳","成都","襄阳","江夏"].map(name=>geocodeByName(name)).filter(row=>row?.geocode_status==="OK");
  $("scene-places").innerHTML=places.map(row=>`<button data-scene-place="${escapeHTML(row.historical_toponym)}" title="${row.matched_period==="modern"?"现代参照坐标，历史含义待核验":"历史库候选坐标"}">${escapeHTML(row.historical_toponym)} ${icon("arrow")}</button>`).join("");
  $("scene-places").querySelectorAll("[data-scene-place]").forEach(button=>button.addEventListener("click",()=>locateCockpitPlace(button.dataset.scenePlace)));
  document.querySelectorAll(".nav-item").forEach(button=>button.title=PAGE_LABELS[button.dataset.page]);
  refreshCockpitPanels();
}
document.addEventListener("DOMContentLoaded",setupCockpitShell);
