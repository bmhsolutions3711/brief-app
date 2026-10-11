(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "brief_token";
  const ORIGIN_KEY = "brief_origin";
  const DEFAULT_ORIGIN = "https://bryans-macbook-pro-1.tail1ed408.ts.net:8712";
  const onPages = location.hostname.endsWith("github.io");

  (function ingestCfg() {
    const query = new URLSearchParams(location.search).get("cfg");
    const hash = location.hash.startsWith("#cfg=") ? location.hash.slice(5) : "";
    const raw = query || (hash ? decodeURIComponent(hash) : "");
    if (!raw) return;
    try {
      const cfg = JSON.parse(raw);
      if (cfg.api) localStorage.setItem(ORIGIN_KEY, String(cfg.api).replace(/\/$/, ""));
      if (cfg.token) localStorage.setItem(TOKEN_KEY, String(cfg.token));
    } catch (_) { /* bad cfg */ }
    history.replaceState(null, "", location.pathname);
  })();

  let origin = localStorage.getItem(ORIGIN_KEY) || (onPages ? DEFAULT_ORIGIN : "");
  let token = localStorage.getItem(TOKEN_KEY) || "";
  const apiUrl = (p) => (origin ? origin : "") + (p.startsWith("/") ? p : "/" + p);

  let record = null;
  let beat = (location.hash || "").replace(/^#/, "") || "palm";
  let foldId = "";
  let letterOpen = false;
  let coverAt = 0;
  let coverEdition = "";
  let stackOpen = false;
  const GLANCE_KEY = "brief_glance";
  const HOLD_KEY = "brief_hold";

  function loadGlance() {
    try { return new Set(JSON.parse(sessionStorage.getItem(GLANCE_KEY) || "[]")); }
    catch (_) { return new Set(); }
  }
  function loadHold() {
    try {
      const rows = JSON.parse(localStorage.getItem(HOLD_KEY) || "[]");
      return Array.isArray(rows) ? rows.slice(-3) : [];
    } catch (_) { return []; }
  }
  let glanced = loadGlance();
  let holding = loadHold();
  let onPress = false;
  let lineOn = -1;
  let poll = null;
  let seq = 0;
  let mode = "";

  function headers(json) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  function setState(s) {
    document.body.dataset.state = s;
    if (document.body.dataset.sitting === "1") {
      $("why").textContent = "The sitting";
      $("pip").dataset.on = "1";
      const sit = $("sitBtn");
      if (sit) sit.textContent = "Stop";
      return;
    }
    const map = {
      boot: ["waking", "0"],
      pulling: ["pulling", "1"],
      ready: ["record", "1"],
      reading: ["writing", "1"],
      playing: ["playing", "1"],
      dark: ["pro dark", "dark"],
      connect: ["paste the token", "dark"],
    };
    const row = map[s] || map.ready;
    $("why").textContent = row[0];
    $("pip").dataset.on = row[1];
    const btn = $("playBtn");
    if (btn) btn.textContent = mode ? "Stop" : "Play brief";
  }

  function showErr(msg) {
    const el = $("err");
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function showConnect(msg) {
    $("connect").hidden = false;
    $("connectErr").hidden = !msg;
    $("connectErr").textContent = msg || "";
    setState("connect");
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function safeUrl(u) {
    try {
      const x = new URL(u);
      if (x.protocol === "https:" || x.protocol === "http:") return x.href;
    } catch (_) {}
    return "";
  }

  function showNum(v) {
    const pct = String(v).endsWith("%");
    const n = pct ? String(v).slice(0, -1) : String(v);
    if (!/^-?\d+(\.\d+)?$/.test(n)) return esc(v);
    const [a, b] = n.split(".");
    const grouped = a.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return esc((b ? grouped + "." + b : grouped) + (pct ? "%" : ""));
  }

  function track(raw, bare) {
    let series = raw;
    if (typeof series === "string") {
      try { series = JSON.parse(series); } catch (_) { series = []; }
    }
    const nums = (Array.isArray(series) ? series : []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length < 2) return "";
    const first = nums[0];
    const last = nums[nums.length - 1];
    const pct = ((last - first) / first) * 100;
    const tone = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || Math.abs(last) || 1;
    const w = 100;
    const h = 24;
    const pad = 1.6;
    const d = nums.map((n, i) => {
      const x = (i / (nums.length - 1)) * w;
      const y = pad + (1 - (n - min) / span) * (h - pad * 2);
      return (i ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }).join(" ");
    const label = (pct > 0 ? "+" : "") + pct.toFixed(1) + "% · 30d";
    const svg = `<svg class="spark" data-tone="${tone}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
    if (bare) return svg;
    return `${svg}<span class="delta" data-tone="${tone}">${label}</span>`;
  }

  function splitClaim(raw) {
    const quote = raw.match(/^(["“'‘])(.+?)(["”'’])\s*:\s+(.+)$/);
    if (quote && quote[2].trim().length >= 12 && quote[4].trim().length >= 8) {
      return { hit: quote[1] + quote[2] + quote[3], deck: quote[4].trim() };
    }
    const seps = [" — ", " – ", " - ", ": "];
    for (const sep of seps) {
      const at = raw.indexOf(sep);
      if (at < 0) continue;
      const left = raw.slice(0, at).trim();
      const right = raw.slice(at + sep.length).trim();
      if (left.length < 3 || right.length < 12) continue;
      const words = left.split(/\s+/).length;
      const label = sep === ": "
        ? words <= 5 && left.length <= 36
        : words <= 2 && left.length <= 18;
      if (label && !/[.!?]$/.test(left)) return { quiet: left, hit: right };
      if (left.length >= 12) return { hit: left, deck: right };
    }
    const re = /[.!?](?=\s+\S)/g;
    let found;
    while ((found = re.exec(raw))) {
      const end = found.index;
      if (end < 22 || end > 120) continue;
      const left = raw.slice(0, end + 1).trim();
      const right = raw.slice(end + 1).trim();
      if (right.length < 16) continue;
      if (/\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|Inc|Ltd|Co|No|Fig|vs|Gen|Sen|Rep)\.$/.test(left)) continue;
      if (/(?:^|[\s.])[A-Z]\.$/.test(left)) continue;
      return { hit: left, deck: right };
    }
    return null;
  }

  function mark(title) {
    const raw = String(title || "").trim();
    const cut = raw ? splitClaim(raw) : null;
    if (!cut) return `<span class="hit">${esc(raw)}</span>`;
    const lead = cut.quiet ? `<span class="quiet">${esc(cut.quiet)}</span>` : "";
    const tail = cut.deck ? `<span class="deck">${esc(cut.deck)}</span>` : "";
    return `${lead}<span class="hit">${esc(cut.hit)}</span>${tail}`;
  }

  function sentenceFor(it, bits) {
    const stop = new Set("the a an of to and or for in on with that this from by as at is are was be it its your you need what who how after before new one may not into their than then over out about just more most some any our his her they them have has had will can could via per off but nor yet here why when where while also among this that with from".split(" "));
    const keys = [...new Set((String(it.title || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((w) => !stop.has(w)))];
    const score = (text) => {
      const hay = text.toLowerCase();
      let n = 0;
      for (const w of keys) if (hay.includes(w)) n += 1;
      return n;
    };
    let best = "";
    let bestN = 1;
    for (const s of bits) {
      const n = score(s);
      if (n > bestN) { bestN = n; best = s; }
    }
    if (!best) return "";
    const parts = best.split(/,\s+and\s+|;\s+/).map((s) => s.trim()).filter(Boolean);
    let pick = best;
    if (parts.length > 1) {
      for (const part of parts) {
        if (score(part) >= bestN) pick = part;
      }
    }
    pick = pick.replace(/^(Additionally|Also|Meanwhile|Separately),\s+/i, "");
    if (/^[a-z]/.test(pick)) pick = pick[0].toUpperCase() + pick.slice(1);
    if (!/[.!?]$/.test(pick)) pick += ".";
    return pick;
  }

  function sentences(text) {
    const parts = String(text || "").split(/(?<=[.!?])\s+/);
    const out = [];
    for (const raw of parts) {
      const s = raw.trim();
      if (s.length < 2) continue;
      const prev = out[out.length - 1] || "";
      const abbrev = /(?:^|[\s.])[A-Z]\.$/.test(prev) || /\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|Inc|Ltd|Gen|Sen|Rep)\.$/.test(prev);
      if (out.length && (/^[a-z0-9]/.test(s) || abbrev)) out[out.length - 1] += " " + s;
      else out.push(s);
    }
    return out;
  }

  function stopAll() {
    seq += 1;
    mode = "";
    lineOn = -1;
    delete document.body.dataset.hear;
    if (window.BriefSitting) window.BriefSitting.halt(true);
    if (window.BriefPalm) window.BriefPalm.stop();
    setState(record && record.pulling ? "pulling" : "ready");
    paint();
  }

  async function api(path, opt) {
    const res = await fetch(apiUrl(path), {
      ...opt,
      headers: { ...headers(opt && opt.body), ...(opt && opt.headers) },
    });
    if (res.status === 401) {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      showConnect("paste the token");
      throw new Error("unauthorized");
    }
    return res;
  }

  function foldLetter(rest, open, label, indexFrom) {
    if (!rest.length) return "";
    const on = open ? "1" : "0";
    const start = indexFrom || 0;
    const lines = rest.map((s, i) => `<p class="line" data-on="${lineOn === start + i ? "1" : "0"}">${esc(s)}</p>`).join("");
    return `<div class="fold" data-open="${on}"><button type="button" class="crease" data-fold="letter" data-open="${on}" aria-expanded="${open ? "true" : "false"}"><span class="kicker">Letter</span><span class="mark"><span class="hit">${esc(label || "The rest of the letter")}</span></span><i class="pipette" aria-hidden="true"></i></button><div class="well" data-open="${on}"${open ? "" : " inert"}><div>${lines}</div></div></div>`;
  }

  function stackOf(ed) {
    const rows = [];
    const push = (it) => {
      if (!it || !it.title) return;
      if (it.id && rows.some((row) => row.id === it.id)) return;
      rows.push(it);
    };
    push(ed.lead);
    for (const it of [...(ed.stories || []), ...(ed.also || [])]) push(it);
    return rows;
  }

  function dial(stack) {
    if (stack.length < 2) return "";
    const prev = stack[(coverAt - 1 + stack.length) % stack.length];
    const next = stack[(coverAt + 1) % stack.length];
    const name = (it) => {
      const cut = splitClaim(String(it.title || ""));
      const hit = (cut && cut.hit) || String(it.title || "Sheet");
      const words = hit.split(/\s+/).filter((w) => !/^(the|a|an)$/i.test(w));
      return (words.length ? words : hit.split(/\s+/)).slice(0, 3).join(" ");
    };
    return `<nav class="dial" aria-label="Stories on this sheet"><button type="button" class="turn" data-turn="-1"><i aria-hidden="true">‹</i> ${esc(name(prev))}</button><span class="count"><b>${coverAt + 1}</b><i> / ${stack.length}</i></span><button type="button" class="turn" data-turn="1">${esc(name(next))} <i aria-hidden="true">›</i></button></nav>`;
  }

  function foldRow(it, bits) {
    const id = it.id || "";
    const open = foldId === id;
    const on = open ? "1" : "0";
    const link = safeUrl(it.url);
    const said = sentenceFor(it, bits);
    const img = safeUrl(it.image);
    const plate = img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
    const rec = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">The record</a>` : "";
    return `<div class="fold" data-open="${on}"><button type="button" class="crease" data-fold="${esc(id)}" data-open="${on}" aria-expanded="${open ? "true" : "false"}"><span class="kicker">${esc(it.kicker || it.section || "")}</span><span class="mark">${mark(it.title)}</span><i class="pipette" aria-hidden="true"></i></button><div class="well" data-open="${on}"${open ? "" : " inert"}><div>${plate}<p class="by">${esc(it.source || "")}${it.kind ? " · " + esc(it.kind) : ""}${it.published ? " · " + esc(it.published) : ""}</p>${said ? `<p class="said">${esc(said)}</p>` : ""}<p class="doors">${rec}<button type="button" class="hear">Hear this</button></p></div></div></div>`;
  }

  function shortTitle(title) {
    const cut = splitClaim(String(title || ""));
    const hit = (cut && cut.hit) || String(title || "");
    const words = hit.split(/\s+/).filter((w) => !/^(the|a|an)$/i.test(w));
    return (words.length ? words : hit.split(/\s+/)).slice(0, 4).join(" ");
  }

  function saveGlance() {
    sessionStorage.setItem(GLANCE_KEY, JSON.stringify([...glanced]));
  }

  function itemKicker(it) {
    if (!it) return "";
    if (it.kicker) return it.kicker;
    if (it.section) return it.section;
    const sheet = stackOf((record && record.edition) || {}).find((row) => row.id === it.id);
    if (sheet && (sheet.kicker || sheet.section)) return sheet.kicker || sheet.section;
    const beat = ((record && record.beats) || []).find((b) => b.id === it.beat);
    return (beat && beat.kicker) || "";
  }

  function pinItem(it) {
    if (!it || !it.id) return;
    if (holding.some((h) => h.id === it.id)) return;
    const sheet = stackOf((record && record.edition) || {}).find((row) => row.id === it.id);
    const row = {
      id: it.id,
      title: it.title || (sheet && sheet.title) || "",
      kicker: itemKicker(it),
      image: safeUrl(it.image) || safeUrl(sheet && sheet.image) || "",
      url: safeUrl(it.url) || safeUrl(sheet && sheet.url) || "",
    };
    holding = holding.filter((h) => h.id !== row.id);
    holding.push(row);
    holding = holding.slice(-3);
    localStorage.setItem(HOLD_KEY, JSON.stringify(holding));
    paint();
  }

  function findItem(id) {
    const items = (record && record.items) || [];
    const hit = items.find((it) => it.id === id);
    if (hit) return hit;
    return stackOf((record && record.edition) || {}).find((it) => it.id === id) || null;
  }

  function holdingHtml() {
    const rows = holding.map((h) => {
      const img = h.image ? `<img src="${esc(h.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : `<i class="hold-blank" aria-hidden="true"></i>`;
      const href = safeUrl(h.url);
      const title = shortTitle(h.title);
      const body = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(title)}</a>`
        : esc(title);
      return `<li>${img}<div><span class="kicker">${esc(h.kicker || "Sheet")}</span><b>${body}</b></div></li>`;
    }).join("");
    return `<p class="holding-h"><span class="kicker">Holding</span><b>${holding.length}/3</b></p>${rows ? `<ul>${rows}</ul>` : ""}`;
  }

  function glanceRow(stack) {
    const picks = stack.slice(1).filter((it) => safeUrl(it.image)).slice(0, 3);
    if (!picks.length) return "";
    const buttons = picks.map((it) => {
      const on = glanced.has(it.id) ? "1" : "0";
      const img = `<img src="${esc(safeUrl(it.image))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
      return `<button type="button" class="look" data-glance="${esc(it.id)}" data-on="${on}"><span class="kicker">${esc(it.kicker || it.section || "")}</span>${img}</button>`;
    }).join("");
    const done = picks.every((it) => glanced.has(it.id));
    const hint = done ? "Done. The rest is optional." : "Glance the three.";
    return `<div class="looks">${buttons}</div><p class="hint" data-done="${done ? "1" : "0"}">${hint}</p>`;
  }

  function doorGrid() {
    const beats = (record && record.beats) || [];
    if (!beats.length) return "";
    const doors = beats.map((b) => {
      const figs = ((record && record.figures) || []).filter((f) => f.beat === b.id);
      let face = "";
      if (figs.length) {
        face = track(figs[0].series, true) || `<i class="door-blank" aria-hidden="true"></i>`;
      } else {
        const pictured = ((record && record.items) || []).find((it) => it.beat === b.id && safeUrl(it.image));
        face = pictured
          ? `<img src="${esc(safeUrl(pictured.image))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
          : `<i class="door-blank" aria-hidden="true"></i>`;
      }
      return `<button type="button" class="door" data-door="${esc(b.id)}">${face}<b>${esc(b.name)}</b></button>`;
    }).join("");
    return `<div class="doorgrid">${doors}</div>`;
  }

  function paintSheet(ed, pressing) {
    const stack = stackOf(ed);
    const eid = String(ed.id || "");
    if (eid !== coverEdition) {
      coverEdition = eid;
      coverAt = 0;
      stackOpen = false;
    }
    if (coverAt >= stack.length) coverAt = 0;
    const story = stack[coverAt] || null;
    const onLead = coverAt === 0;
    const href = story ? safeUrl(story.url) : "";
    const title = story
      ? (href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${mark(story.title)}</a>` : mark(story.title))
      : "Nothing on the record yet.";
    const plate = story && safeUrl(story.image)
      ? `<figure class="plate"><div class="frame"><img src="${esc(safeUrl(story.image))}" alt="" referrerpolicy="no-referrer" onerror="this.closest('figure').dataset.dead='1'"></div><figcaption>${esc(story.source || "")}</figcaption></figure>`
      : "";
    const by = story ? `<span class="by">${esc(story.source || "")}${story.published ? " · " + esc(story.published) : ""}</span>` : "";
    const prints = (ed.prints || []).map((f) =>
      `<div class="print"><span class="k">${esc(f.label)}</span><b>${showNum(f.value)}</b>${track(f.series)}</div>`
    ).join("");
    const bits = sentences(ed.prose || "");
    const shown = letterOpen || lineOn > 0;
    const said = story ? sentenceFor(story, bits) : "";
    let letterBody = "";
    if (!bits.length) {
      letterBody = `<p>${pressing ? "The letter is being set. The sections stay open while the press runs." : "The letter is not set."}</p>`;
    } else if (onLead) {
      letterBody = `<p class="line said" data-on="${lineOn === 0 ? "1" : "0"}">${esc(bits[0])}</p>${foldLetter(bits.slice(1), shown, "The rest of the letter", 1)}`;
    } else {
      letterBody = `${said ? `<p class="said">${esc(said)}</p>` : ""}${foldLetter(bits, shown, "The letter", 0)}`;
    }
    const rec = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">The record</a>` : "";
    const hold = story && story.id
      ? `<button type="button" class="hold" data-hold="${esc(story.id)}">${holding.some((h) => h.id === story.id) ? "Held" : "Hold"}</button>`
      : "";
    const banner = pressing
      ? `<p class="press">${esc(ed.label_now || ed.label || "This edition")} is on the press.<i></i></p>`
      : (!ed.current && ed.prose ? `<p class="press hold">Holding the last sheet until this edition is set.</p>` : "");
    const section = (story && (story.kicker || story.section)) || "The record";
    $("sheet").innerHTML = `
      ${banner}
      <div class="folio"><p class="dateline">${esc(ed.when_now || ed.when || "")}</p></div>
      ${glanceRow(stack)}
      <article class="cover">
        ${plate}
        <div class="hed"><span class="kicker">${esc(section)}</span><h1>${title}</h1>${by}</div>
        <div class="letter">${letterBody}</div>
        <p class="doors">${rec}<button type="button" class="hear">Hear this</button>${hold}</p>
        ${dial(stack)}
      </article>
      ${prints ? `<div class="prints">${prints}</div>` : ""}
      ${doorGrid()}
      <aside class="holding">${holdingHtml()}</aside>
    `;
  }

  function paint() {
    if (!record) return;
    const beats = record.beats || [];
    const edition = record.edition || {};
    document.body.dataset.part = edition.part_now || edition.part || "afternoon";
    document.body.dataset.sheet = beat === "sheet" ? "1" : "0";
    document.body.dataset.open = beat === "palm" ? "palm" : "record";
    const swatch = getComputedStyle(document.body).getPropertyValue("--paper").trim();
    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme && swatch) theme.setAttribute("content", swatch);
    $("beats").innerHTML =
      `<button type="button" class="act" data-beat="sheet" data-on="${beat === "sheet" ? "1" : "0"}"><i class="k">The sheet</i><b>Front</b></button>` +
      beats.map((b) =>
        `<button type="button" class="act" data-beat="${esc(b.id)}" data-on="${b.id === beat ? "1" : "0"}"><i class="k">${esc(b.kicker)}</i><b>${esc(b.name)}</b></button>`
      ).join("");
    if (document.body.dataset.sitting === "1") {
      $("sheet").hidden = true;
      $("thread").hidden = true;
      const sit = $("sitting");
      if (sit) sit.hidden = false;
      $("why").textContent = "The sitting";
      const sitBtn = $("sitBtn");
      if (sitBtn) sitBtn.textContent = "Stop";
      $("playBtn").textContent = "Listen";
      return;
    }
    const palm = $("palm");
    if (beat === "palm") {
      $("sheet").hidden = true;
      $("thread").hidden = true;
      const sit = $("sitting");
      if (sit) sit.hidden = true;
      if (palm) palm.hidden = false;
      const pressing = onPress || !!record.pulling;
      $("why").textContent = pressing ? "On the press" : "The palm";
      if (window.BriefPalm) window.BriefPalm.open();
      return;
    }
    if (palm) palm.hidden = true;
    const pressing = onPress || !!record.pulling;
    const partName = String(edition.label_now || edition.label || "Edition").replace(/ edition$/i, "");
    $("why").textContent = pressing ? "On the press" : partName;
    if (beat === "sheet") {
      $("sheet").hidden = false;
      $("thread").hidden = true;
      const sit = $("sitting");
      if (sit) sit.hidden = true;
      paintSheet(edition, pressing);
      const canHear = !!(edition.prose);
      $("playBtn").textContent = mode ? "Stop" : (canHear ? "Listen" : "Setting");
      $("playBtn").disabled = mode !== "edition" && !canHear;
      return;
    }
    $("sheet").hidden = true;
    $("thread").hidden = false;
    const sitIdle = $("sitting");
    if (sitIdle) sitIdle.hidden = true;
    $("playBtn").disabled = false;
    const meta = beats.find((b) => b.id === beat) || beats[0];
    if (!meta) return;
    beat = meta.id;
    $("logName").textContent = meta.name;
    $("gap").textContent = meta.gap || "";
    const figs = (record.figures || []).filter((f) => f.beat === beat);
    const isPrint = figs.length > 0;
    const figEl = $("figures");
    figEl.hidden = figs.length === 0;
    figEl.dataset.stop = isPrint ? "1" : "0";
    figEl.innerHTML = figs.map((f) =>
      `<div class="figure"><span class="k">${esc(f.label)}</span><b>${showNum(f.value)}</b>${track(f.series)}<span class="as">${esc(f.as_of)} · ${esc(f.source_name)}</span></div>`
    ).join("");
    const plate = $("storyPlate");
    const items = (record.items || []).filter((it) => it.beat === beat);
    const pictured = !isPrint && items.find((it) => safeUrl(it.image));
    if (pictured) {
      plate.hidden = false;
      plate.innerHTML = `<figure class="plate"><div class="frame"><img src="${esc(safeUrl(pictured.image))}" alt="" referrerpolicy="no-referrer" onerror="this.closest('figure').dataset.dead='1'"></div></figure>`;
    } else {
      plate.hidden = true;
      plate.innerHTML = "";
    }
    const body = (record.readings || {})[beat] || "";
    $("reading").hidden = !body;
    $("readingBody").textContent = body;
    const shown = items.slice(0, 3);
    $("ribbon").innerHTML = shown.map((it) => {
      const href = safeUrl(it.url);
      const when = it.published || "date unknown";
      const on = mode === it.id ? "1" : "0";
      const link = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(it.source)}</a>` : esc(it.source);
      const held = holding.some((h) => h.id === it.id);
      return `<li><button type="button" class="spin" data-id="${esc(it.id)}" data-on="${on}">${on === "1" ? "Stop" : "Play"}</button><div class="body"><span class="who">${esc(it.source)} · ${esc(it.kind)} · ${esc(when)}</span><span class="mark">${mark(it.title)}</span><div>${link}</div></div><button type="button" class="hold" data-hold="${esc(it.id)}">${held ? "Held" : "Hold"}</button></li>`;
    }).join("") || `<li><div class="body"><span class="who">Record</span>Nothing pulled on this beat yet.</div></li>`;
    const end = $("endline");
    end.hidden = beat !== "crypto";
    end.textContent = beat === "crypto" ? "End of Crypto. Nothing is loading below this line." : "";
    $("holding").innerHTML = holdingHtml();
    const bad = (record.sources || []).filter((s) => s.beat === beat && !s.ok && s.pulled_at);
    $("miss").textContent = bad.length ? bad.map((s) => `${s.name} did not answer`).join(" · ") : "";
    $("playBtn").textContent = mode === "brief" ? "Stop" : "Play brief";
  }

  async function load() {
    try {
      const res = await api("/api/record");
      if (!res.ok) throw new Error("record failed");
      record = await res.json();
      $("connect").hidden = true;
      showErr("");
      if (!mode) setState(record.pulling ? "pulling" : "ready");
      paint();
      if ((record.pulling || onPress) && !poll) poll = setInterval(load, 2000);
      if (!record.pulling && !onPress && poll) { clearInterval(poll); poll = null; }
    } catch (e) {
      if (e.message === "unauthorized") return;
      setState("dark");
      showErr(e.message || "dark");
    }
  }

  async function speakOne(text, gen) {
    const res = await api("/api/speak", { method: "POST", body: JSON.stringify({ text }) });
    if (gen !== seq) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "voice failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise((resolve) => {
      if (gen !== seq) { URL.revokeObjectURL(url); resolve(); return; }
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); resolve(); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      a.play().catch(() => resolve());
    });
  }

  async function speakAll(chunks, gen) {
    for (const chunk of chunks) {
      if (gen !== seq) return;
      const bits = sentences(chunk);
      for (const bit of (bits.length ? bits : [chunk])) {
        if (gen !== seq) return;
        await speakOne(bit, gen);
      }
    }
  }

  async function ensureReading(gen) {
    const have = record && record.readings && record.readings[beat];
    if (have) return have;
    setState("reading");
    const res = await api("/api/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beat }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "could not write the brief");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    while (true) {
      if (gen !== seq) return "";
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (_) { continue; }
        if (ev.t === "token") text += ev.c;
        else if (ev.t === "error") throw new Error(ev.error || "read failed");
      }
    }
    if (record) {
      record.readings = record.readings || {};
      record.readings[beat] = text;
    }
    return text;
  }

  async function playEdition() {
    if (mode) { stopAll(); return; }
    const prose = record && record.edition && record.edition.prose;
    if (!prose) return;
    stopAll();
    mode = "edition";
    lineOn = -1;
    letterOpen = true;
    document.body.dataset.hear = "1";
    const gen = seq;
    setState("playing");
    paint();
    try {
      const bits = sentences(prose);
      const lines = bits.length ? bits : [prose];
      for (let i = 0; i < lines.length; i++) {
        if (gen !== seq) return;
        lineOn = i;
        const nodes = document.querySelectorAll(".letter p.line");
        nodes.forEach((p, n) => { p.dataset.on = n === i ? "1" : "0"; });
        if (nodes[i]) nodes[i].scrollIntoView({ block: "nearest" });
        await speakOne(lines[i], gen);
      }
    } catch (e) {
      if (gen === seq) showErr(e.message || "could not read the edition");
    } finally {
      if (gen === seq) { lineOn = -1; stopAll(); }
    }
  }

  async function playBrief() {
    if (mode === "brief") { stopAll(); return; }
    stopAll();
    mode = "brief";
    const gen = seq;
    setState("playing");
    paint();
    try {
      const figs = (record && record.figures || []).filter((f) => f.beat === beat);
      const numbers = figs.map((f) => `${f.label} is ${String(f.value).replace("%", " percent")}, as of ${f.as_of}.`).join(" ");
      const text = await ensureReading(gen);
      if (gen !== seq) return;
      setState("playing");
      await speakAll([numbers, text].filter(Boolean), gen);
    } catch (e) {
      if (gen === seq) showErr(e.message || "could not play");
    } finally {
      if (gen === seq) stopAll();
    }
  }

  async function playItem(id) {
    if (mode === id) { stopAll(); return; }
    stopAll();
    mode = id;
    const gen = seq;
    setState("playing");
    paint();
    try {
      const res = await api("/api/article", { method: "POST", body: JSON.stringify({ id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "could not open that page");
      if (gen !== seq) return;
      const tail = data.cut ? "Stopped after the first stretch." : "";
      await speakAll([data.title, data.text, tail].filter(Boolean), gen);
    } catch (e) {
      if (gen === seq) showErr(e.message || "could not play that page");
    } finally {
      if (gen === seq) stopAll();
    }
  }

  function setFold(id, open) {
    if (id === "letter") letterOpen = open;
    else foldId = open ? id : "";
    const btn = document.querySelector(`.crease[data-fold="${CSS.escape(id)}"]`);
    const fold = btn && btn.closest(".fold");
    if (!fold) return;
    const on = open ? "1" : "0";
    fold.dataset.open = on;
    btn.dataset.open = on;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const well = fold.querySelector(".well");
    if (well) {
      well.dataset.open = on;
      well.inert = !open;
    }
    if (open && id !== "letter") fold.scrollIntoView({ block: "nearest" });
  }

  async function hearFold(fold) {
    const said = fold.querySelector(".said");
    const hit = fold.querySelector(".hit");
    const text = [hit && hit.textContent, said && said.textContent].filter(Boolean).join(". ");
    if (!text) return;
    stopAll();
    mode = "fold";
    document.body.dataset.hear = "1";
    const gen = seq;
    setState("playing");
    paint();
    try {
      await speakAll([text], gen);
    } catch (e) {
      if (gen === seq) showErr(e.message || "could not play");
    } finally {
      if (gen === seq) stopAll();
    }
  }

  function turnCover(delta) {
    const stack = stackOf((record && record.edition) || {});
    if (stack.length < 2) return;
    coverAt = (coverAt + delta + stack.length) % stack.length;
    stackOpen = false;
    paint();
    const sheet = $("sheet");
    if (sheet) sheet.scrollTop = 0;
  }

  function openBeat(id) {
    if (window.BriefSitting) window.BriefSitting.halt(true);
    if (id !== "palm" && window.BriefPalm) window.BriefPalm.stop();
    beat = id;
    if (!beatsOk(beat)) beat = "palm";
    const bare = beat === "palm" || beat === "sheet";
    history.replaceState(null, "", bare ? location.pathname + location.search : "#" + beat);
    lineOn = -1;
    paint();
    const scroller = beat === "palm" ? $("palm") : (beat === "sheet" ? $("sheet") : $("thread"));
    if (scroller) scroller.scrollTop = 0;
  }

  function markGlance(id) {
    if (!id || glanced.has(id)) return;
    glanced.add(id);
    saveGlance();
    paint();
  }

  let swipeX = null;
  $("sheet").addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".cover")) { swipeX = null; return; }
    swipeX = e.clientX;
  });
  $("sheet").addEventListener("pointerup", (e) => {
    if (swipeX == null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) < 56) return;
    if (e.target.closest("a, button")) return;
    turnCover(dx < 0 ? 1 : -1);
  });

  $("sheet").addEventListener("click", (e) => {
    const glance = e.target.closest("[data-glance]");
    if (glance) { markGlance(glance.dataset.glance); return; }
    const door = e.target.closest("[data-door]");
    if (door) { openBeat(door.dataset.door); return; }
    const held = e.target.closest("[data-hold]");
    if (held) { pinItem(findItem(held.dataset.hold)); return; }
    const turn = e.target.closest("[data-turn]");
    if (turn) { turnCover(Number(turn.dataset.turn)); return; }
    const stackBtn = e.target.closest("[data-stack]");
    if (stackBtn) { stackOpen = !stackOpen; paint(); return; }
    const hear = e.target.closest(".hear");
    if (hear) {
      const host = hear.closest(".cover") || hear.closest(".fold");
      if (host) hearFold(host);
      return;
    }
    const btn = e.target.closest(".crease");
    if (!btn) return;
    const id = btn.dataset.fold;
    if (id && id !== "letter") {
      const stack = stackOf((record && record.edition) || {});
      const at = stack.findIndex((it) => it.id === id);
      if (at >= 0) {
        coverAt = at;
        stackOpen = false;
        paint();
        const sheet = $("sheet");
        if (sheet) sheet.scrollTop = 0;
      }
      return;
    }
    const opening = btn.dataset.open !== "1";
    if (opening && id !== "letter") {
      document.querySelectorAll(".crease[data-fold]").forEach((other) => {
        if (other.dataset.fold !== "letter" && other.dataset.fold !== id && other.dataset.open === "1") {
          setFold(other.dataset.fold, false);
        }
      });
    }
    setFold(id, opening);
  });

  $("beats").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-beat]");
    if (!btn) return;
    openBeat(btn.dataset.beat);
  });

  $("thread").addEventListener("click", (e) => {
    const held = e.target.closest("[data-hold]");
    if (held) pinItem(findItem(held.dataset.hold));
  });

  $("ribbon").addEventListener("click", (e) => {
    if (e.target.closest("[data-hold]")) return;
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    playItem(btn.dataset.id);
  });

  function beatsOk(id) {
    if (id === "palm" || id === "sheet") return true;
    return !!((record && record.beats) || []).some((b) => b.id === id);
  }

  async function press() {
    if (onPress) return;
    onPress = true;
    stopAll();
    setState("pulling");
    showErr("");
    paint();
    try {
      const res = await api("/api/pull", { method: "POST", body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "pull failed");
      if (data.pulling) {
        while (onPress) {
          await new Promise((r) => setTimeout(r, 1500));
          await load();
          if (record && !record.pulling) break;
        }
      }
    } catch (e) {
      if (e.message !== "unauthorized") showErr(e.message || "pull failed");
    } finally {
      onPress = false;
      await load();
    }
  }

  $("pullBtn").addEventListener("click", () => { press(); });
  const homeBtn = $("homeBtn");
  if (homeBtn) homeBtn.addEventListener("click", () => openBeat("palm"));
  const sheetBtn = $("sheetBtn");
  if (sheetBtn) sheetBtn.addEventListener("click", () => openBeat("sheet"));

  $("playBtn").addEventListener("click", () => {
    if (beat === "sheet") playEdition();
    else playBrief();
  });

  $("connectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const offered = $("tokenIn").value.trim();
    if (!offered) return;
    try {
      const res = await fetch(apiUrl("/api/connect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: offered }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "bad token");
      token = offered;
      localStorage.setItem(TOKEN_KEY, offered);
      $("connect").hidden = true;
      await load();
    } catch (err) {
      showConnect(err.message || "bad token");
    }
  });

  window.BriefStop = stopAll;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "VERSION") {
        const ver = $("ver");
        if (ver) ver.textContent = String(e.data.version || "").replace("brief-shell-", "") || "v?";
      }
    });
    function askVersion() {
      navigator.serviceWorker.ready
        .then((r) => r.active && r.active.postMessage({ type: "VERSION" }))
        .catch(() => {});
    }
    askVersion();
    setTimeout(askVersion, 2500);
    navigator.serviceWorker.addEventListener("controllerchange", () => setTimeout(askVersion, 300));
    const ver = $("ver");
    if (ver) {
      ver.addEventListener("click", () => {
        if (ver.dataset.pulling === "1") {
          location.reload();
          return;
        }
        ver.dataset.pulling = "1";
        ver.className = "ver checking";
        ver.textContent = "pulling";
        const go = () => location.reload();
        navigator.serviceWorker.addEventListener("controllerchange", go, { once: true });
        setTimeout(go, 1200);
        navigator.serviceWorker.getRegistration().then((r) => {
          if (!r) return;
          const skip = () => { if (r.waiting) r.waiting.postMessage({ type: "SKIP_WAITING" }); };
          r.update().then(skip).catch(() => {});
          skip();
        }).catch(() => {});
      });
    }
  }

  setState("boot");
  (async function boot() {
    try {
      const res = await fetch(apiUrl("/api/health"), { headers: headers(false) });
      const h = await res.json();
      if (!h.ok) throw new Error("dark");
      if (onPages && !h.authed && !token) { showConnect(""); return; }
      await load();
      press();
    } catch (_) {
      if (token || !onPages) {
        try { await load(); press(); return; } catch (__) {}
      }
      setState("dark");
    }
  })();
})();
