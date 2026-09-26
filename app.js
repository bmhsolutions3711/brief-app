(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "brief_token";
  const ORIGIN_KEY = "brief_origin";
  const DEFAULT_ORIGIN = "https://bryans-macbook-pro-1.tail1ed408.ts.net:8712";
  const onPages = location.hostname.endsWith("github.io");

  (function ingestHash() {
    const raw = location.hash.slice(1);
    if (!raw.startsWith("cfg=")) return;
    try {
      const cfg = JSON.parse(decodeURIComponent(raw.slice(4)));
      if (cfg.api) localStorage.setItem(ORIGIN_KEY, String(cfg.api).replace(/\/$/, ""));
      if (cfg.token) localStorage.setItem(TOKEN_KEY, String(cfg.token));
    } catch (_) { /* bad cfg */ }
    history.replaceState(null, "", location.pathname + location.search);
  })();

  let origin = localStorage.getItem(ORIGIN_KEY) || (onPages ? DEFAULT_ORIGIN : "");
  let token = localStorage.getItem(TOKEN_KEY) || "";
  const apiUrl = (p) => (origin ? origin : "") + (p.startsWith("/") ? p : "/" + p);

  let record = null;
  let beat = "ai";
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

  function sentences(text) {
    return String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
  }

  function stopAll() {
    seq += 1;
    mode = "";
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

  function paint() {
    if (!record) return;
    const beats = record.beats || [];
    $("beats").innerHTML = beats.map((b) =>
      `<button type="button" class="act" data-beat="${esc(b.id)}" data-on="${b.id === beat ? "1" : "0"}"><i class="k">${esc(b.kicker)}</i><b>${esc(b.name)}</b></button>`
    ).join("");
    const meta = beats.find((b) => b.id === beat) || beats[0];
    if (!meta) return;
    beat = meta.id;
    $("logName").textContent = meta.name;
    $("gap").textContent = meta.gap || "";
    const figs = (record.figures || []).filter((f) => f.beat === beat);
    const figEl = $("figures");
    figEl.hidden = figs.length === 0;
    figEl.innerHTML = figs.map((f) =>
      `<div class="figure"><span class="k">${esc(f.label)}</span><b>${showNum(f.value)}</b><span class="as">${esc(f.as_of)} · ${esc(f.source_name)}</span></div>`
    ).join("");
    const body = (record.readings || {})[beat] || "";
    $("reading").hidden = !body;
    $("readingBody").textContent = body;
    const items = (record.items || []).filter((it) => it.beat === beat);
    $("ribbon").innerHTML = items.map((it) => {
      const href = safeUrl(it.url);
      const when = it.published || "date unknown";
      const on = mode === it.id ? "1" : "0";
      const link = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(it.source)}</a>` : esc(it.source);
      return `<li><button type="button" class="spin" data-id="${esc(it.id)}" data-on="${on}">${on === "1" ? "Stop" : "Play"}</button><div class="body"><span class="who">${esc(it.source)} · ${esc(it.kind)} · ${esc(when)}</span>${esc(it.title)}<div>${link}</div></div></li>`;
    }).join("") || `<li><div class="body"><span class="who">Record</span>Nothing pulled on this beat yet.</div></li>`;
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
      if (record.pulling && !poll) poll = setInterval(load, 2000);
      if (!record.pulling && poll) { clearInterval(poll); poll = null; }
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

  $("beats").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-beat]");
    if (!btn) return;
    beat = btn.dataset.beat;
    paint();
  });

  $("ribbon").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    playItem(btn.dataset.id);
  });

  $("pullBtn").addEventListener("click", async () => {
    stopAll();
    setState("pulling");
    showErr("");
    try {
      const res = await api("/api/pull", { method: "POST", body: "{}" });
      if (!res.ok) throw new Error("pull failed");
      await load();
    } catch (e) {
      if (e.message !== "unauthorized") {
        showErr(e.message || "pull failed");
        setState("ready");
      }
    }
  });

  $("playBtn").addEventListener("click", () => { playBrief(); });

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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  setState("boot");
  (async function boot() {
    try {
      const res = await fetch(apiUrl("/api/health"), { headers: headers(false) });
      const h = await res.json();
      if (!h.ok) throw new Error("dark");
      if (onPages && !h.authed && !token) { showConnect(""); return; }
      await load();
    } catch (_) {
      if (token || !onPages) {
        try { await load(); return; } catch (__) {}
      }
      setState("dark");
    }
  })();
})();
