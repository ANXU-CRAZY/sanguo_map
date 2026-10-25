/* Narrative playback only: coordinates and screening rules are shared with the
 * original independent single-person view. No geographic interpolation. */
const trackPlayback = {
  mode: "single", selected: [], chapter: 119, playing: false, timer: null,
  series: [], cache: new Map(), colors: new Map(), generation: 0,
  palette: ["#5ac4c1", "#d4a255", "#b69ae3", "#e08491"]
};
const trackCoordinateKey = node => `${node.longitude.toFixed(5)},${node.latitude.toFixed(5)}`;
const trackMarkerKey = node => `${node.personId}|${trackCoordinateKey(node)}`;

function setupTrackControls() {
  trackPlayback.selected = ["刘备", "曹操", "孙权"].map(name => state.people.find(p => p.canonical_name === name)?.character_id).filter(Boolean);
  $("track-compare-options").innerHTML = state.people.map(p => `<label><input type="checkbox" value="${escapeHTML(p.character_id)}" ${trackPlayback.selected.includes(p.character_id) ? "checked" : ""}><span>${escapeHTML(p.canonical_name)}</span></label>`).join("");
  $("track-compare-options").addEventListener("change", event => {
    const input = event.target;
    if (!input.matches("input")) return;
    if (input.checked && trackPlayback.selected.length >= 4) { input.checked = false; return; }
    trackPlayback.selected = input.checked ? [...trackPlayback.selected, input.value] : trackPlayback.selected.filter(id => id !== input.value);
    drawTracks();
  });
  document.querySelectorAll("button[data-track-mode]").forEach(button => button.addEventListener("click", () => {
    trackPlayback.mode = button.dataset.trackMode; drawTracks();
  }));
  $("track-play").addEventListener("click", toggleTrackPlayback);
  $("track-range").addEventListener("input", event => setTrackChapter(Number(event.target.value)));
  $("track-step-back").addEventListener("click", () => setTrackChapter(trackPlayback.chapter - 1));
  $("track-step-next").addEventListener("click", () => setTrackChapter(trackPlayback.chapter + 1));
  $("track-restart").addEventListener("click", () => setTrackChapter(1));
  $("track-speed").addEventListener("change", () => {
    if (trackPlayback.playing) { stopTrackPlayback(); toggleTrackPlayback(); }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopTrackPlayback(); });
  for (const id of ["track-legend", "track-records"]) $(id).addEventListener("focusin", stopTrackPlayback);
  window.addEventListener("pagehide", stopTrackPlayback);
}

function stopTrackPlayback() {
  clearInterval(trackPlayback.timer);
  trackPlayback.timer = null; trackPlayback.playing = false;
  const button = $("track-play");
  if (button) { button.textContent = "▶ 播放轨迹"; button.setAttribute("aria-pressed", "false"); }
  if ($("track-play-state")) $("track-play-state").textContent = trackPlayback.chapter === state.chapters.length ? "完整视图" : "已暂停";
}
function toggleTrackPlayback() {
  if (trackPlayback.playing) { stopTrackPlayback(); return; }
  if (!trackPlayback.series.some(series => series.nodes.length) || state.page !== "people") return;
  if (trackPlayback.chapter >= state.chapters.length) setTrackChapter(1);
  trackPlayback.playing = true;
  $("track-play").textContent = "Ⅱ 暂停播放"; $("track-play").setAttribute("aria-pressed", "true");
  $("track-play-state").textContent = "正在展开";
  trackPlayback.timer = setInterval(() => {
    setTrackChapter(trackPlayback.chapter + 1, false);
    if (trackPlayback.chapter >= state.chapters.length) stopTrackPlayback();
  }, Number($("track-speed").value));
}
function setTrackChapter(chapter, manual = true) {
  if (manual) stopTrackPlayback();
  trackPlayback.chapter = Math.max(1, Math.min(state.chapters.length, Number(chapter) || 1));
  renderTrackFrame();
  if (!trackPlayback.playing) stopTrackPlayback();
}
function resetTrackPlayback() {
  if (!state.layers.tracks) return;
  stopTrackPlayback();
  const compare = trackPlayback.mode === "compare";
  $("track-compare").hidden = !compare;
  $("track-person").disabled = compare;
  document.querySelectorAll("button[data-track-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.trackMode === trackPlayback.mode)));
  document.querySelectorAll("#track-compare-options input").forEach(input => {
    input.checked = trackPlayback.selected.includes(input.value);
    input.disabled = !input.checked && trackPlayback.selected.length >= 4;
  });
  $("track-compare-hint").textContent = `已选 ${trackPlayback.selected.length} / 4 人 · 每人独立连线，使用同一原文章节进度。`;
  const ids = compare ? trackPlayback.selected : [$("track-person").value].filter(Boolean);
  const used = new Set(ids.map(id => trackPlayback.colors.get(id)).filter(Boolean));
  for (const id of ids) if (!trackPlayback.colors.has(id) || ids.some(other => other !== id && trackPlayback.colors.get(other) === trackPlayback.colors.get(id))) {
    const color = trackPlayback.palette.find(value => !used.has(value)) || trackPlayback.palette[0];
    trackPlayback.colors.set(id, color); used.add(color);
  }
  trackPlayback.series = ids.map(id => {
    if (!trackPlayback.cache.has(id)) trackPlayback.cache.set(id, collectTrackNodes(id));
    return { id, person: state.people.find(p => p.character_id === id), color: trackPlayback.colors.get(id), nodes: trackPlayback.cache.get(id) };
  });
  document.querySelectorAll("#track-compare-options input").forEach(input => {
    input.closest("label").style.setProperty("--track-color", trackPlayback.colors.get(input.value) || "var(--accent)");
  });
  trackPlayback.chapter = state.chapters.length;
  const all = trackPlayback.series.flatMap(series => series.nodes);
  ui.trackBounds = all.length ? L.latLngBounds(all.map(node => [node.latitude, node.longitude])) : null;
  const names = trackPlayback.series.map(s => s.person?.canonical_name || s.id);
  $("track-monogram").textContent = compare ? "比" : (names[0]?.slice(0, 1) || "人");
  $("track-map-title").textContent = `${names.join(" × ") || "请选择人物"} · ${compare ? "同章对比" : "叙事地点顺序"}`;
  renderTrackFrame();
  const generation = ++trackPlayback.generation;
  setTimeout(() => {
    if (generation !== trackPlayback.generation) return;
    const map = state.maps.tracks;
    map.invalidateSize();
    if (ui.trackBounds?.isValid()) map.fitBounds(ui.trackBounds, { padding: [36, 36], maxZoom: 5.6, animate: false });
    else map.setView([35, 105], 3.7, { animate: false });
    refreshTrackLabels();
  }, 80);
}

function renderTrackFrame() {
  const group = state.layers.tracks, map = state.maps.tracks;
  if (!group || !map) return;
  group.clearLayers(); ui.trackLabels = []; ui.trackMarkers = new Map(); ui.trackIndex = -1;
  const chapter = trackPlayback.chapter;
  let lineCount = 0, locationCount = 0;
  const visible = [], latestPoints = [], legend = [];
  trackPlayback.series.forEach((series, seriesIndex) => {
    const nodes = series.nodes.filter(node => node.row.chapter_order <= chapter);
    visible.push(...nodes);
    const lineCoordinates = [];
    const byCoordinate = new Map();
    for (const node of nodes) {
      const point = [node.latitude, node.longitude], previous = lineCoordinates.at(-1);
      if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) lineCoordinates.push(point);
      const key = trackCoordinateKey(node);
      if (!byCoordinate.has(key)) byCoordinate.set(key, []);
      byCoordinate.get(key).push(node);
    }
    if (lineCoordinates.length >= 2) {
      L.polyline(lineCoordinates, {color: series.color, weight: 3, opacity: .8, dashArray: ["8 5", "2 6", "12 4 2 4", "5 4"][seriesIndex], className: "person-track-line", interactive: false}).addTo(group);
      lineCount++;
    }
    locationCount += byCoordinate.size;
    for (const rows of byCoordinate.values()) {
      const first = rows[0], names = [...new Set(rows.map(node => node.row.historical_toponym))];
      const marker = L.circleMarker([first.latitude, first.longitude], {radius: 5 + seriesIndex, color: series.color, weight: 2, fillColor: series.color, fillOpacity: .58, className: "person-track-node"}).addTo(group);
      marker._placeNames = names;
      ui.trackLabels.push({marker, text: names.slice(0, 3).join(" · ")});
      ui.trackMarkers.set(trackMarkerKey(first), marker);
      marker.bindPopup(popupNode(`${first.person} · ${names.join("、")}`, `原文序号 ${first.row.chapter_order} · ${rows.length} 条同段证据`, paragraphText(first.row.paragraph_id).slice(0, 160), () => jumpToParagraph(first.row.chapter_id, first.row.paragraph_id)));
      marker.on("click", () => {
        stopTrackPlayback();
        const index = trackPlayback.visibleNodes.findIndex(node => trackMarkerKey(node) === trackMarkerKey(first));
        ui.trackIndex = index; updateTrackRecordControls();
        openPlaceProfile(first.row.historical_toponym, names);
      });
    }
    const last = nodes.at(-1), fresh = nodes.filter(node => node.row.chapter_order === chapter).length;
    if (last) {
      latestPoints.push([last.latitude, last.longitude]);
      L.circleMarker([last.latitude, last.longitude], {radius: 12 + seriesIndex * 4, color: series.color, weight: 2, fill: false, interactive: false, className: `track-head${fresh ? " is-current" : ""}`}).addTo(group);
    }
    legend.push(`<article class="track-person-card" style="--track-color:${series.color}" data-track-series="${escapeHTML(series.id)}" data-visible-nodes="${nodes.length}"><strong><i></i>${escapeHTML(series.person?.canonical_name || series.id)}<span>${nodes.length} / ${series.nodes.length} 条</span></strong><p>${last ? `最近证据：${escapeHTML(last.row.historical_toponym)} · 原文序号 ${last.row.chapter_order}` : "此章及以前暂无符合筛查条件的地点证据"}</p><small>${fresh ? `本章新增 ${fresh} 条候选` : "本章无新增地点证据"}</small>${last ? `<button class="text-button" data-track-source="${escapeHTML(series.id)}">查看最近原文 ↗</button>` : ""}</article>`);
  });
  visible.sort((a, b) => a.row.chapter_order - b.row.chapter_order || a.row.paragraph_order - b.row.paragraph_order || (a.row.source_char_start || 0) - (b.row.source_char_start || 0) || a.row.historical_toponym.localeCompare(b.row.historical_toponym, "zh-CN") || a.personId.localeCompare(b.personId));
  trackPlayback.visibleNodes = visible;
  $("track-legend").innerHTML = legend.join("") || '<p class="caption">选择人物后显示独立轨迹与证据。</p>';
  $("track-legend").querySelectorAll("[data-track-source]").forEach(button => button.addEventListener("click", () => {
    const last = trackPlayback.series.find(s => s.id === button.dataset.trackSource)?.nodes.filter(node => node.row.chapter_order <= chapter).at(-1);
    if (last) jumpToParagraph(last.row.chapter_id, last.row.paragraph_id);
  }));
  const allCount = trackPlayback.series.reduce((sum, series) => sum + series.nodes.length, 0);
  $("track-status").textContent = `${visible.length} / ${allCount} 条同段候选 · ${locationCount} 个人物地点点位 · ${lineCount} 条独立轨迹`;
  Object.assign(map.getContainer().dataset, {trackMode: trackPlayback.mode, trackPersonId: trackPlayback.mode === "single" ? ($("track-person").value || "") : "", trackNodeCount: String(visible.length), trackLocationCount: String(locationCount), trackMarkerCount: String(locationCount), trackLineCount: String(lineCount), trackChapter: String(chapter)});
  $("track-chapter-label").textContent = `原文序号 ${String(chapter).padStart(3, "0")} / ${state.chapters.length}`;
  $("track-chapter-title").textContent = state.chapters.find(c => c.source_ordinal === chapter)?.original_title || "";
  $("track-range").max = String(state.chapters.length); $("track-range").value = String(chapter);
  $("track-range").style.setProperty("--progress", `${(chapter - 1) / (state.chapters.length - 1) * 100}%`);
  $("track-step-back").disabled = chapter <= 1;
  $("track-step-next").disabled = chapter >= state.chapters.length;
  $("track-play").disabled = !allCount;
  $("track-records").innerHTML = visible.map((node, index) => `<div class="list-row" role="button" tabindex="0" aria-pressed="false" data-track-index="${index}" data-track-coordinate="${trackMarkerKey(node)}" data-chapter="${escapeHTML(node.row.chapter_id)}" data-paragraph="${escapeHTML(node.row.paragraph_id)}"><div class="list-row-title">${escapeHTML(node.row.historical_toponym)}<span class="record-chapter">第 ${node.row.chapter_order} 章</span></div><div class="list-row-meta">${escapeHTML(node.person)} · MED ${node.med == null ? "未知" : Number(node.med).toFixed(1) + " km"}</div><div class="list-row-excerpt">${escapeHTML(paragraphText(node.row.paragraph_id).slice(0, 160))}</div></div>`).join("") || '<div class="empty-state">当前进度暂无符合历史筛查条件的同段地点证据。可继续播放、拖动进度或更换人物。</div>';
  $("track-records").querySelectorAll("[data-track-index]").forEach(row => bindRecordAction(row, () => focusTrackRecord(Number(row.dataset.trackIndex))));
  updateTrackRecordControls(); refreshTrackLabels();
  if ($("track-follow").checked && latestPoints.length && state.page === "people") map.fitBounds(L.latLngBounds(latestPoints), {padding: [45, 45], maxZoom: 6, animate: false});
}
function updateTrackRecordControls() {
  const records = [...$("track-records").querySelectorAll("[data-track-index]")];
  records.forEach((row, index) => { row.classList.toggle("active", index === ui.trackIndex); row.setAttribute("aria-pressed", String(index === ui.trackIndex)); });
  $("track-prev-record").disabled = ui.trackIndex <= 0;
  $("track-next-record").disabled = !records.length || ui.trackIndex >= records.length - 1;
  $("track-record-position").textContent = records.length ? `${ui.trackIndex < 0 ? "—" : ui.trackIndex + 1} / ${records.length} 条地点证据` : "暂无可定位证据";
}
function focusTrackRecord(index) {
  const record = $("track-records").querySelectorAll("[data-track-index]")[index];
  const marker = record && ui.trackMarkers.get(record.dataset.trackCoordinate);
  if (!marker) return;
  stopTrackPlayback(); ui.trackIndex = index; updateTrackRecordControls();
  state.maps.tracks.setView(marker.getLatLng(), Math.min(Math.max(state.maps.tracks.getZoom(), 5.6), 8), {animate: false});
  marker.openPopup(); record.scrollIntoView({block: "nearest", inline: "nearest"});
}
