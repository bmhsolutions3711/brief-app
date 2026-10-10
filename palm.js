(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "brief_token";
  const ORIGIN_KEY = "brief_origin";
  const GONE_KEY = "brief_palm_gone";
  const DEFAULT_ORIGIN = "https://bryans-macbook-pro-1.tail1ed408.ts.net:8712";
  const onPages = location.hostname.endsWith("github.io");
  const root = $("palm");
  if (!root) return;

  let origin = localStorage.getItem(ORIGIN_KEY) || (onPages ? DEFAULT_ORIGIN : "");
  let token = localStorage.getItem(TOKEN_KEY) || "";
  const apiUrl = (p) => (origin ? origin : "") + p;

  let gen = 0;
  let playing = "";
  let audio = null;
  let objectUrl = "";
  let ctrl = null;
  let stamp = "";
  let edition = "";
  let gone = new Set();
  let cards = {};
  let fingers = 0;
  let dirty = false;
  const timers = new Set();

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function headers(json) {
    token = localStorage.getItem(TOKEN_KEY) || "";
    origin = localStorage.getItem(ORIGIN_KEY) || (onPages ? DEFAULT_ORIGIN : "");
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  function reduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function toast(msg) {
    const el = $("err");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function loadGone(ed) {
    try {
      const row = JSON.parse(localStorage.getItem(GONE_KEY) || "{}");
      if (row.edition !== ed) return new Set();
      return new Set(Array.isArray(row.ids) ? row.ids : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveGone() {
    localStorage.setItem(GONE_KEY, JSON.stringify({ edition, ids: [...gone] }));
  }

  function sig(rev) {
    return (rev || "") + "|" + [...gone].sort().join(",");
  }

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function halt() {
    gen += 1;
    playing = "";
    if (ctrl) {
      ctrl.abort();
      ctrl = null;
    }
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = "";
      audio = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    root.querySelectorAll('[data-on="1"]').forEach((el) => { el.dataset.on = "0"; });
  }

  function tally(n) {
    if (n === 1) return "1 other line is on the record.";
    return n + " other lines are on the record.";
  }

  function face(card, compact) {
    const live = `<i class="live">One sentence.</i>`;
    if (compact) {
      const fact = card.hero || card.title || "";
      return `<span class="kick">${esc(card.kicker || "")}</span><span class="line"><i>${esc(card.label || "")}</i> ${esc(fact)}</span>${live}`;
    }
    const hero = card.hero ? `<b class="hero">${esc(card.hero)}</b>` : "";
    const unit = card.unit ? `<span class="unit">${esc(card.unit)}</span>` : "";
    const move = card.move ? `<span class="move">${esc(card.move)}</span>` : "";
    const hed = !card.hero && card.title ? `<span class="hed">${esc(card.title)}</span>` : "";
    const when = card.when ? `<span class="when">${esc(card.source || "")} · ${esc(card.when)}</span>` : "";
    return `<span class="kick">${esc(card.kicker || "")}</span><span class="label">${esc(card.label || "")}</span>${hero}${unit}${move}${hed}${when}${live}`;
  }

  function turn(card) {
    if (!card.href) return "";
    return `<a class="turn" href="${esc(card.href)}" target="_blank" rel="noopener">The record</a>`;
  }

  function dismiss(sling) {
    if (!sling.isConnected) return;
    const id = sling.dataset.throw || "";
    if (!id) return;
    gone.add(id);
    saveGone();
    stamp = sig(stamp.split("|")[0]);
    sling.remove();
  }

  function arm(sling) {
    let timer = 0;
    const check = () => {
      const width = sling.clientWidth;
      if (width && sling.scrollLeft > width * 0.45) dismiss(sling);
    };
    sling.addEventListener("scroll", () => {
      clearTimeout(timer);
      timers.delete(timer);
      timer = later(check, 80);
    }, { passive: true });
    sling.addEventListener("scrollend", check);
    sling.addEventListener("pointerdown", () => { fingers += 1; });
    const release = () => {
      fingers = Math.max(0, fingers - 1);
      if (!fingers && dirty && !playing) {
        dirty = false;
        open();
      }
    };
    sling.addEventListener("pointerup", release);
    sling.addEventListener("pointercancel", release);
  }

  function render(data) {
    const thin = (data.thin || []).filter((card) => card && card.id && !gone.has(card.id)).slice(0, 2);
    cards = {};
    if (data.heavy && data.heavy.id) cards[data.heavy.id] = data.heavy;
    thin.forEach((card) => { cards[card.id] = card; });
    const slings = thin.map((card) => `
      <div class="sling" data-throw="${esc(card.id)}">
        <article class="thin" data-id="${esc(card.id)}" data-on="0">
          <button type="button" class="face">${face(card, true)}</button>
          ${turn(card)}
        </article>
        <div class="runway" aria-hidden="true"></div>
      </div>`).join("");
    const heavy = data.heavy && data.heavy.id ? `
      <article class="weight" data-id="${esc(data.heavy.id)}" data-on="0">
        <button type="button" class="face">${face(data.heavy, false)}</button>
        ${turn(data.heavy)}
      </article>` : "";
    const rest = Number(data.rest) || 0;
    const count = rest > 0
      ? `<button type="button" class="tally" aria-expanded="false">${esc(tally(rest))}</button>`
      : "";
    const gaps = (data.gaps || []).map((gap) => `<p><b>${esc(gap.name)}</b><span>${esc(gap.gap)}</span></p>`).join("");
    let note = "";
    if (!data.heavy && !thin.length) note = `<p class="empty">The desk is clear.</p>`;
    else if (!data.heavy) note = `<p class="quiet">The record is thin today.</p>`;
    root.innerHTML = `<div class="desk">${note}${heavy}<div class="thins">${slings}</div>${count}<div class="gaps" hidden>${gaps}</div></div>`;
    root.dataset.drawn = "1";
    root.querySelectorAll(".sling").forEach(arm);
    root.scrollTop = root.scrollHeight;
  }

  async function open() {
    if (playing || fingers) {
      dirty = true;
      return;
    }
    let data;
    try {
      const res = await fetch(apiUrl("/api/palm"), { headers: headers(false) });
      if (!res.ok) throw new Error("the palm did not come up");
      data = await res.json();
    } catch (err) {
      if (err && err.name === "AbortError") return;
      toast((err && err.message) || "the palm did not come up");
      return;
    }
    edition = data.edition || "";
    gone = loadGone(edition);
    const next = sig(data.rev || "");
    if (next === stamp && root.dataset.drawn === "1") return;
    if (playing || fingers) {
      dirty = true;
      return;
    }
    stamp = next;
    render(data);
  }

  async function speak(id) {
    const card = cards[id];
    if (!card || !card.sentence) return;
    if (playing === id) {
      halt();
      return;
    }
    halt();
    const mine = gen;
    playing = id;
    const el = [...root.querySelectorAll("[data-id]")].find((node) => node.dataset.id === id);
    if (el) el.dataset.on = "1";
    const heavy = !!(el && el.classList.contains("weight"));
    if (heavy && !reduced() && navigator.vibrate) {
      try { navigator.vibrate(12); } catch (_) {}
    }
    ctrl = new AbortController();
    try {
      const res = await fetch(apiUrl("/api/speak"), {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ text: card.sentence }),
        signal: ctrl.signal,
      });
      if (mine !== gen) return;
      if (!res.ok) throw new Error("the voice missed");
      const blob = await res.blob();
      if (mine !== gen) return;
      objectUrl = URL.createObjectURL(blob);
      audio = new Audio(objectUrl);
      audio.onended = () => { if (mine === gen) halt(); };
      audio.onerror = () => { if (mine === gen) halt(); };
      await audio.play();
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (mine === gen) {
        halt();
        toast((err && err.message) || "the voice missed");
      }
    }
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest("a.turn")) return;
    const tallyBtn = e.target.closest(".tally");
    if (tallyBtn) {
      const panel = root.querySelector(".gaps");
      if (!panel) return;
      const openPanel = panel.hidden;
      panel.hidden = !openPanel;
      tallyBtn.setAttribute("aria-expanded", openPanel ? "true" : "false");
      return;
    }
    const faceBtn = e.target.closest(".face");
    if (!faceBtn) return;
    const card = faceBtn.closest("[data-id]");
    if (!card) return;
    const sling = faceBtn.closest(".sling");
    if (sling && sling.scrollLeft > 6) return;
    speak(card.dataset.id);
  });

  window.addEventListener("pagehide", halt);
  window.BriefPalm = { open, stop: halt };
})();
