/* Grounded local retrieval and aggregation. This is deliberately not an LLM
 * endpoint: no prompts, corpus, or credentials leave the browser. */
const mapAssistant = {places: new Map(), contextPlace: null, turns: 0};
const uniqueParagraphs = rows => [...new Map(rows.map(row => [row.paragraph_id, row])).values()];

function bindHistoricalPlaceLabel(marker, text, placement, names) {
  marker.bindTooltip(escapeHTML(text), {permanent: true, ...placement, interactive: true, className: "historical-place-label", opacity: .98});
  const element = marker.getTooltip().getElement();
  if (element) L.DomEvent.on(element, "click", event => { L.DomEvent.stop(event); openPlaceProfile(names[0], names); });
}

function setupMapAssistant() {
  for (const place of state.places) mapAssistant.places.set(place.historical_toponym, {place, mentions: []});
  for (const row of state.placeMentions) {
    if (!mapAssistant.places.has(row.historical_toponym)) mapAssistant.places.set(row.historical_toponym, {place: {historical_toponym: row.historical_toponym}, mentions: []});
    mapAssistant.places.get(row.historical_toponym).mentions.push(row);
  }
  $("place-profile-close").addEventListener("click", () => $("place-profile").close());
  $("place-profile").addEventListener("click", event => {
    if (event.target !== $("place-profile")) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  });
  $("assistant-form").addEventListener("submit", event => {
    event.preventDefault(); const question = $("assistant-input").value.trim();
    if (!question) return;
    askMapAssistant(question); $("assistant-input").value = "";
  });
  $("assistant-input").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("assistant-form").requestSubmit(); }
  });
  document.querySelectorAll("[data-ask]").forEach(button => button.addEventListener("click", () => askMapAssistant(button.dataset.ask)));
}
function placeFacts(name) {
  const entry = mapAssistant.places.get(name) || {place: {historical_toponym: name}, mentions: []};
  const paragraphs = uniqueParagraphs(entry.mentions).sort((a, b) => a.chapter_order - b.chapter_order || a.paragraph_order - b.paragraph_order);
  const chapters = new Set(paragraphs.map(row => row.chapter_id));
  const people = new Map(), chapterCounts = new Map();
  for (const row of paragraphs) {
    chapterCounts.set(row.chapter_order, (chapterCounts.get(row.chapter_order) || 0) + 1);
    const ids = new Set((state.peopleMentionsByParagraph.get(row.paragraph_id) || []).flatMap(person => person.character_ids));
    for (const id of ids) people.set(id, (people.get(id) || 0) + 1);
  }
  const associated = [...people].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, count]) => ({person: state.people.find(p => p.character_id === id), count})).filter(row => row.person);
  const peak = [...chapterCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return {...entry, paragraphs, chapters, associated, peak, geo: geocodeByName(name)};
}
function evidenceMarkup(rows, limit = 3) {
  return rows.slice(0, limit).map(row => `<button class="source-evidence" data-source-chapter="${escapeHTML(row.chapter_id)}" data-source-paragraph="${escapeHTML(row.paragraph_id)}"><span>原文序号 ${String(row.chapter_order).padStart(3, "0")} · ${escapeHTML(findChapter(row.chapter_id)?.original_title || row.chapter_id)}</span><p>${escapeHTML(paragraphText(row.paragraph_id).slice(0, 210))}</p><small>${escapeHTML(row.paragraph_id)} · 阅读原文 ↗</small></button>`).join("");
}
function bindEvidenceActions(host) {
  host.querySelectorAll("[data-source-paragraph]").forEach(button => button.addEventListener("click", () => {
    $("place-profile").close(); jumpToParagraph(button.dataset.sourceChapter, button.dataset.sourceParagraph);
  }));
  host.querySelectorAll("[data-profile-name]").forEach(button => button.addEventListener("click", () => openPlaceProfile(button.dataset.profileName)));
}
function placeNarrativeIntro(name, facts) {
  if (!facts.mentions.length) return `当前地名清单中没有“${name}”的原文提及记录，无法据此编写介绍。`;
  const people = facts.associated.slice(0, 3).map(row => `${row.person.canonical_name}（${row.count} 段）`).join("、");
  return `“${name}”在本地文本中出现 ${facts.mentions.length} 次，分布于 ${facts.paragraphs.length} 段、${facts.chapters.size} 个章节文件。${facts.peak ? `以原文序号 ${facts.peak[0]} 最集中，共 ${facts.peak[1]} 段。` : ""}${people ? `同段共现较多的人物有${people}。` : ""}这些是文本线索统计，并不能证明人物实际到访。`;
}
function openPlaceProfile(name, colocated = []) {
  stopTrackPlayback(); stopChapterPlayback();
  const facts = placeFacts(name), geo = facts.geo;
  mapAssistant.contextPlace = name;
  $("place-profile-title").textContent = name;
  const coords = (lon, lat) => lon == null || lat == null ? "无唯一坐标" : `${Number(lon).toFixed(5)}° E / ${Number(lat).toFixed(5)}° N`;
  const matched = new Set([...(geo?.matched_gazetteer || []), ...(geo?.historical_screen_candidates || [])]);
  const candidates = (facts.place.gazetteer_candidates || []).filter(c => matched.has(c.gazetteer_id));
  const historic = geo?.historical_screen_status === "OK";
  $("place-profile-body").innerHTML = `${colocated.length > 1 ? `<div class="profile-colocated"><span>同一候选坐标的不同词面</span>${colocated.map(label => `<button data-profile-name="${escapeHTML(label)}" class="filter-pill">${escapeHTML(label)}</button>`).join("")}</div>` : ""}<p class="profile-intro">${escapeHTML(placeNarrativeIntro(name, facts))}</p><div class="profile-stats"><div><strong>${facts.mentions.length}</strong><span>原文词面提及</span></div><div><strong>${facts.chapters.size}</strong><span>覆盖章节文件</span></div><div><strong>${facts.associated.length}</strong><span>共现种子人物</span></div></div><h3>位置与不确定性</h3><dl class="place-detail-grid"><div><dt>配置主流程 · ${geo?.matched_period === "modern" ? "现代参照" : geo?.matched_period === "historic" ? "历史地名志候选" : "未取得坐标"}</dt><dd>${escapeHTML(coords(geo?.longitude, geo?.latitude))}</dd></div><div><dt>历史库独立筛查 · ${escapeHTML(STATUS_LABELS[geo?.historical_screen_status] || "未运行")}</dt><dd>${escapeHTML(coords(geo?.historical_screen_longitude, geo?.historical_screen_latitude))}</dd></div><div><dt>主流程 MED</dt><dd>${geo?.maximum_error_distance_km == null ? "未知" : Number(geo.maximum_error_distance_km).toFixed(2) + " km"}</dd></div><div><dt>历史筛查 MED</dt><dd>${geo?.historical_screen_med_km == null ? "未知" : Number(geo.historical_screen_med_km).toFixed(2) + " km"}</dd></div></dl><p class="evidence-note">${historic ? "历史库已得唯一筛查结果；年代是否重叠、词面是否指同一地点仍需核验。" : "当前未取得唯一历史库坐标；现代参照不代表三国时期位置。"} 底图行政界为 2024 年方位参照。暂无已核验的历史百科条目，以下介绍仅据本地小说原文生成。</p>${candidates.length ? `<details><summary>查看实际匹配的地名志记录</summary>${candidates.slice(0, 10).map(c => `<p>${escapeHTML(c.name)} · ${escapeHTML(c.gazetteer_id)} · ${escapeHTML(c.level)}<br>记录年代 ${c.valid_from ?? "未知"} 至 ${c.valid_to ?? "未知"}；别名：${escapeHTML((c.aliases || []).join("、") || "无")}</p>`).join("")}</details>` : ""}<div class="profile-actions"><button id="profile-ask" class="primary-button">询问这个地名 ↗</button><button id="profile-show-map" class="secondary-button" ${geo?.longitude == null ? "disabled" : ""}>在总览中定位</button></div><h3>小说中的原文片段 <small>展示 ${Math.min(6, facts.paragraphs.length)} / ${facts.paragraphs.length} 段</small></h3><div>${evidenceMarkup(facts.paragraphs, 6) || '<p class="caption">暂无原文段落。</p>'}</div>`;
  bindEvidenceActions($("place-profile-body"));
  $("profile-ask").addEventListener("click", () => { $("place-profile").close(); showPage("assistant"); askMapAssistant(`${name}有什么故事？`); });
  $("profile-show-map").addEventListener("click", () => {
    if (geo?.longitude == null) return;
    $("place-profile").close(); showPage("overview");
    const lastChapter = Math.max(1, ...facts.paragraphs.map(row => row.chapter_order));
    if (state.selectedChapter < lastChapter) selectChapter(lastChapter);
    state.maps.overview.setView([geo.latitude, geo.longitude], 6, {animate: false}); selectPlace(geo);
  });
  $("place-profile-body").scrollTop = 0;
  if (!$("place-profile").open) $("place-profile").showModal();
}
function placeButtons(names) {
  return names.map(name => `<button class="filter-pill" data-profile-name="${escapeHTML(name)}">${escapeHTML(name)} ↗</button>`).join("");
}
function answerLocation(facts) {
  const g = facts.geo;
  if (!g) return '<p>该词面尚未运行地理编码；仍保留原文提及，不推测坐标。</p>';
  const main = g.longitude == null ? "无唯一坐标" : `${Number(g.longitude).toFixed(5)}, ${Number(g.latitude).toFixed(5)}（${g.matched_period === "modern" ? "现代参照" : "历史地名志候选"}；MED ${g.maximum_error_distance_km == null ? "未知" : Number(g.maximum_error_distance_km).toFixed(2) + " km"}）`;
  const historic = g.historical_screen_status === "OK" && g.historical_screen_longitude != null ? `${Number(g.historical_screen_longitude).toFixed(5)}, ${Number(g.historical_screen_latitude).toFixed(5)}；MED ${g.historical_screen_med_km == null ? "未知" : Number(g.historical_screen_med_km).toFixed(2) + " km"}` : "未取得唯一历史库坐标";
  return `<p>主流程经纬度：${escapeHTML(main)}。历史库独立筛查：${escapeHTML(historic)}。位置身份和年代仍待核验，现代参照不代表三国位置。</p>`;
}
function buildMapAnswer(question) {
  const known = [...mapAssistant.places.keys()].filter(name => question.includes(name)).sort((a, b) => b.length - a.length);
  // Prefer the longest named place; never combine a contained short name as a second place.
  const names = known.filter(name => !known.some(other => other !== name && other.includes(name)));
  const people = state.people.filter(person => [person.canonical_name, ...(person.aliases || [])].some(name => name.length >= 2 && question.includes(name)));
  if (/真实历史|史实|出生|生于|死于|逝世|病逝|为什么|为何/.test(question)) return {html: '<p>当前助手只能核查小说原文与规则提取的数据，不能独立核实历史事实或因果。可以换成“某地名有哪些原文证据”“某人物有哪些同段地点”，再由原文判断。</p>', evidence: []};
  if (people.length >= 2) {
    const selected = people.slice(0, 4);
    const paragraphSets = selected.map(person => new Set(state.peopleMentions.filter(row => row.character_ids.includes(person.character_id)).map(row => row.paragraph_id)));
    const candidates = [...mapAssistant.places.entries()].filter(([name]) => !names.length || names.includes(name)).map(([name, entry]) => {
      const perPerson = paragraphSets.map(ids => uniqueParagraphs(entry.mentions.filter(row => ids.has(row.paragraph_id))));
      return {name, perPerson, min: Math.min(...perPerson.map(rows => rows.length))};
    }).filter(row => row.min > 0).sort((a, b) => b.min - a.min || a.name.localeCompare(b.name, "zh-CN"));
    const rows = candidates.slice(0, 5);
    return {html: `<h3>${escapeHTML(selected.map(p => p.canonical_name).join(" × "))}：共同的叙事地名</h3><p>在当前文本提取结果中，${candidates.length} 个词面地名分别与这 ${selected.length} 位人物有同段共现。这里比较的是各自的地点集合，不能据此认定同地会面。</p>${rows.map(row => `<p>${placeButtons([row.name])} ${row.perPerson.map((items, i) => `${escapeHTML(selected[i].canonical_name)} ${items.length} 段`).join(" · ")}</p>`).join("")}${!rows.length ? '<p>未找到共同地名；不会用推测补全。</p>' : ""}`, evidence: rows[0] ? uniqueParagraphs(rows[0].perPerson.flat()).slice(0, 4) : [], action: {type: "compare", ids: selected.map(p => p.character_id)}};
  }
  if (names.length || (/这个地名|这里|该地/.test(question) && mapAssistant.contextPlace)) {
    const name = names[0] || mapAssistant.contextPlace, facts = placeFacts(name);
    mapAssistant.contextPlace = name;
    const person = people[0];
    if (person) {
      const ids = new Set(state.peopleMentions.filter(row => row.character_ids.includes(person.character_id)).map(row => row.paragraph_id));
      const rows = facts.paragraphs.filter(row => ids.has(row.paragraph_id));
      return {html: `<h3>${escapeHTML(person.canonical_name)}与${escapeHTML(name)}</h3><p>找到 ${rows.length} 段人物和地名的同段共现。共现可能包括转述、议论或书信，不能直接解释为到访。</p>${placeButtons([name])}`, evidence: rows.slice(0, 4)};
    }
    if (names.length > 1) {
      const compared = names.slice(0, 4).map(label => ({name: label, facts: placeFacts(label)}));
      return {html: `<h3>地名叙事数据对照</h3>${compared.map(row => `<p>${placeButtons([row.name])} ${row.facts.mentions.length} 次词面提及 · ${row.facts.paragraphs.length} 段 · ${row.facts.chapters.size} 个章节文件。</p>${answerLocation(row.facts)}`).join("")}<p class="caption">按词面独立统计；同一坐标不证明地名同义，不同词面也未自动合并。</p>`, evidence: uniqueParagraphs(compared.flatMap(row => row.facts.paragraphs.slice(0, 1)))};
    }
    if (/战争|战事|行军|事件|战斗/.test(question)) {
      const ids = new Set(facts.paragraphs.map(row => row.paragraph_id));
      const events = state.events.filter(row => ids.has(row.paragraph_id));
      const counts = new Map();
      for (const event of events) counts.set(event.event_type_candidate, (counts.get(event.event_type_candidate) || 0) + 1);
      const eventParagraphs = new Set(events.map(row => row.paragraph_id));
      return {html: `<h3>${escapeHTML(name)} · 事件文本线索</h3><p>在包含该地名的段落中，规则识别到 ${events.length} 条事件候选，覆盖 ${eventParagraphs.size} 段。${[...counts].map(([type, count]) => `${escapeHTML(EVENT_LABELS[type] || type)} ${count} 条`).join("、")}。这不是经过人工核验的战役清单；同段出现地名不证明事件发生于此。</p>${placeButtons([name])}`, evidence: facts.paragraphs.filter(row => eventParagraphs.has(row.paragraph_id)).slice(0, 3)};
    }
    return {html: `<h3>${escapeHTML(name)} · 小说叙事档案</h3><p>${escapeHTML(placeNarrativeIntro(name, facts))}</p>${answerLocation(facts)}${placeButtons([name])}`, evidence: facts.paragraphs.slice(0, 3)};
  }
  if (people.length === 1) {
    const person = people[0], nodes = collectTrackNodes(person.character_id);
    const named = [...new Set(nodes.map(node => node.row.historical_toponym))];
    const allParagraphs = new Set(state.peopleMentions.filter(row => row.character_ids.includes(person.character_id)).map(row => row.paragraph_id));
    return {html: `<h3>${escapeHTML(person.canonical_name)}的叙事地点</h3><p>人物在 ${allParagraphs.size} 段中被词面识别。通过现有历史库筛查的轨迹包含 ${nodes.length} 条同段地点候选、${named.length} 个地名词面。此处仅按源章节和段落排序，未恢复真实旅行时间。</p><div class="answer-places">${placeButtons(named.slice(0, 12))}</div>`, evidence: uniqueParagraphs(nodes.map(node => node.row)).slice(0, 3), action: {type: "single", ids: [person.character_id]}};
  }
  if (/趣|隐含|发现|线索|有意思|现象|最多|热门|频繁|排行/.test(question)) {
    const ranked = [...mapAssistant.places.entries()].map(([name]) => ({name, facts: placeFacts(name)})).sort((a, b) => b.facts.paragraphs.length - a.facts.paragraphs.length || a.name.localeCompare(b.name, "zh-CN"));
    const top = ranked.slice(0, 5), most = top[0];
    const highWithoutHistoric = ranked.slice(0, 20).filter(row => row.facts.geo?.historical_screen_status !== "OK");
    return {html: `<h3>三个可回查的地图阅读线索</h3><p>① 叙事重心：按不同段落数排序，前五地名为 ${top.map(row => `${escapeHTML(row.name)} ${row.facts.paragraphs.length} 段`).join("、")}。这是词面统计，不能当作地名消歧后的历史城市排名。</p><p>② 聚焦阅读：${most ? `“${escapeHTML(most.name)}”在原文序号 ${most.facts.peak?.[0]} 最集中，${most.facts.peak?.[1]} 段；适合从这一章检查人物、书信与战事叙述如何围绕地点组织。` : "暂无可用记录。"}</p><p>③ 地图之外：高频前 20 个地名中，${highWithoutHistoric.length} 个尚未取得唯一历史库筛查坐标。地图空白也可能是地名歧义或地名志覆盖问题，不能解释为小说没有写到。</p><div class="answer-places">${placeButtons(top.map(row => row.name))}</div><p class="caption">以上是自动统计得到的阅读建议，未经文学研究或历史事实人工核验。</p>`, evidence: most ? most.facts.paragraphs.filter(row => row.chapter_order === most.facts.peak?.[0]).slice(0, 3) : []};
  }
  return {html: '<p>这句话暂未匹配到可计算的查询类型。我支持：已识别地名的出现次数与原文、人物同段地点、多人共同地名、地名频次与地图覆盖线索。请写出具体地名或人物名；未收录或没有证据的内容不会自动补写。</p>', evidence: []};
}
function askMapAssistant(question) {
  question = String(question).trim().slice(0, 500);
  if (!question) return;
  const log = $("assistant-messages"), user = document.createElement("article");
  user.className = "assistant-question"; user.textContent = question; log.append(user);
  const answer = buildMapAnswer(question), article = document.createElement("article");
  article.className = "assistant-answer"; article.dataset.answerTurn = String(++mapAssistant.turns);
  article.innerHTML = `<span class="answer-method">本地检索与统计 · 基于当前载入数据</span>${answer.html}${answer.evidence.length ? `<details open><summary>原文证据 · ${answer.evidence.length} 段</summary>${evidenceMarkup(answer.evidence, 4)}</details>` : '<p class="caption">本条没有可引用的原文段落，未生成历史断言。</p>'}${answer.action ? '<button class="secondary-button" data-answer-track>在地图上动态查看 ↗</button>' : ""}`;
  log.append(article); bindEvidenceActions(article);
  article.querySelector("[data-answer-track]")?.addEventListener("click", () => {
    trackPlayback.mode = answer.action.type;
    if (answer.action.type === "compare") trackPlayback.selected = answer.action.ids;
    else $("track-person").value = answer.action.ids[0];
    showPage("people"); setTrackChapter(1); toggleTrackPlayback();
  });
  article.scrollIntoView({block: "nearest", behavior: "instant"});
}
