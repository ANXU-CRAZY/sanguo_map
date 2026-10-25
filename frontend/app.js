/* Local-only WebGIS client. All narrative claims come from generated local source evidence. */
const $ = (id) => document.getElementById(id);
const PAGE_LABELS = { overview: "时空总览", reader: "原著阅读", people: "人物行踪", analysis: "战争分析", places: "历史地名", network: "知识网络", findings: "研究发现" };
const EVENT_LABELS = { war: "战争", movement: "行军", politics: "政治", alliance: "结盟", appointment: "任职", death: "死亡" };
const STATUS_LABELS = { OK: "唯一坐标", MULTIPLE_MATCHES: "多候选", NO_MATCH: "未匹配", NOT_RUN_LIMIT: "未运行", COORDINATE_FAILURE: "坐标异常" };
const MAP_HOME = { center: [33.5, 110], zoom: 4.5 };
const ui = { pageScroll: {}, readerFont: 18, placePage: 1, pageSize: 50, graphSelection: null, trackIndex: -1, trackBounds: null, trackLabels: [], trackMarkers: new Map(), selectedEvent: null };
function icon(name) { return `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`; }
function bindRecordAction(node, action) {
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.addEventListener("click", action);
  node.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } });
}
function paragraphText(id) { return state.paragraphTexts?.get(id) || ""; }
const state = { page: "overview", chapters: [], places: [], placeMentions: [], placeMentionsByParagraph: new Map(), people: [], peopleMentions: [], peopleMentionsByParagraph: new Map(), events: [], times: [], geocodes: [], analysis: {}, build: {}, basemap: {}, eventGeo: null, bufferGeo: null, kdeGeo: null, trackGeo: null, selectedChapter: 1, selectedText: "", placeFilter: "all", chapterPlaying: false, chapterTimer: null, maps: {}, layers: {} };

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
async function jsonl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
function number(value) { return new Intl.NumberFormat("zh-CN").format(Number(value || 0)); }
function escapeHTML(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function toast(message) { const node = $("toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2400); }
function byChapter(rows, chapter) { return rows.filter(row => row.chapter_order === chapter); }
function paragraphOrder(event) { return event.narrative_order || event.chapter_order * 1e6 + event.paragraph_order; }
function findChapter(id) { return state.chapters.find(row => row.chapter_id === id); }
function geocodeByName(name) { return state.geocodeIndex?.get(name) || state.geocodes.find(row => row.historical_toponym === name); }

async function loadData() {
  const base = "/data/";
  const [chapters, people, personMentions, placeMentions, places, events, times, geocodes, build, analysis, eventGeo, bufferGeo, kdeGeo, trackGeo, countries, rivers, lakes, adminProvince, adminCity, adminCounty] = await Promise.all([
    json(base + "processed/chapters.json"), json(base + "extracted/characters.json"),
    jsonl(base + "extracted/character_mentions.jsonl"), jsonl(base + "extracted/place_mentions.jsonl"),
    json(base + "extracted/places.json"), jsonl(base + "extracted/event_candidates.jsonl"),
    jsonl(base + "extracted/time_expressions.jsonl"), jsonl(base + "extracted/geocoding_results.jsonl"),
    json("/outputs/logs/build_manifest.json"), json("/outputs/analysis/analysis_summary.json"),
    json("/outputs/geojson/event_candidates_resolved.geojson"), json("/outputs/geojson/battlefield_buffers.geojson"),
    json("/outputs/geojson/war_candidate_kde.geojson"), json("/outputs/geojson/character_narrative_tracks.geojson"),
    json("/frontend/data/basemap/countries.geojson"),
    json("/frontend/data/basemap/rivers.geojson"), json("/frontend/data/basemap/lakes.geojson"),
    json("/frontend/data/basemap/china_admin_2024/province.geojson"),
    json("/frontend/data/basemap/china_admin_2024/city.geojson"),
    json("/frontend/data/basemap/china_admin_2024/county.geojson")
  ]);
  Object.assign(state, { chapters, people, peopleMentions: personMentions, placeMentions, places, events, times, geocodes, build, analysis, eventGeo, bufferGeo, kdeGeo, trackGeo, basemap: { countries, rivers, lakes, adminProvince, adminCity, adminCounty } });
  state.paragraphTexts = new Map();
  state.geocodeIndex = new Map(geocodes.map(row => [row.historical_toponym,row]));
  for (const chapter of chapters) chapter.body.split(/\n[\t ]*\n+/).filter(text => text.length).forEach((text, index) => {
    state.paragraphTexts.set(`${chapter.chapter_id}_p_${String(index + 1).padStart(4,"0")}`, text);
  });
  for (const row of placeMentions) { if (!state.placeMentionsByParagraph.has(row.paragraph_id)) state.placeMentionsByParagraph.set(row.paragraph_id, []); state.placeMentionsByParagraph.get(row.paragraph_id).push(row); }
  for (const row of personMentions) { if (!state.peopleMentionsByParagraph.has(row.paragraph_id)) state.peopleMentionsByParagraph.set(row.paragraph_id, []); state.peopleMentionsByParagraph.get(row.paragraph_id).push(row); }
  $("load-status").textContent = "本地数据已载入";
  $("reader-chapter-count").textContent = `${chapters.length} 章`;
}

function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
  $("menu-toggle").addEventListener("click", () => {
    const open = $("main-nav").classList.toggle("open");
    $("menu-toggle").setAttribute("aria-expanded", String(open));
    $("menu-toggle").setAttribute("aria-label", open ? "关闭导航" : "打开导航");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      $("main-nav").classList.remove("open");
      $("menu-toggle").setAttribute("aria-expanded", "false");
      $("menu-toggle").setAttribute("aria-label", "打开导航");
    }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".topbar") && $("main-nav").classList.contains("open")) {
      $("main-nav").classList.remove("open");
      $("menu-toggle").setAttribute("aria-expanded", "false");
      $("menu-toggle").setAttribute("aria-label", "打开导航");
    }
  });
  window.addEventListener("hashchange", () => { const name = location.hash.slice(1); if (["overview","reader","people","analysis","places","network","findings"].includes(name)) showPage(name, false); });
}
function showPage(name, updateHash = true) {
  if (!PAGE_LABELS[name]) return;
  const previous = state.page;
  if (previous !== name) ui.pageScroll[previous] = window.scrollY;
  state.page = name;
  if (name !== "overview") stopChapterPlayback();
  $("current-page-label").textContent = PAGE_LABELS[name];
  document.title = `${PAGE_LABELS[name]} · 三国时空`;
  document.querySelectorAll(".page").forEach(node => node.classList.toggle("active", node.id === `page-${name}`));
  document.querySelectorAll(".nav-item").forEach(node => {
    node.classList.toggle("active", node.dataset.page === name);
    if (node.dataset.page === name) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  $("main-nav").classList.remove("open");
  $("menu-toggle").setAttribute("aria-expanded", "false");
  $("menu-toggle").setAttribute("aria-label", "打开导航");
  if (updateHash) history.replaceState(null, "", `#${name}`);
  setTimeout(() => Object.values(state.maps).forEach(map => map?.invalidateSize()), 40);
  if (name === "network") drawNetwork();
  if (name === "analysis") renderAnalysisMap();
  if (name === "overview") selectChapter(state.selectedChapter);
  if (name === "reader") renderReaderChapter(state.selectedChapter);
  if (name === "people") drawTracks();
  if (previous !== name) window.scrollTo({ top: ui.pageScroll[name] || 0, behavior: "instant" });
}

function mapWithGrid(elementId, center = [35, 105], zoom = 3.7) {
  const map = L.map(elementId, { zoomControl: false, attributionControl: true, preferCanvas: true, minZoom: 3, maxZoom: 9, zoomSnap: .25 }).setView(center, zoom);
  L.control.zoom({ position: "bottomright", zoomInTitle: "放大地图", zoomOutTitle: "缩小地图" }).addTo(map);
  for (const [name, zIndex] of [["base-land", 200], ["base-water", 220], ["base-grid", 230]]) {
    map.createPane(name);
    map.getPane(name).style.zIndex = String(zIndex);
  }
  map.getPane("base-grid").style.pointerEvents = "none";
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  map.attributionControl.addAttribution("现代行政界：2024 · GS（2024）0650号；周边与水系：Natural Earth");
  const surroundingCountries = { ...state.basemap.countries, features: state.basemap.countries.features.filter(feature => feature.properties.admin !== "China") };
  const countries = L.geoJSON(surroundingCountries, {
    pane: "base-land",
    style: feature => ({
      color: "#b4bba7",
      weight: feature.properties.admin === "China" ? 1.2 : .8,
      opacity: .9,
      fillColor: "#ececde",
      fillOpacity: .92
    }),
    onEachFeature: (feature, layer) => {
      const name = feature.properties.name_zh || feature.properties.name;
      if (name) layer.bindTooltip(name, { sticky: true, className: "map-label" });
    }
  }).addTo(map);
  const lakes = L.geoJSON(state.basemap.lakes, {
    pane: "base-water",
    style: { color: "#a9c0b5", weight: .5, opacity: .85, fillColor: "#c4d8cc", fillOpacity: .9 },
    onEachFeature: (feature, layer) => {
      const name = feature.properties.name_zh || feature.properties.name;
      if (name) layer.bindTooltip(name, { sticky: true, className: "map-label water-label" });
    }
  }).addTo(map);
  const rivers = L.geoJSON(state.basemap.rivers, {
    pane: "base-water",
    style: { color: "#9ebdb2", weight: .85, opacity: .8 },
    onEachFeature: (feature, layer) => {
      const name = feature.properties.name_zh || feature.properties.name;
      if (name) layer.bindTooltip(name, { sticky: true, className: "map-label water-label" });
    }
  }).addTo(map);
  const adminGroup = L.layerGroup().addTo(map);
  let activeAdminLevel = null;
  const drawAdminLevel = () => {
    const zoom = map.getZoom();
    const level = zoom < 5 ? "province" : zoom < 7 ? "city" : "county";
    if (level === activeAdminLevel) return;
    activeAdminLevel = level;
    adminGroup.clearLayers();
    const style = level === "province"
      ? { color: "#9ea98f", weight: .85, opacity: .8, fillColor: "#f0efdf", fillOpacity: 1 }
      : level === "city"
        ? { color: "#aab49b", weight: .6, opacity: .75, fillColor: "#f0efdf", fillOpacity: 1 }
      : { color: "#b4bca7", weight: .45, opacity: .65, fillColor: "#f0efdf", fillOpacity: 1 };
    const data = state.basemap[`admin${level[0].toUpperCase()}${level.slice(1)}`];
    L.geoJSON(data, { pane: "base-land", style, interactive: false }).addTo(adminGroup);
    map._adminBoundaryLevel = level;
    map.getContainer().dataset.adminBoundaryLevel = level;
    map.getContainer().dataset.adminBoundaryFeatureCount = String(data.features.length);
  };
  drawAdminLevel();
  map.on("zoomend", drawAdminLevel);
  L.control.layers(null, { "周边国家（Natural Earth）": countries, "中国行政区界（2024，随缩放切换）": adminGroup, "河流": rivers, "湖泊": lakes }, { collapsed: true }).addTo(map);
  L.control.scale({ imperial: false, maxWidth: 100 }).addTo(map);
  for (let lat = 15; lat <= 55; lat += 10) L.polyline([[lat, 72], [lat, 135]], { pane: "base-grid", color: "#91a084", weight: .45, opacity: .15, dashArray: "2 6", interactive: false }).addTo(map);
  for (let lon = 75; lon <= 135; lon += 10) L.polyline([[15, lon], [55, lon]], { pane: "base-grid", color: "#91a084", weight: .45, opacity: .15, dashArray: "2 6", interactive: false }).addTo(map);
  return map;
}
function setupMaps() {
  state.maps.overview = mapWithGrid("overview-map", MAP_HOME.center, MAP_HOME.zoom);
  state.maps.tracks = mapWithGrid("track-map", [35, 105], 3.7);
  state.maps.analysis = mapWithGrid("analysis-map", [35, 105], 3.7);
  state.layers.overview = L.layerGroup().addTo(state.maps.overview);
  state.layers.tracks = L.layerGroup().addTo(state.maps.tracks);
  state.layers.analysis = L.layerGroup().addTo(state.maps.analysis);
  state.maps.overview.on("moveend", drawOverviewMap);
  state.maps.tracks.on("moveend", refreshTrackLabels);
  drawOverviewMap();
  renderAnalysisMap();
}

function metricCard(label, value, note, symbol) {
  return `<div class="stat-card"><span>${escapeHTML(label)}${icon(symbol)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(note || "")}</small></div>`;
}
function renderSummary() {
  const ex = state.build.extraction;
  const geo = state.build.geocoding;
  const db = state.build.database.counts;
  const resolved = geo.coordinate_status_counts?.OK || 0;
  const ambiguous = geo.coordinate_status_counts?.MULTIPLE_MATCHES || 0;
  const failed = (geo.coordinate_status_counts?.NO_MATCH || 0) + (geo.coordinate_status_counts?.COORDINATE_FAILURE || 0);
  $("overview-stats").innerHTML = [
    metricCard("原文章节", String(state.chapters.length), "119 / 119 章 · 完整载入", "book"),
    metricCard("原文段落", number(ex.paragraph_count_processed), "每一段，皆有出处", "file"),
    metricCard("事件候选", number(ex.event_candidate_count), "规则提取 · 待核验", "swords"),
    metricCard("唯一坐标地名", number(resolved), `含 ${number(geo.coordinate_source_period_counts?.modern||0)} 个现代参照`, "pin"),
    metricCard("人物提及", number(ex.character_mention_count), `覆盖 ${state.people.length} 位种子人物`, "people")
  ].join("");
  renderChapterList();
  fillPeopleSelectors();
  renderChapterEvents();
  renderReaderChapter(1);
  renderPlaces();
  renderFindings();
  renderBufferCards();
  renderAnalysisAccounting({ resolved, ambiguous, failed, db });
  updateChapterPresentation();
}

function renderChapterList() {
  const list = $("chapter-list");
  list.replaceChildren();
  const query = ($("chapter-search").value || "").trim().toLowerCase();
  const chapters = state.chapters.filter(chapter => `${String(chapter.source_ordinal).padStart(3,"0")} ${chapter.original_title}`.toLowerCase().includes(query));
  $("reader-chapter-count").textContent = `${chapters.length} / ${state.chapters.length} 章`;
  for (const chapter of chapters) {
    const button = document.createElement("button");
    button.className = `chapter-item${chapter.source_ordinal === state.selectedChapter ? " active" : ""}`;
    button.dataset.chapterOrder = String(chapter.source_ordinal);
    button.title = chapter.original_title;
    button.setAttribute("aria-current", chapter.source_ordinal === state.selectedChapter ? "true" : "false");
    button.innerHTML = `<span>${String(chapter.source_ordinal).padStart(3,"0")}</span><span class="chapter-item-title">${escapeHTML(chapter.original_title.replace(/^第[^\s章回]+[章回]\s*/, ""))}</span>`;
    button.addEventListener("click", () => {
      selectChapter(chapter.source_ordinal); showPage("reader");
      document.querySelector(".reader-toolbar").scrollIntoView({block:"start"});
    });
    list.append(button);
  }
  if (!chapters.length) list.innerHTML = `<div class="empty-state compact-empty"><p>没有找到这个章节。<br>试试序号或章名中的词语。</p></div>`;
}
function selectChapter(ordinal) {
  state.selectedChapter = Math.min(119, Math.max(1, Number(ordinal)));
  $("chapter-range").value = String(state.selectedChapter);
  $("chapter-value").textContent = `第 ${state.selectedChapter} / 119 章`;
  updateChapterPresentation();
  document.querySelectorAll(".chapter-item").forEach(node => {
    const selected = Number(node.dataset.chapterOrder) === state.selectedChapter;
    node.classList.toggle("active", selected); node.setAttribute("aria-current", String(selected));
  });
  renderChapterEvents();
  if (state.page === "reader") renderReaderChapter(state.selectedChapter);
  drawOverviewMap();
}
function updateChapterPresentation() {
  $("timeline-chapter-title").textContent = state.chapters.find(chapter => chapter.source_ordinal === state.selectedChapter)?.original_title || "";
  $("chapter-range").style.setProperty("--progress", `${(state.selectedChapter - 1) / 118 * 100}%`);
  $("chapter-prev").disabled = state.selectedChapter <= 1;
  $("chapter-next").disabled = state.selectedChapter >= 119;
}
function stopChapterPlayback() {
  state.chapterPlaying = false;
  if (state.chapterTimer) clearInterval(state.chapterTimer);
  state.chapterTimer = null;
  const button = $("chapter-play");
  if (button) { button.textContent = "▶ 逐章播放"; button.setAttribute("aria-pressed", "false"); }
}
function toggleChapterPlayback() {
  if (state.chapterPlaying) { stopChapterPlayback(); return; }
  if (state.selectedChapter >= 119) selectChapter(1);
  state.chapterPlaying = true;
  const button = $("chapter-play");
  button.textContent = "Ⅱ 暂停";
  button.setAttribute("aria-pressed", "true");
  state.chapterTimer = setInterval(() => {
    if (state.selectedChapter >= 119) { stopChapterPlayback(); return; }
    selectChapter(state.selectedChapter + 1);
  }, Number($("chapter-speed").value));
}
function renderChapterEvents() {
  const list = $("chapter-event-list");
  const type = $("event-filter").value, personId = $("person-filter").value;
  const rows = byChapter(state.events, state.selectedChapter).filter(event =>
    (type === "all" || event.event_type_candidate === type) && (personId === "all" || event.candidate_person_ids.includes(personId)));
  $("overview-clear-filters").hidden = type === "all" && personId === "all";
  $("chapter-event-count").textContent = `${number(rows.length)} 条候选`;
  list.replaceChildren();
  rows.slice(0, 80).forEach((event, index) => {
    const row = document.createElement("div");
    row.className = "list-row event-list-row";
    row.dataset.eventId = event.event_id;
    row.classList.toggle("active", ui.selectedEvent === event.event_id);
    row.setAttribute("aria-pressed", String(ui.selectedEvent === event.event_id));
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `查看${event.trigger_surface || EVENT_LABELS[event.event_type_candidate] || event.event_type_candidate}原文证据`);
    row.innerHTML = `<span class="list-row-index">${String(index + 1).padStart(2,"0")}</span><div class="list-row-body"><div class="list-row-title">${escapeHTML(event.trigger_surface || EVENT_LABELS[event.event_type_candidate] || event.event_type_candidate)}<span class="event-type">${escapeHTML(EVENT_LABELS[event.event_type_candidate] || event.event_type_candidate)}</span></div><div class="list-row-meta" title="${escapeHTML(event.paragraph_id)}">第 ${event.chapter_order} 章 · 原文可查</div><div class="list-row-excerpt">${escapeHTML(event.candidate_summary)}</div></div>`;
    row.addEventListener("click", () => selectEvent(event));
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectEvent(event); } });
    list.append(row);
  });
  if (!rows.length) list.innerHTML = `<div class="empty-state compact-empty">${type !== "all" || personId !== "all" ? "本章没有符合筛选的事件线索。可清除筛选，或切换章节。" : "本章暂无规则识别的事件线索。仍可点击地图地名，查看原文出处。"}</div>`;
}
function renderReaderChapter(ordinal, targetParagraph = null) {
  const chapter = state.chapters.find(row => row.source_ordinal === Number(ordinal));
  if (!chapter) return;
  state.selectedChapter = chapter.source_ordinal;
  $("chapter-range").value = String(state.selectedChapter);
  $("chapter-value").textContent = `第 ${state.selectedChapter} / ${state.chapters.length} 章`;
  updateChapterPresentation();
  $("reader-chapter-id").textContent = `原文序号 ${String(chapter.source_ordinal).padStart(3,"0")} / ${state.chapters.length} · 保留源章名`;
  $("reader-source-file").textContent = chapter.source_filename;
  $("reader-position").textContent = `${chapter.source_ordinal} / ${state.chapters.length}`;
  $("reader-prev").disabled = chapter.source_ordinal <= 1;
  $("reader-next").disabled = chapter.source_ordinal >= state.chapters.length;
  $("reader-prev").title = state.chapters[chapter.source_ordinal - 2]?.original_title || "已到第一章";
  $("reader-next").title = state.chapters[chapter.source_ordinal]?.original_title || "已到最后一章";
  $("reader-title").textContent = chapter.original_title;
  const article = $("reader-text");
  article.replaceChildren();
  chapter.body.split(/\n[\t ]*\n+/).filter(text => text.length).forEach((text, index) => {
    const p = document.createElement("p");
    p.dataset.paragraphOrder = String(index + 1);
    p.id = `${chapter.chapter_id}_p_${String(index + 1).padStart(4,"0")}`;
    appendHighlighted(p, text, state.selectedText);
    article.append(p);
  });
  document.querySelectorAll(".chapter-item").forEach(node => {
    const selected = Number(node.dataset.chapterOrder) === chapter.source_ordinal;
    node.classList.toggle("active", selected); node.setAttribute("aria-current", String(selected));
  });
  if (targetParagraph) {
    const target = $(targetParagraph);
    if (target) { target.classList.add("target-paragraph"); target.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
}
function appendHighlighted(parent, text, term) {
  if (!term) { parent.textContent = text; return; }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  let cursor = 0, match;
  while ((match = regex.exec(text)) !== null) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const mark = document.createElement("mark"); mark.textContent = match[0]; parent.append(mark);
    cursor = match.index + match[0].length;
    if (!match[0].length) regex.lastIndex++;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}
function searchText() {
  const term = $("text-search").value.trim();
  if (!term) { clearTextSearch(); return; }
  $("clear-text-search").disabled = false;
  state.selectedText = term;
  const hits = [];
  for (const chapter of state.chapters) {
    const at = chapter.body.indexOf(term);
    if (at >= 0) hits.push({ chapter, at, excerpt: chapter.body.slice(Math.max(0, at - 45), Math.min(chapter.body.length, at + term.length + 70)).replace(/\s+/g, " ") });
  }
  const target = $("search-results");
  target.replaceChildren();
  const label = document.createElement("p"); label.className = "eyebrow"; label.textContent = `命中 ${hits.length} 个章节`; target.append(label);
  hits.forEach(hit => {
    const row = document.createElement("div"); row.className = "search-hit";
    row.innerHTML = `<strong>${String(hit.chapter.source_ordinal).padStart(3,"0")} · ${escapeHTML(hit.chapter.original_title)}</strong><div>${escapeHTML(hit.excerpt)}</div>`;
    bindRecordAction(row, () => {
      selectChapter(hit.chapter.source_ordinal);
      const p = $("reader-text").querySelector("mark")?.closest("p");
      if (p) { p.classList.add("target-paragraph"); p.scrollIntoView({behavior:"smooth",block:"center"}); }
    });
    target.append(row);
  });
  if (!hits.length) target.insertAdjacentHTML("beforeend", `<div class="empty-state compact-empty">原文中没有找到“${escapeHTML(term)}”。试试人物的其他称谓，或缩短关键词。</div>`);
}
function clearTextSearch() {
  state.selectedText = ""; $("text-search").value = ""; $("search-results").replaceChildren();
  $("clear-text-search").disabled = true; renderReaderChapter(state.selectedChapter);
}
function setReaderFont(value, persist = true) {
  ui.readerFont = Math.max(16, Math.min(24, Number(value) || 18));
  $("reader-text").style.setProperty("--reader-font", `${ui.readerFont}px`);
  $("reader-font-value").textContent = String(ui.readerFont);
  $("reader-font-smaller").disabled = ui.readerFont <= 16;
  $("reader-font-larger").disabled = ui.readerFont >= 24;
  if (persist) { try { localStorage.setItem("sanguo-reader-font", String(ui.readerFont)); } catch (_) { /* Preference is optional. */ } }
}

function popupNode(title, subtitle, excerpt, action) {
  const box = document.createElement("div");
  const h = document.createElement("strong"); h.textContent = title; box.append(h);
  const small = document.createElement("div"); small.textContent = subtitle; box.append(small);
  const p = document.createElement("p"); p.textContent = excerpt || "无可展示的原文摘要"; box.append(p);
  const button = document.createElement("button"); button.textContent = "查看原文证据"; button.className = "primary-button"; button.addEventListener("click", action); box.append(button);
  return box;
}
function selectEvent(event) {
  ui.selectedEvent = event.event_id;
  $("chapter-event-list").querySelectorAll("[data-event-id]").forEach(node => {
    const selected = node.dataset.eventId === event.event_id;
    node.classList.toggle("active", selected);
    node.setAttribute("aria-pressed", String(selected));
  });
  $("selection-kind").textContent = `${EVENT_LABELS[event.event_type_candidate] || event.event_type_candidate} · 候选`;
  const content = $("selection-content");
  content.className = "selection-content";
  content.innerHTML = `<h3>${escapeHTML(event.trigger_surface || EVENT_LABELS[event.event_type_candidate] || event.event_type_candidate)} <span class="pill" title="${escapeHTML(event.event_review_status)}">待核验</span></h3><div class="evidence-meta"><span>第 ${event.chapter_order} 章</span><span>${escapeHTML(event.paragraph_id)}</span></div><p>${escapeHTML(event.source_excerpt)}</p><div class="evidence-note">叙事候选；未进行人工事件切分或历史核验。</div><button id="read-selected" class="primary-button">跳转原文段落 ${icon("arrow")}</button>`;
  $("read-selected").addEventListener("click", () => jumpToParagraph(event.chapter_id, event.paragraph_id));
}
function selectPlace(geocode) {
  const content = $("selection-content");
  content.className = "selection-content";
  const features = state.placeMentions.filter(row => row.historical_toponym === geocode.historical_toponym);
  $("selection-kind").textContent = `${STATUS_LABELS[geocode.geocode_status] || geocode.geocode_status} · ${features.length} 处原文`;
  const hs=geocode.historical_screen_status||"NOT_RUN", hp=geocode.historical_screen_period_status||"UNKNOWN";
  const hx=geocode.historical_screen_longitude==null?"未得到唯一历史库坐标":`${Number(geocode.historical_screen_longitude).toFixed(5)}, ${Number(geocode.historical_screen_latitude).toFixed(5)} · MED ${geocode.historical_screen_med_km==null?"?":Number(geocode.historical_screen_med_km).toFixed(2)+" km"}`;
  const period = { historic: "历史地名志", modern: "现代地名志参照" }[geocode.matched_period] || "来源时期未确定";
  const periods = { OVERLAPS_PROJECT_ANALYSIS_WINDOW: "与研究年代范围重叠", HISTORIC_PERIOD_UNKNOWN: "地名志年代未知", OUTSIDE_PROJECT_ANALYSIS_WINDOW: "不在研究年代范围内", NO_HISTORIC_GAZETTEER_MATCH: "历史库未匹配", MULTIPLE_HISTORIC_CANDIDATES: "历史库存在多候选" };
  const paragraphs = [...new Map(features.map(row => [row.paragraph_id, row])).values()];
  content.innerHTML = `<h3>${escapeHTML(geocode.historical_toponym)}</h3><div class="evidence-meta"><span>${escapeHTML(period)}</span><span>${features.length} 处提及 · ${paragraphs.length} 段原文</span></div><dl class="place-detail-grid"><div><dt>匹配坐标 · 经度 / 纬度</dt><dd>${geocode.longitude == null ? "尚无唯一坐标" : `${Number(geocode.longitude).toFixed(5)}, ${Number(geocode.latitude).toFixed(5)}`}</dd></div><div><dt>最大误差距离（MED）</dt><dd>${geocode.maximum_error_distance_km == null ? "未确定" : `${Number(geocode.maximum_error_distance_km).toFixed(2)} km`}</dd></div></dl><div class="evidence-note">历史库独立筛查：${escapeHTML(STATUS_LABELS[hs] || "未取得唯一结果")}；${escapeHTML(periods[hp] || "年代状态待核验")}。${escapeHTML(hx)}。地名含义仍待核验。</div><details class="evidence-technical"><summary>地名志候选与原始审核状态</summary><p>${escapeHTML((geocode.matched_gazetteer || []).join("、") || "无候选编号")}</p><code>${escapeHTML(geocode.match_status || "UNKNOWN")} · ${escapeHTML(hs)} · ${escapeHTML(hp)}</code></details><h4 class="evidence-section-label">原文出处 <span>展示 ${Math.min(6, paragraphs.length)} / ${paragraphs.length} 段</span></h4><div class="source-preview-list">${paragraphs.slice(0,6).map(row=>`<div class="list-row" data-paragraph="${escapeHTML(row.paragraph_id)}" data-chapter="${escapeHTML(row.chapter_id)}"><div class="list-row-meta">第 ${row.chapter_order} 章 · ${escapeHTML(row.paragraph_id)}</div><div class="list-row-excerpt">${escapeHTML(paragraphText(row.paragraph_id).slice(0,160) || row.source_file)}</div></div>`).join("")}</div>`;
  content.querySelectorAll("[data-paragraph]").forEach(node => bindRecordAction(node, () => jumpToParagraph(node.dataset.chapter, node.dataset.paragraph)));
}
function jumpToParagraph(chapterId, paragraphId) {
  const chapter = findChapter(chapterId);
  if (!chapter) return;
  const ordinal = chapter.source_ordinal;
  showPage("reader");
  renderReaderChapter(ordinal, paragraphId);
}

function drawOverviewMap() {
  const map = state.maps.overview, group = state.layers.overview;
  if (!map || !state.eventGeo) return;
  group.eachLayer(layer => {
    const tooltip = layer.getTooltip?.();
    if (tooltip?.options?.className === "historical-place-label") {
      layer.closeTooltip();
      layer.unbindTooltip();
    }
  });
  map.getContainer().querySelectorAll(".historical-place-label").forEach(node=>node.remove());
  group.clearLayers();
  const type = $("event-filter").value;
  const personId = $("person-filter").value;
  let visibleEventCount = 0;
  state.eventGeo.features.forEach(feature => {
    const props = feature.properties;
    if (props.chapter_order > state.selectedChapter || (type !== "all" && props.event_type_candidate !== type)) return;
    const participants = JSON.parse(props.candidate_person_ids || "[]");
    if (personId !== "all" && !participants.includes(personId)) return;
    visibleEventCount += 1;
    const war = props.event_type_candidate === "war";
    const marker = L.circleMarker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], { radius: war ? 6 : 4, color: war ? "#8d473e" : "#397f79", weight: 1, fillColor: war ? "#c76556" : "#66aaa0", fillOpacity: .78 });
    marker.bindPopup(popupNode(`${EVENT_LABELS[props.event_type_candidate] || props.event_type_candidate} · ${props.historical_toponym}`, `第 ${props.chapter_order} 章 · ${props.paragraph_id}`, props.source_excerpt, () => jumpToParagraph(props.chapter_id, props.paragraph_id)));
    marker.on("click", () => {
      const event = state.events.find(row => row.event_id === props.event_id);
      if (event) selectEvent(event);
    });
    marker.addTo(group);
  });
  const visibleNames = new Set(state.placeMentions.filter(row=>row.chapter_order<=state.selectedChapter).map(row=>row.historical_toponym));
  const coordinateGroups = new Map();
  for (const result of state.geocodes) {
    if (result.geocode_status !== "OK" || result.longitude == null || !visibleNames.has(result.historical_toponym)) continue;
    const key = `${Number(result.longitude).toFixed(5)},${Number(result.latitude).toFixed(5)}`;
    if (!coordinateGroups.has(key)) coordinateGroups.set(key, []);
    coordinateGroups.get(key).push(result);
  }
  const placeGroups = [...coordinateGroups.values()].map(rows => rows.sort((a,b)=>(b.project_source_occurrence_count||0)-(a.project_source_occurrence_count||0)));
  placeGroups.sort((a,b)=>(b[0].project_source_occurrence_count||0)-(a[0].project_source_occurrence_count||0));
  const zoom = map.getZoom();
  const labelLimit = zoom < 4.1 ? 12 : zoom < 5.1 ? 36 : zoom < 6.4 ? 70 : 110;
  const showLabels = $("place-label-toggle")?.checked !== false;
  const viewBounds = map.getBounds();
  let labelCount = 0;
  const labelBoxes = mapLabelObstacles(map);
  placeGroups.forEach(rows => {
    const result = rows[0];
    const names = rows.map(row=>row.historical_toponym);
    const ancientLabel = names.slice(0,3).join(" · ") + (names.length > 3 ? ` +${names.length-3}` : "");
    const modern=result.matched_period==="modern";
    const marker=L.circleMarker([result.latitude,result.longitude],{radius:4,color:modern?"#596f89":"#397f79",weight:1.15,fillColor:modern?"#8299b5":"#68b3a9",fillOpacity:.86});
    marker.bindPopup(popupNode(names.join("、"),`${result.matched_period||"unknown"} Gazetteer 候选 · ${rows.reduce((sum,row)=>sum+(row.project_source_occurrence_count||0),0)} 次原文命中`,modern?"现代地名志候选坐标；不代表三国地名的历史位置。":"历史地名志候选坐标；地名含义与年代仍需核验。",()=>selectPlace(result)));
    const inView = viewBounds.contains([result.latitude,result.longitude]);
    const placement = showLabels && inView && labelCount < labelLimit ? findLabelPlacement(map, [result.latitude,result.longitude], ancientLabel, labelBoxes) : null;
    if (placement) {
      marker.bindTooltip(escapeHTML(ancientLabel),{permanent:true,...placement,className:"historical-place-label",opacity:.98});
      labelCount += 1;
    }
    marker.addTo(group);
  });
  $("map-dynamic-status").textContent = `第 ${state.selectedChapter} 章及以前 · ${number(visibleEventCount)} 条事件候选 · ${number(placeGroups.length)} 处有坐标的原文地名${showLabels ? ` · 当前视野标注 ${number(labelCount)} 个古地名` : " · 地名标签已关闭"}`;
}
function mapLabelObstacles(map) {
  const rect = map.getContainer().getBoundingClientRect();
  const controls = [...map.getContainer().querySelectorAll(".leaflet-control")];
  const stage = map.getContainer().closest(".map-stage");
  if (stage) controls.push(...stage.querySelectorAll(".map-inscription, .map-compass"));
  return controls.map(node => node.getBoundingClientRect()).filter(box => box.width > 0 && box.height > 0).map(box => ({ left: box.left-rect.left-5, right: box.right-rect.left+5, top: box.top-rect.top-5, bottom: box.bottom-rect.top+5 }));
}

// Reserve screen rectangles for labels; candidate coordinates and identities stay untouched.
function findLabelPlacement(map, latlng, text, occupied) {
  const point = map.latLngToContainerPoint(latlng), size = map.getSize();
  const width = [...text].reduce((sum, char) => sum + (/[\u2e80-\u9fff]/.test(char) ? 12 : 6.5), 16);
  const height = 27, gap = 10;
  const candidates = [
    {direction:"right", offset:[7,0], x:point.x+gap, y:point.y-height/2},
    {direction:"left", offset:[-7,0], x:point.x-gap-width, y:point.y-height/2},
    {direction:"top", offset:[0,-7], x:point.x-width/2, y:point.y-gap-height},
    {direction:"bottom", offset:[0,7], x:point.x-width/2, y:point.y+gap}
  ];
  for (const item of candidates) {
    const box = {left:item.x-4, top:item.y-4, right:item.x+width+4, bottom:item.y+height+4};
    if (box.left < 9 || box.right > size.x-9 || box.top < 8 || box.bottom > size.y-18) continue;
    if (occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
    occupied.push(box);
    return {direction:item.direction,offset:item.offset};
  }
  return null;
}

function fillPeopleSelectors() {
  const personOptions = state.people.map(row => `<option value="${escapeHTML(row.character_id)}">${escapeHTML(row.canonical_name)}</option>`).join("");
  for (const id of ["person-filter","track-person"]) {
    const el = $(id); if (!el) continue;
    el.innerHTML = id === "person-filter" ? `<option value="all">所有人物</option>${personOptions}` : personOptions;
  }
}
function drawTracks() {
  const group = state.layers.tracks; if (!group) return;
  group.clearLayers();
  ui.trackLabels = []; ui.trackMarkers = new Map(); ui.trackIndex = -1;
  const personId = $("track-person")?.value;
  const person = state.people.find(row => row.character_id === personId);
  $("track-monogram").textContent = person?.canonical_name.slice(0,1) || "人";
  const map = state.maps.tracks;
  const container = map?.getContainer();
  const mentions = state.peopleMentions.filter(row => row.character_ids.includes(personId));
  const occurrences = new Map();
  for (const personMention of mentions) {
    const placeRows = state.placeMentionsByParagraph.get(personMention.paragraph_id) || [];
    for (const row of placeRows) {
      const source = geocodeByName(row.historical_toponym);
      if (source?.historical_screen_longitude == null || source?.historical_screen_latitude == null) continue;
      const lon = Number(source.historical_screen_longitude), lat = Number(source.historical_screen_latitude);
      const validPeriod = ["OVERLAPS_PROJECT_ANALYSIS_WINDOW", "HISTORIC_PERIOD_UNKNOWN"].includes(source?.historical_screen_period_status);
      if (source?.historical_screen_status !== "OK" || !validPeriod || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
      // Keep one node per named place in each source paragraph; repeated lexical spans
      // otherwise create duplicate points and zero-length line segments.
      const key = `${row.chapter_id}|${row.paragraph_id}|${row.historical_toponym}`;
      if (!occurrences.has(key)) occurrences.set(key, {
        person: person?.canonical_name || personMention.canonical_names[0] || personId,
        row, longitude: lon, latitude: lat,
        med: source.historical_screen_med_km,
        periodStatus: source.historical_screen_period_status
      });
    }
  }
  const nodes = [...occurrences.values()].sort((a,b) =>
    a.row.chapter_order - b.row.chapter_order ||
    a.row.paragraph_order - b.row.paragraph_order ||
    (a.row.source_char_start || 0) - (b.row.source_char_start || 0) ||
    a.row.historical_toponym.localeCompare(b.row.historical_toponym, "zh-CN")
  );
  const lineCoordinates = [];
  for (const node of nodes) {
    const point = [node.latitude, node.longitude];
    const previous = lineCoordinates.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) lineCoordinates.push(point);
  }
  if (lineCoordinates.length >= 2) {
    L.polyline(lineCoordinates, {
      color: "#a68452", weight: 2.5, opacity: .76, dashArray: "6 5",
      lineCap: "round", lineJoin: "round", className: "person-track-line", interactive: false
    }).addTo(group);
  }
  const byCoordinate = new Map();
  for (const node of nodes) {
    const key = `${node.longitude.toFixed(5)},${node.latitude.toFixed(5)}`;
    if (!byCoordinate.has(key)) byCoordinate.set(key, []);
    byCoordinate.get(key).push(node);
  }
  const markerByCoordinate = new Map();
  for (const [key, rows] of byCoordinate) {
    const first = rows[0];
    const names = [...new Set(rows.map(row => row.row.historical_toponym))];
    const marker = L.circleMarker([first.latitude, first.longitude], {
      radius: names.length > 1 ? 7 : 6, color: "#fffaf0", weight: 2,
      fillColor: "#b99963", fillOpacity: .95, className: "person-track-node"
    }).addTo(group);
    ui.trackLabels.push({ marker, text: names.slice(0, 3).join(" · ") + (names.length > 3 ? ` +${names.length - 3}` : "") });
    const evidence = rows[0];
    marker.bindPopup(popupNode(
      names.join("、"),
      `${person?.canonical_name || "所选人物"} · ${rows.length} 条同段地名候选 · ${evidence.row.chapter_id} ${evidence.row.paragraph_id}`,
      `历史地名志筛查坐标；MED ${evidence.med == null ? "未知" : `${Number(evidence.med).toFixed(2)} km`}。人物与地点在原文同段共现，尚未人工确认地点指代或实际到访。`,
      () => jumpToParagraph(evidence.row.chapter_id, evidence.row.paragraph_id)
    ));
    markerByCoordinate.set(key, marker);
    marker.on("click", () => {
      ui.trackIndex = nodes.findIndex(node => `${node.longitude.toFixed(5)},${node.latitude.toFixed(5)}` === key);
      updateTrackRecordControls();
    });
  }
  $("track-map-title").textContent = `${person?.canonical_name || "人物"} · 叙事地点顺序`;
  $("track-status").textContent = `${number(nodes.length)} 条同段候选 · ${number(byCoordinate.size)} 个地图点${lineCoordinates.length >= 2 ? ` · ${number(lineCoordinates.length)} 个顺序轨迹节点` : nodes.length === 1 ? " · 单点证据" : " · 无法连线"}`;
  if (container) {
    container.dataset.trackPersonId = personId || "";
    container.dataset.trackNodeCount = String(nodes.length);
    container.dataset.trackLocationCount = String(byCoordinate.size);
    container.dataset.trackMarkerCount = String(byCoordinate.size);
    container.dataset.trackLineCount = lineCoordinates.length >= 2 ? "1" : "0";
  }
  $("track-records").innerHTML = nodes.map((node,index) => {
    const key = `${node.longitude.toFixed(5)},${node.latitude.toFixed(5)}`;
    return `<div class="list-row" role="button" tabindex="0" aria-pressed="false" data-track-index="${index}" data-track-coordinate="${key}" data-chapter="${escapeHTML(node.row.chapter_id)}" data-paragraph="${escapeHTML(node.row.paragraph_id)}"><div class="list-row-title">${escapeHTML(node.row.historical_toponym)}<span class="record-chapter">第 ${node.row.chapter_order} 章</span></div><div class="list-row-meta" title="${escapeHTML(node.row.paragraph_id)}">${escapeHTML(node.person)} · MED ${node.med == null ? "未知" : Number(node.med).toFixed(1)+" km"}</div><div class="list-row-excerpt">${escapeHTML(paragraphText(node.row.paragraph_id).slice(0,160))}</div></div>`;
  }).join("") || `<div class="empty-state">${person ? `${escapeHTML(person.canonical_name)} 当前没有符合历史地名志筛查条件的同段地点坐标。` : "请先选择人物。"} 仍可到原著阅读页检索人物名；这里不会用现代地点坐标冒充历史位置。</div>`;
  $("track-records").querySelectorAll("[data-track-index]").forEach(node => {
    const focusNode = () => {
      focusTrackRecord(Number(node.dataset.trackIndex));
    };
    node.addEventListener("click", focusNode);
    node.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusNode(); } });
  });
  ui.trackMarkers = markerByCoordinate;
  updateTrackRecordControls();
  ui.trackBounds = nodes.length ? L.latLngBounds(nodes.map(node => [node.latitude, node.longitude])) : null;
  if (map && nodes.length) {
    const bounds = L.latLngBounds(nodes.map(node => [node.latitude, node.longitude]));
    setTimeout(() => {
      map.invalidateSize();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 5.6, animate: false });
      refreshTrackLabels();
    }, 80);
  } else if (map) {
    map.setView([35, 105], 3.7, { animate: false });
    setTimeout(() => map.invalidateSize(), 40);
  }
}
function updateTrackRecordControls() {
  const records = [...$("track-records").querySelectorAll("[data-track-index]")];
  records.forEach((row, index) => { row.classList.toggle("active", index === ui.trackIndex); row.setAttribute("aria-pressed", String(index === ui.trackIndex)); });
  $("track-prev-record").disabled = ui.trackIndex <= 0;
  $("track-next-record").disabled = !records.length || ui.trackIndex >= records.length-1;
  $("track-record-position").textContent = records.length ? `${ui.trackIndex < 0 ? "—" : ui.trackIndex+1} / ${records.length} 条地点证据` : "暂无可定位证据";
}
function focusTrackRecord(index) {
  const records = [...$("track-records").querySelectorAll("[data-track-index]")];
  const record = records[index], map = state.maps.tracks;
  if (!record || !map) return;
  const marker = ui.trackMarkers.get(record.dataset.trackCoordinate);
  if (!marker) return;
  ui.trackIndex = index; updateTrackRecordControls();
  map.setView(marker.getLatLng(), Math.min(Math.max(map.getZoom(), 5.6),8), { animate:false });
  marker.openPopup();
  record.scrollIntoView({ block:"nearest", inline:"nearest" });
}
function refreshTrackLabels() {
  const map = state.maps.tracks;
  if (!map || !map.getContainer().clientWidth) return;
  const boxes = mapLabelObstacles(map);
  for (const {marker,text} of ui.trackLabels) {
    marker.unbindTooltip();
    if (!map.getBounds().contains(marker.getLatLng())) continue;
    const placement = findLabelPlacement(map, marker.getLatLng(), text, boxes);
    if (placement) marker.bindTooltip(escapeHTML(text), {permanent:true,...placement,className:"historical-place-label",opacity:.98});
  }
}

function renderAnalysisMap() {
  const group = state.layers.analysis, map = state.maps.analysis;
  if (!group || !map || !state.analysis.kde) return;
  group.clearLayers();
  const values = state.kdeGeo.features.map(feature => feature.properties.density || 0);
  const max = Math.max(...values, 1);
  if ($("analysis-density").checked && state.kdeGeo.features.length) {
    L.geoJSON(state.kdeGeo, { style: feature => {
      const ratio = Math.max(0, Math.min(1, (feature.properties.density || 0) / max));
      const color = ratio > .65 ? "#b86b54" : ratio > .3 ? "#cfb279" : "#8eac8d";
      return { color, weight: .12, opacity: .2, fillColor: color, fillOpacity: .14 + ratio * .56 };
    }}).addTo(group);
  }
  if ($("analysis-buffers").checked) L.geoJSON(state.bufferGeo, { style: feature => ({ color: "#a38a5d", weight: 1.1, fillColor: "#d9bd81", fillOpacity: .10, dashArray: "4 4" }) }).addTo(group);
  if ($("analysis-events").checked) state.eventGeo.features.filter(row => row.properties.event_type_candidate === "war").forEach(feature => {
    const props = feature.properties;
    L.circleMarker([feature.geometry.coordinates[1],feature.geometry.coordinates[0]],{radius:4,color:"#fffaf0",weight:1,fillColor:"#b96f55",fillOpacity:.9})
      .bindPopup(popupNode(`战争候选 · ${props.historical_toponym}`, `第 ${props.chapter_order} 章 · ${props.paragraph_id}`, props.source_excerpt, () => jumpToParagraph(props.chapter_id, props.paragraph_id))).addTo(group);
  });
  $("kde-status").textContent = state.kdeGeo.features.length ? "已计算 · 历史含义待核验" : "暂无可显示的核密度";
  $("kde-status").title = state.analysis.kde.status;
  $("kde-caption").textContent = `输入 ${number(state.analysis.war_candidate_point_features)} 个战争段落—地名共现点 · 高斯带宽 ${state.analysis.kde.bandwidth_km} km · 网格 ${state.analysis.kde.cell_size_km} km · 共 ${number(state.analysis.kde.grid_cell_count || 0)} 格。等积网格用于比较候选密度，不能解释为真实战场范围或行军路线。`;
}
function renderBufferCards() {
  const groups = new Map();
  state.bufferGeo.features.forEach(feature => {
    const p = feature.properties; if (!groups.has(p.battlefield_name)) groups.set(p.battlefield_name, []); groups.get(p.battlefield_name).push(p);
  });
  const status = state.analysis.battlefield_buffers || {};
  const names=[...groups.keys()];
  const known=["赤壁","官渡","夷陵"].filter(name=>!groups.has(name));
  $("buffer-list").innerHTML = [...names,...known].map(name => {
    const rows = groups.get(name) || [];
    if (!rows.length) return `<div class="buffer-card"><h3>${name}</h3><div class="caption">未在历史库唯一筛查结果中匹配；未使用其他项目坐标替代。</div></div>`;
    return `<div class="buffer-card"><h3>${name} <span class="status-tag">MED ${rows[0].origin_med_km == null ? "UNKNOWN" : Number(rows[0].origin_med_km).toFixed(1)+" km"}</span></h3><div class="buffer-radii">${rows.sort((a,b)=>a.buffer_km-b.buffer_km).map(row=>`<span class="radius-pill"><b>${row.buffer_km} km</b> · ${row.event_candidate_count_geodesic} 条候选</span>`).join("")}</div></div>`;
  }).join("");
}
function renderAnalysisAccounting(counts) {
  const items = [
    ["战争段落候选", state.build.extraction.event_candidates_by_type?.war || 0],
    ["具唯一坐标的战争共现", state.analysis.war_candidate_point_features],
    ["已编码表面地名", counts.resolved], ["多候选地名", counts.ambiguous],
    ["未匹配 / 定位失败", counts.failed], ["未运行（限额外）", state.build.geocoding.distinct_toponyms_not_run],
    ["文本事件候选", state.analysis.event_candidate_point_features], ["人物叙事轨迹", state.analysis.character_narrative_track_count]
  ];
  $("analysis-accounting").innerHTML = items.map(([label,value])=>`<div class="accounting-item"><span>${escapeHTML(label)}</span><strong>${number(value)}</strong></div>`).join("");
}

function renderPlaces(filter = state.placeFilter) {
  state.placeFilter = filter;
  const query = ($("place-search")?.value || "").trim().toLowerCase();
  const values = state.places.map(place => ({...place, geo: geocodeByName(place.historical_toponym)})).filter(place => {
    const status = place.geo?.geocode_status || "NOT_RUN_LIMIT";
    if (filter !== "all" && status !== filter) return false;
    if (query && !`${place.historical_toponym} ${status} ${STATUS_LABELS[status] || ""} ${(place.geo?.matched_gazetteer || []).join(" ")}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const pages = Math.max(1, Math.ceil(values.length / ui.pageSize));
  ui.placePage = Math.max(1, Math.min(ui.placePage, pages));
  const start = (ui.placePage-1)*ui.pageSize;
  $("place-result-summary").textContent = `共 ${number(values.length)} 个地名${query ? ` · 关键词“${query}”` : " · 保留地名清单顺序"}`;
  $("place-page-summary").textContent = values.length ? `${start+1}–${Math.min(start+ui.pageSize,values.length)} / ${number(values.length)} 条 · 第 ${ui.placePage} / ${pages} 页` : "暂无匹配记录";
  $("place-page-prev").disabled = ui.placePage <= 1;
  $("place-page-next").disabled = ui.placePage >= pages;
  document.querySelectorAll("[data-place-filter]").forEach(button => {
    button.classList.toggle("active",button.dataset.placeFilter === filter);
    button.setAttribute("aria-pressed",String(button.dataset.placeFilter === filter));
  });
  const head = `<div class="place-row header"><span>原文地名</span><span>出现段落</span><span>匹配状态</span><span>坐标 / 最大误差距离</span><span>地名志候选编号</span></div>`;
  const rows = values.slice(start,start+ui.pageSize).map(place => {
    const geo = place.geo || {};
    const status = geo.geocode_status || "NOT_RUN_LIMIT";
    const cls = status === "OK" ? "ok" : status === "MULTIPLE_MATCHES" ? "multi" : status === "NO_MATCH" ? "fail" : "";
    const coords = geo.longitude == null ? `<span class="cell-placeholder">尚无唯一坐标</span>` : `<span class="coordinate-value">${Number(geo.longitude).toFixed(3)}, ${Number(geo.latitude).toFixed(3)}</span><small>MED ${geo.maximum_error_distance_km == null ? "未知" : Number(geo.maximum_error_distance_km).toFixed(1)+" km"} · ${geo.matched_period === "modern" ? "现代参照" : "历史地名志"}</small>`;
    return `<div class="place-row" role="button" tabindex="0" data-place="${escapeHTML(place.historical_toponym)}"><span class="place-name">${escapeHTML(place.historical_toponym)}</span><span>${number(place.paragraph_count || 0)} 段</span><span class="status-tag ${cls}" title="${escapeHTML(status)}">${escapeHTML(STATUS_LABELS[status] || status)}</span><span class="coordinate-cell">${coords}</span><span class="candidate-cell" title="${escapeHTML((geo.matched_gazetteer || []).join(", "))}">${escapeHTML((geo.matched_gazetteer || []).slice(0,3).join(", ") || "—")}</span></div>`;
  }).join("");
  $("place-table").innerHTML = values.length ? head + rows : `<div class="empty-state table-empty">${icon("search")}<h3>没有找到符合条件的地名</h3><p>可以尝试较短的关键词，或重置匹配状态。</p><button id="place-clear" class="secondary-button">清除搜索与筛选</button></div>`;
  $("place-clear")?.addEventListener("click",()=> { $("place-search").value = ""; ui.placePage=1; renderPlaces("all"); });
  $("place-table").querySelectorAll("[data-place]").forEach(node => {
    const select = () => {
    const row = geocodeByName(node.dataset.place);
    if (row) {
      showPage("overview");
      if (row.geocode_status === "OK" && row.longitude != null) state.maps.overview.setView([row.latitude,row.longitude],6);
      selectPlace(row);
      if (window.matchMedia("(max-width: 1080px)").matches) $("selection-content").scrollIntoView({block:"center"});
    } else toast("该地名超出当前 His-Geo 运行限额，未计算结果");
    };
    node.addEventListener("click", select);
    node.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
  });
}

function drawNetwork() {
  const host = $("network-graph");
  if (!host || !state.events.length) return;
  const personCounts = new Map(), placeCounts = new Map(), events = [];
  for (const row of state.peopleMentions) for (const id of row.character_ids) personCounts.set(id,(personCounts.get(id)||0)+1);
  for (const row of state.placeMentions) placeCounts.set(row.historical_toponym,(placeCounts.get(row.historical_toponym)||0)+1);
  const people = [...personCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18);
  const places = [...placeCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18);
  const eventRows = state.events.map(event => ({event, score:event.candidate_person_ids.length+event.candidate_place_mention_ids.length})).sort((a,b)=>b.score-a.score).slice(0,36);
  const nodes = [];
  const personSet = new Set(people.map(row=>row[0]));
  const placeSet = new Set(places.map(row=>row[0]));
  const eventSet = new Set(eventRows.map(row=>row.event.paragraph_id));
  people.forEach(([id,count],i)=>nodes.push({id:`p:${id}`,type:"person",label:state.people.find(row=>row.character_id===id)?.canonical_name||id,count,x:115,y:49+i*35,raw:id}));
  eventRows.forEach(({event},i)=>nodes.push({id:`e:${event.event_id}`,type:"event",label:`第 ${event.chapter_order} 章 · ${event.trigger_surface||EVENT_LABELS[event.event_type_candidate]||event.event_type_candidate}`,count:1,x:365,y:38+i*18,raw:event}));
  places.forEach(([name,count],i)=>nodes.push({id:`l:${name}`,type:"place",label:name,count,x:635,y:49+i*35,raw:name}));
  const edges = [];
  for (const event of state.events) {
    if (!eventSet.has(event.paragraph_id)) continue;
    const enode = `e:${event.event_id}`;
    const aliasesInPara = state.peopleMentionsByParagraph.get(event.paragraph_id) || [];
    for (const mention of aliasesInPara) for (const id of mention.character_ids) if (personSet.has(id)) edges.push([enode,`p:${id}`]);
    const placesInPara = state.placeMentionsByParagraph.get(event.paragraph_id) || [];
    for (const mention of placesInPara) if (placeSet.has(mention.historical_toponym)) edges.push([enode,`l:${mention.historical_toponym}`]);
  }
  const nodeMap = new Map(nodes.map(node=>[node.id,node]));
  const edgeSvg = edges.map(([a,b])=>{const x=nodeMap.get(a),y=nodeMap.get(b);return x&&y?`<line class="graph-edge" data-source="${escapeHTML(a)}" data-target="${escapeHTML(b)}" x1="${x.x}" y1="${x.y}" x2="${y.x}" y2="${y.y}"/>`:""}).join("");
  const colors={person:"#b18b55",event:"#6a9274",place:"#8199a0"};
  const nodeSvg = nodes.map(node=>`<g class="graph-node" tabindex="0" role="button" aria-label="${escapeHTML(node.label)}，查看原文关联" aria-pressed="false" data-node="${escapeHTML(node.id)}"><title>${escapeHTML(node.label)}</title><circle cx="${node.x}" cy="${node.y}" r="${Math.max(4,Math.min(10,4+Math.sqrt(node.count||1)))}" fill="${colors[node.type]}"/><text x="${node.x+14}" y="${node.y+4}" class="${node.type}">${escapeHTML(node.label.slice(0,18))}</text></g>`).join("");
  host.innerHTML = `<svg viewBox="0 0 780 700" role="group" aria-label="人物事件地点文本共现图"><text x="95" y="19" fill="#75806b" font-size="11">人物</text><text x="345" y="19" fill="#75806b" font-size="11">事件段落候选</text><text x="615" y="19" fill="#75806b" font-size="11">原文地名</text>${edgeSvg}${nodeSvg}</svg>`;
  document.querySelector(".graph-guide").textContent = `高频样本：${people.length} 位人物 · ${eventRows.length} 段事件 · ${places.length} 个地名。选择节点查看相邻关系，非完整知识图谱。`;
  host.querySelectorAll("[data-node]").forEach(node=>bindRecordAction(node,()=>showNetworkDetail(node.dataset.node)));
  highlightGraph(ui.graphSelection);
}
function highlightGraph(id) {
  const host = $("network-graph"), connected = new Set(id ? [id] : []);
  host.classList.toggle("has-selection", Boolean(id));
  host.querySelectorAll(".graph-edge").forEach(edge => {
    const selected = Boolean(id) && (edge.dataset.source === id || edge.dataset.target === id);
    edge.classList.toggle("related", selected);
    if (selected) { connected.add(edge.dataset.source); connected.add(edge.dataset.target); }
  });
  host.querySelectorAll(".graph-node").forEach(node => {
    node.classList.toggle("related", connected.has(node.dataset.node));
    node.classList.toggle("selected", node.dataset.node === id);
    node.setAttribute("aria-pressed", String(node.dataset.node === id));
  });
  $("network-clear").hidden = !id;
}
function showNetworkDetail(id) {
  ui.graphSelection = id; highlightGraph(id);
  const [type, key] = id.split(":",2);
  let title=key, mentions=[];
  if (type === "p") {
    const character=state.people.find(row=>row.character_id===key); title=character?.canonical_name||key;
    mentions=[...new Map(state.peopleMentions.filter(row=>row.character_ids.includes(key)).map(row=>[row.paragraph_id,row])).values()].slice(0,20).map(row=>({chapter_id:row.chapter_id,paragraph_id:row.paragraph_id,text:paragraphText(row.paragraph_id)||row.surface_form}));
  } else if (type === "l") {
    title=key; mentions=[...new Map(state.placeMentions.filter(row=>row.historical_toponym===key).map(row=>[row.paragraph_id,row])).values()].slice(0,20).map(row=>({chapter_id:row.chapter_id,paragraph_id:row.paragraph_id,text:paragraphText(row.paragraph_id)||row.historical_toponym}));
  } else {
    const event=state.events.find(row=>row.event_id===key); if(event){title=`${EVENT_LABELS[event.event_type_candidate] || "事件"} · ${event.trigger_surface}`;mentions=[{chapter_id:event.chapter_id,paragraph_id:event.paragraph_id,text:event.source_excerpt}];}
  }
  const host=$("network-detail"); host.className="compact-list"; host.innerHTML=`<h3>${escapeHTML(title)}</h3><p class="evidence-note">高亮连线仅表示事件段落共现。下方展示最多 20 段原文出处，点击可阅读。</p>${mentions.map(row=>`<div class="list-row" data-chapter="${escapeHTML(row.chapter_id)}" data-paragraph="${escapeHTML(row.paragraph_id)}"><div class="list-row-meta">第 ${findChapter(row.chapter_id)?.source_ordinal || "?"} 章 · ${escapeHTML(row.paragraph_id)}</div><div class="list-row-excerpt">${escapeHTML(row.text.slice(0,180))}</div></div>`).join("")}`;
  host.querySelectorAll("[data-paragraph]").forEach(node=>bindRecordAction(node,()=>jumpToParagraph(node.dataset.chapter,node.dataset.paragraph)));
}

function renderFindings() {
  const e=state.build.extraction,g=state.build.geocoding,analysis=state.analysis;
  const resolved=g.coordinate_status_counts?.OK||0, multi=g.coordinate_status_counts?.MULTIPLE_MATCHES||0, noMatch=g.coordinate_status_counts?.NO_MATCH||0;
  const cards=[
    ["候选战争段落",number(e.event_candidates_by_type?.war||0),"触发词规则，不是人工事件集"],
    ["主路径唯一匹配",number(resolved),`${number(g.coordinate_source_period_counts?.historic||0)} 历史库 / ${number(g.coordinate_source_period_counts?.modern||0)} 现代`],
    ["多候选保留",number(multi),"未强制选址"],
    ["核密度输入点",number(analysis.war_candidate_point_features),"战争段落与地名同段共现"]
  ];
  $("findings-summary").innerHTML=cards.map(row=>`<div class="finding-card"><strong>${row[1]}</strong><span>${row[0]} · ${row[2]}</span></div>`).join("");
  $("supported-questions").innerHTML=[
    `指定 EPUB 转换文本包含 ${state.chapters.length} 个章节，正文与整合版逐章通过对比。`,
    `哪些地名表面形式在何章何段落出现，并对应哪些现代或历史 CHGIS 候选。`,
    `规则战争段落候选中，有多少与唯一历史地名志候选同段共现；其有效年代可能未知。`,
    `主要人物名与地名在小说叙事顺序中的段落共现。`
  ].map(text=>`<li>${escapeHTML(text)}</li>`).join("");
  $("unsupported-questions").innerHTML=[
    "不能据此确认小说事件确曾发生、叙事年份等于史实年代，或角色确实走过连线。",
    "不能将自动地名志匹配当作同名历史地点身份核验；CHGIS 坐标 datum 有来源假设。",
    "不能声称精确道路最短路径、历史政区边界、人物出生地、生卒年或寿命分布。",
    "规则候选未经过人工标注评测，不能把抽取数量当作准确率或完整人物/事件目录。"
  ].map(text=>`<li>${escapeHTML(text)}</li>`).join("");
  const source=$("source-snapshot");
  const entries=[
    ["His-Geo 独立实现版本",g.hisgeo_commit], ["作者官方代码版本",g.hisgeo_official_commit],
    ["CHGIS 地名志 SHA-256",g.historic_tgaz_source_sha256], ["坐标系来源声明",g.historic_crs_statement],
    ["地理编码模式",g.geocoder_mode], ["原始语料来源",state.build.corpus.source_root],
    ["付费推理调用",String(g.paid_api_calls===0?"0 次 · 全程离线":"详见构建清单")], ["原文章节数",`${state.build.corpus.chapter_count} 章`]
  ];
  source.innerHTML=entries.map(([key,value])=>`<div class="source-value"><span>${escapeHTML(key)}<button class="copy-value" data-copy-value="${escapeHTML(value)}" title="复制${escapeHTML(key)}" aria-label="复制${escapeHTML(key)}">${icon("copy")}</button></span><code>${escapeHTML(value)}</code></div>`).join("");
  source.querySelectorAll("[data-copy-value]").forEach(button=>button.addEventListener("click",async()=>{
    try { await navigator.clipboard.writeText(button.dataset.copyValue); toast("已复制来源信息"); }
    catch (_) { toast("当前浏览器无法写入剪贴板，可直接选中该值复制"); }
  }));
}

function selectMapResult(feature) {
  const props=feature.properties;
  const event=state.events.find(row=>row.event_id===props.event_id);
  if(event) selectEvent(event);
}
function bindControls() {
  try { setReaderFont(localStorage.getItem("sanguo-reader-font"), false); } catch (_) { setReaderFont(18, false); }
  $("reader-font-smaller").addEventListener("click",()=>setReaderFont(ui.readerFont-1));
  $("reader-font-larger").addEventListener("click",()=>setReaderFont(ui.readerFont+1));
  $("chapter-search").addEventListener("input",renderChapterList);
  $("clear-text-search").addEventListener("click",clearTextSearch);
  $("text-search").addEventListener("input",()=> { if (!$("text-search").value) clearTextSearch(); });
  for (const [id,delta] of [["reader-prev",-1],["reader-next",1]]) $(id).addEventListener("click",()=> {
    selectChapter(state.selectedChapter+delta); document.querySelector(".reader-toolbar").scrollIntoView({block:"start"});
  });
  $("track-reset").addEventListener("click",()=> {
    if (ui.trackBounds?.isValid()) state.maps.tracks.fitBounds(ui.trackBounds,{padding:[36,36],maxZoom:5.6,animate:false});
    refreshTrackLabels();
  });
  $("track-prev-record").addEventListener("click",()=>focusTrackRecord(ui.trackIndex-1));
  $("track-next-record").addEventListener("click",()=>focusTrackRecord(ui.trackIndex+1));
  $("network-clear").addEventListener("click",()=> {
    ui.graphSelection=null; highlightGraph(null);
    $("network-detail").className="empty-state";
    $("network-detail").innerHTML=`${icon("network")}<h3>从一个节点开始</h3><p>选择人物、事件或地名，查看它们的原文关联。</p>`;
  });
  for (const id of ["analysis-density","analysis-buffers","analysis-events"]) $(id).addEventListener("change",renderAnalysisMap);
  $("overview-reset").addEventListener("click", () => state.maps.overview.setView(MAP_HOME.center, MAP_HOME.zoom));
  $("overview-clear-filters").addEventListener("click",()=> {
    $("event-filter").value="all"; $("person-filter").value="all"; renderChapterEvents(); drawOverviewMap();
  });
  $("chapter-range").addEventListener("input",event=>selectChapter(event.target.value));
  $("chapter-play").addEventListener("click",toggleChapterPlayback);
  $("chapter-speed").addEventListener("change",()=> { if (state.chapterPlaying) { stopChapterPlayback(); toggleChapterPlayback(); } });
  $("chapter-prev").addEventListener("click",()=>selectChapter(state.selectedChapter-1));
  $("chapter-next").addEventListener("click",()=>selectChapter(state.selectedChapter+1));
  $("place-label-toggle").addEventListener("change",drawOverviewMap);
  $("event-filter").addEventListener("change",()=> {renderChapterEvents();drawOverviewMap();});
  $("person-filter").addEventListener("change",()=> {renderChapterEvents();drawOverviewMap();});
  $("search-button").addEventListener("click",searchText);
  $("text-search").addEventListener("keydown",event=>{if(event.key==="Enter")searchText()});
  $("track-person").addEventListener("change",drawTracks);
  $("place-search").addEventListener("input",()=> {ui.placePage=1;renderPlaces();});
  document.querySelectorAll("[data-place-filter]").forEach(button=>button.addEventListener("click",()=>{
    ui.placePage=1; renderPlaces(button.dataset.placeFilter); $("place-table").scrollTop=0;
  }));
  for (const [id,delta] of [["place-page-prev",-1],["place-page-next",1]]) $(id).addEventListener("click",()=> {
    ui.placePage+=delta;renderPlaces(); $("place-table").scrollTop=0;
  });
  window.addEventListener("scroll",()=> {$("back-top").hidden=window.scrollY<500;},{passive:true});
  $("back-top").addEventListener("click",()=>window.scrollTo({top:0,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"}));
}

async function main() {
  $("load-retry").addEventListener("click",()=>location.reload());
  try {
    await loadData();
    setupNavigation();
    setupMaps();
    renderSummary();
    bindControls();
    const initial=location.hash.slice(1);
    showPage(PAGE_LABELS[initial] ? initial : "overview", false);
    drawTracks(); drawNetwork();
    if (state.chapters.length !== 119) throw new Error(`Expected 119 chapters, loaded ${state.chapters.length}`);
    $("app-loading").hidden = true;
  } catch (error) {
    console.error(error);
    $("load-status").textContent = "本地数据读取失败";
    $("load-status").style.color = "#d27761";
    $("app-loading").classList.add("load-error");
    $("app-loading").querySelector("strong").textContent="本地数据暂未载入";
    $("loading-message").textContent="请确认本地服务仍在运行，然后重新加载。";
    $("load-retry").hidden=false;
    toast(`数据加载失败：${error.message}`);
  }
}
document.addEventListener("DOMContentLoaded", main);
