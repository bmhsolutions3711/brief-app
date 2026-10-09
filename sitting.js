(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "brief_token";
  const ORIGIN_KEY = "brief_origin";
  const DEFAULT_ORIGIN = "https://bryans-macbook-pro-1.tail1ed408.ts.net:8712";
  const onPages = location.hostname.endsWith("github.io");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = $("sitting");
  const btn = $("sitBtn");
  if (!root || !btn) return;

  let origin = localStorage.getItem(ORIGIN_KEY) || (onPages ? DEFAULT_ORIGIN : "");
  let token = localStorage.getItem(TOKEN_KEY) || "";
  const apiUrl = (p) => (origin ? origin : "") + p;

  let gen = 0;
  let cursor = 0;
  let cues = [];
  let chapters = [];
  let key = "";
  let status = "";
  let note = "";
  let last = null;
  let cps = 13;
  let poll = 0;
  let turnTimer = 0;
  let shown = "";
  const audio = new Audio();
  let ctrl = null;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function headers() {
    const h = { "Content-Type": "application/json" };
    token = localStorage.getItem(TOKEN_KEY) || "";
    origin = localStorage.getItem(ORIGIN_KEY) || (onPages ? DEFAULT_ORIGIN : "");
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  function toast(msg) {
    const el = $("err");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function wordsFrom(cueAt, sentenceAt) {
    let n = 0;
    cues.forEach((cue, i) => {
      const lines = cue.sentences || [];
      lines.forEach((line, s) => {
        if (i > cueAt || (i === cueAt && s >= sentenceAt)) n += line.trim().split(/\s+/).length;
      });
    });
    return n;
  }

  function clock(cueAt, sentenceAt) {
    const chars = cues.reduce((sum, cue, i) => {
      const lines = cue.sentences || [];
      return sum + lines.reduce((inner, line, s) => {
        if (i > cueAt || (i === cueAt && s >= sentenceAt)) return inner + line.length;
        return inner;
      }, 0);
    }, 0);
    const sec = chars / Math.max(cps, 8);
    if (sec < 50) return "Under a minute";
    return Math.max(1, Math.round(sec / 60)) + " min";
  }

  function paintBtn() {
    if (document.body.dataset.sitting === "1") {
      btn.textContent = "Stop";
      return;
    }
    const kicker = last && last.status === "set"
      ? last.minutes + " min"
      : (last ? "Setting" : "The record");
    btn.innerHTML = `<i class="k">${esc(kicker)}</i><b>The sitting</b>`;
  }

  function safeUrl(u) {
    try {
      const x = new URL(u);
      if (x.protocol === "https:" || x.protocol === "http:") return x.href;
    } catch (_) { /* not a url */ }
    return "";
  }

  function spine(on) {
    return chapters.map((ch) =>
      `<button type="button" data-jump="${esc(ch.id)}" data-on="${ch.id === on ? "1" : "0"}">${esc(ch.kicker)}</button>`
    ).join("");
  }

  function render(cue, sentence, cueAt, sentenceAt) {
    if (shown === cue.id && root.querySelector(".ink")) {
      root.querySelector(".ink").textContent = sentence;
      const clockEl = root.querySelector(".sit-clock b");
      if (clockEl) clockEl.textContent = clock(cueAt, sentenceAt);
      const noteEl = root.querySelector(".sit-set");
      if (noteEl) {
        noteEl.hidden = !note;
        noteEl.textContent = note || "";
      }
      return;
    }
    const turn = shown && shown !== cue.id && !reduced;
    shown = cue.id;
    const href = safeUrl(cue.href);
    const image = safeUrl(cue.image);
    const hero = cue.kind === "print" && cue.hero
      ? `<p class="hero"><i>${esc(cue.label || cue.kicker)}</i><b>${esc(cue.hero)}</b>${cue.unit ? `<span>${esc(cue.unit)}</span>` : ""}</p>`
      : "";
    const plate = image
      ? `<figure class="plate"><div class="frame"><img src="${esc(image)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('figure').remove()"></div></figure>`
      : "";
    const link = href ? ` · <a href="${esc(href)}" target="_blank" rel="noopener">The record</a>` : "";
    root.innerHTML = `
      <div class="sit-head">
        <div class="sit-clock"><span class="kicker">The sitting</span><b>${esc(clock(cueAt, sentenceAt))}</b></div>
        <p class="sit-set" ${note ? "" : "hidden"}>${esc(note)}</p>
        <div class="spine">${spine(cue.chapter)}</div>
      </div>
      <article class="page">
        <span class="kicker">${esc(cue.kicker || "")}</span>
        ${plate}
        ${hero}
        <p class="ink" aria-live="polite">${esc(sentence)}</p>
        <p class="by">${esc(cue.source || "The record")}${link}</p>
      </article>`;
    if (turn) {
      root.classList.remove("turn");
      void root.offsetWidth;
      root.classList.add("turn");
      clearTimeout(turnTimer);
      turnTimer = setTimeout(() => root.classList.remove("turn"), 700);
    }
    const live = root.querySelector(".ink");
    if (live) live.scrollIntoView({ block: "nearest" });
  }

  function cut() {
    gen += 1;
    if (ctrl) ctrl.abort();
    audio.pause();
    audio.removeAttribute("src");
    try { audio.load(); } catch (_) { /* already clear */ }
  }

  function halt(fromApp) {
    cut();
    clearInterval(poll);
    poll = 0;
    clearTimeout(turnTimer);
    root.classList.remove("turn");
    document.body.dataset.sitting = "";
    root.hidden = true;
    shown = "";
    paintBtn();
    if (!fromApp && window.BriefStop) window.BriefStop();
  }

  async function fetchSitting() {
    const res = await fetch(apiUrl("/api/sitting"), { headers: headers() });
    if (res.status === 401) {
      toast("Paste the token, then sit down.");
      return null;
    }
    if (!res.ok) throw new Error("the sitting did not come up");
    return res.json();
  }

  function adopt(data, keepCurrent) {
    if (!data) return;
    last = data;
    key = data.key || key;
    status = data.status || "";
    note = data.note || "";
    chapters = data.chapters || chapters;
    const next = data.cues || [];
    if (!keepCurrent || !cues.length) {
      cues = next;
      return;
    }
    const head = cues.slice(0, cursor + 1);
    const tail = next.slice(cursor + 1);
    cues = head.concat(tail);
  }

  async function refresh() {
    if (document.body.dataset.sitting !== "1") return;
    try {
      const data = await fetchSitting();
      if (!data || data.key !== key) return;
      adopt(data, true);
      if (data.status === "set" && poll) {
        clearInterval(poll);
        poll = 0;
      }
    } catch (_) { /* the page in the air stays */ }
  }

  function speak(text, my) {
    return new Promise((resolve) => {
      if (my !== gen) { resolve(); return; }
      ctrl = new AbortController();
      fetch(apiUrl("/api/speak"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      }).then(async (res) => {
        if (my !== gen) { resolve(); return; }
        if (!res.ok) throw new Error("voice failed");
        const blob = await res.blob();
        if (my !== gen) { resolve(); return; }
        const url = URL.createObjectURL(blob);
        audio.onended = () => {
          if (audio.duration && text.length) cps = cps * 0.65 + (text.length / audio.duration) * 0.35;
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.src = url;
        audio.play().then(() => {
          if (my !== gen) { audio.pause(); URL.revokeObjectURL(url); resolve(); }
        }).catch(() => { URL.revokeObjectURL(url); resolve(); });
      }).catch((err) => {
        if (err && err.name === "AbortError") { resolve(); return; }
        if (my === gen) toast("The voice missed a sentence. The sitting goes on.");
        resolve();
      });
    });
  }

  async function run(from) {
    const my = ++gen;
    cursor = Math.max(0, from || 0);
    while (cursor < cues.length) {
      if (my !== gen) return;
      const cue = cues[cursor];
      const lines = (cue && cue.sentences) || [];
      for (let s = 0; s < lines.length; s++) {
        if (my !== gen) return;
        render(cues[cursor], lines[s], cursor, s);
        await speak(lines[s], my);
      }
      cursor += 1;
    }
    if (my !== gen) return;
    document.body.dataset.sitting = "";
    root.hidden = true;
    shown = "";
    clearInterval(poll);
    poll = 0;
    paintBtn();
    if (window.BriefStop) window.BriefStop();
  }

  async function start(at) {
    if (window.BriefStop) window.BriefStop();
    document.body.dataset.sitting = "1";
    root.hidden = false;
    const sheet = $("sheet");
    const thread = $("thread");
    if (sheet) sheet.hidden = true;
    if (thread) thread.hidden = true;
    const why = $("why");
    if (why) why.textContent = "The sitting";
    btn.textContent = "Stop";
    toast("");
    root.innerHTML = `<div class="sit-head"><div class="sit-clock"><span class="kicker">The sitting</span><b>…</b></div><p class="sit-set">Opening the record.</p></div>`;
    try {
      const data = await fetchSitting();
      if (document.body.dataset.sitting !== "1") return;
      if (!data || !(data.cues || []).length) throw new Error("nothing is set");
      adopt(data, false);
      paintBtn();
      btn.textContent = "Stop";
      if (data.status !== "set") {
        clearInterval(poll);
        poll = setInterval(refresh, 3000);
      }
      let index = 0;
      if (at) index = cues.findIndex((cue) => cue.chapter === at);
      if (index < 0) index = 0;
      run(index);
    } catch (err) {
      toast(err.message || "the sitting did not come up");
      halt(true);
      if (window.BriefStop) window.BriefStop();
    }
  }

  async function warm() {
    try {
      const data = await fetchSitting();
      if (!data) return;
      adopt(data, false);
      if (document.body.dataset.sitting !== "1") paintBtn();
    } catch (_) { /* the button still sits */ }
  }

  btn.addEventListener("click", () => {
    if (document.body.dataset.sitting === "1") {
      if (window.BriefStop) window.BriefStop();
      else halt(true);
      return;
    }
    start("");
  });

  root.addEventListener("click", (e) => {
    const jump = e.target.closest("[data-jump]");
    if (!jump || document.body.dataset.sitting !== "1") return;
    const index = cues.findIndex((cue) => cue.chapter === jump.dataset.jump);
    if (index < 0) return;
    cut();
    run(index);
  });

  window.BriefSitting = { halt, start };
  window.addEventListener("pagehide", () => halt(true));
  setTimeout(warm, 600);
})();
