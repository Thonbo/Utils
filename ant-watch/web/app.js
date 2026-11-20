import { analyze } from "./analysis.js";

// Keep in sync with WATCHLIST in .github/workflows/ant-watch.yml and ALLOWED in netlify/functions/chart.mts.
const WATCHLIST = [
  { symbol: "ANT", name: "Anthropic", ipo: 83 },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "SPCX", name: "SpaceX", ipo: 135 },
];
const REFRESH_MS = 60_000;
const NS = "http://www.w3.org/2000/svg";

const STATES = {
  RISING:     { label: "Rising",     color: "--s-rising",   meaning: "A clear uptrend: trend strength is high and buyers are in control.",
                you: "If you plan to buy, waiting longer may mean paying more. Check that momentum isn't overheated (RSI above 70) before you chase it.",
                icon: '<path d="M4 16 10 10l4 4 6-7"/><path d="M15 7h5v5"/>' },
  FALLING:    { label: "Falling",    color: "--s-falling",  meaning: "A clear downtrend: trend strength is high and sellers are in control.",
                you: "Usually best to wait. Many people wait for a downtrend to flatten out and turn Stable before buying.",
                icon: '<path d="M4 8l6 6 4-4 6 7"/><path d="M15 17h5v-5"/>' },
  STABLE:     { label: "Stable",     color: "--s-stable",   meaning: "Calm and sideways: no real trend, and price swings are narrower than usual.",
                you: "This is the calm you've been waiting for. A Stable stretch that then breaks upward is the classic 'buy before it runs' moment.",
                icon: '<path d="M4 12h16"/><path d="M4 7h16" opacity=".35"/><path d="M4 17h16" opacity=".35"/>' },
  VOLATILE:   { label: "Volatile",   color: "--s-volatile", meaning: "Big, choppy swings without a clear direction.",
                you: "Usually best to wait. Prices can swing a lot within hours.",
                icon: '<path d="M3 13l3-6 4 10 4-12 3 9 4-4"/>' },
  NORMAL:     { label: "Normal",     color: "--s-normal",   meaning: "Nothing stands out: mild moves, no strong trend and normal swings.",
                you: "There's no signal to act on. Keep waiting for Stable.",
                icon: '<circle cx="12" cy="12" r="6"/>' },
  WARMING_UP: { label: "Warming up", color: "--s-warm",     meaning: "There isn't enough price history yet to judge reliably.",
                you: "Hang tight. The tracker needs a few more hours of trading data.",
                icon: '<path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8"/>' },
};

const $ = (id) => document.getElementById(id);
const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const fmtDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const money = (x) => `$${x.toFixed(2)}`;
const pct = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const cache = {}; // symbol -> { data, model, error }
let current = WATCHLIST[0].symbol, data = null, model = null, range = null, hoverIdx = null;
const cfg = () => WATCHLIST.find((w) => w.symbol === current);

function icon(state) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATES[state].icon}</svg>`;
}
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// ------------------------------------------------------------------ hero
function renderHero() {
  const rows = model.rows, last = rows.at(-1);
  const key = last.confirmed ?? last.state, s = STATES[key];
  let start = rows.length - 1;
  while (start > 0 && rows[start - 1].confirmed === key) start--;
  const d = data.daily.c;
  const dayChange = d.length >= 2 ? (data.price / d.at(-2) - 1) * 100 : null;
  const ipo = cfg().ipo;

  const hero = $("hero");
  hero.innerHTML = "";
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.style.setProperty("--c", `var(${s.color})`);
  badge.innerHTML = icon(key);
  badge.append(`${cfg().name} is ${s.label}`);
  hero.append(badge);

  const pr = document.createElement("div");
  pr.className = "price-row";
  pr.innerHTML = `<span class="price">${money(data.price)}</span>` +
    (dayChange != null ? `<span class="delta ${dayChange >= 0 ? "up" : "down"}">${dayChange >= 0 ? "▲" : "▼"} ${pct(dayChange)} today</span>` : "") +
    (ipo ? `<span class="sub">${pct((data.price / ipo - 1) * 100)} vs IPO price $${ipo}</span>` : "") +
    `<span class="sub">Nasdaq: ${current}</span>`;
  hero.append(pr);

  const adv = document.createElement("div");
  adv.className = "advice";
  adv.innerHTML = `<p><b>What it means:</b> ${s.meaning}</p><p><b>For you (waiting to buy):</b> ${s.you}</p>` +
    (key !== "WARMING_UP" ? `<p class="sub">${s.label} since ${model.useDaily ? fmtDay.format(rows[start].t * 1000) : fmtTime.format(rows[start].t * 1000) + " ET"} · judged on ${model.timeframe}</p>` : "") +
    (last.pending && last.pending !== key ? `<p class="pending">This may be turning ${STATES[last.pending].label}. It needs one more bar to confirm.</p>` : "");
  hero.append(adv);
}

// ------------------------------------------------------------------ signals
function renderSignals() {
  const r = model.rows.at(-1), out = [];
  if (r.adx != null) {
    const w = r.adx >= 25 ? "Strong trend" : r.adx < 20 ? "Weak or no trend" : "A trend may be forming";
    out.push(["Trend strength (ADX 14)", r.adx.toFixed(1), `${w}. Under 20 means no trend, over 25 means a strong one.`]);
    out.push(["Direction (+DI / −DI)", `${r.pdi.toFixed(1)} / ${r.mdi.toFixed(1)}`, r.pdi > r.mdi ? "Buyers are ahead." : "Sellers are ahead."]);
  }
  if (r.emaSlow != null) out.push([`Moving averages (EMA ${r.fastN} / ${r.slowN})`, `${money(r.emaFast)} / ${money(r.emaSlow)}`,
    r.emaFast > r.emaSlow ? "The short-term average is above the longer-term one (up)." : "The short-term average is below the longer-term one (down)."]);
  if (r.bbw != null) {
    const w = r.bbwRank <= 0.35 ? "Narrow, a squeeze" : r.bbwRank >= 0.8 ? "Wide" : "Average";
    out.push(["Bollinger Band width (20, 2)", `${(r.bbw * 100).toFixed(1)}%`, `${w}. ${bandText(r.bbwRank)}`]);
  }
  if (r.atrPct != null) out.push(["Typical move per bar (ATR 14)", `${(r.atrPct * 100).toFixed(2)}%`, r.volRatio ? `${r.volRatio.toFixed(1)}× its usual size.` : ""]);
  if (r.rsi != null) {
    const w = r.rsi >= 70 ? "Overheated" : r.rsi <= 30 ? "Oversold" : "Neutral";
    out.push(["Momentum (RSI 14)", r.rsi.toFixed(0), `${w}. Over 70 is hot, under 30 is cold.`]);
  }
  if (r.volumeRatio != null) out.push(["Volume vs 20-bar average", `${r.volumeRatio.toFixed(1)}×`, r.volumeRatio >= 1.5 ? "Heavier trading than usual." : ""]);
  const t = $("signals");
  t.innerHTML = out.length ? "" : `<tr><td class="read">Signals appear once there are ${30} bars of history.</td></tr>`;
  for (const [a, b, c] of out) {
    const tr = t.insertRow();
    tr.insertCell().textContent = a;
    const n = tr.insertCell(); n.className = "num"; n.textContent = b;
    const rd = tr.insertCell(); rd.className = "read"; rd.textContent = c;
  }
}

function bandText(rank) {
  if (rank >= 0.99) return "The widest in recent history.";
  if (rank <= 0.01) return "The narrowest in recent history.";
  return rank >= 0.5 ? `Wider than ${Math.round(rank * 100)}% of recent history.` : `Narrower than ${Math.round(100 - rank * 100)}% of recent history.`;
}

// ------------------------------------------------------------------ ranges
function rangeOptions() {
  if (model.useDaily) return [["1M", 21], ["3M", 63], ["6M", 126], ["All", Infinity]];
  return [["1D", 1], ["5D", 5], ["1M", 21], ["All", Infinity]];
}
function visibleStart() {
  const rows = model.rows, n = rangeOptions().find(([k]) => k === range)?.[1] ?? Infinity;
  if (n === Infinity) return 0;
  if (model.useDaily) return Math.max(0, rows.length - n);
  const days = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const k = fmtDayKey.format(rows[i].t * 1000);
    if (days.at(-1) !== k) { if (days.length === n) return i + 1; days.push(k); }
  }
  return 0;
}
function renderRanges() {
  const opts = rangeOptions();
  if (!opts.some(([k]) => k === range)) range = opts[1][0];
  const box = $("ranges");
  box.innerHTML = "";
  for (const [k] of opts) {
    const b = document.createElement("button");
    b.textContent = k;
    b.setAttribute("aria-pressed", String(k === range));
    b.onclick = () => { range = k; try { localStorage.setItem("antwatch-range", k); } catch {} renderRanges(); renderChart(); };
    box.append(b);
  }
  const r = model.rows.at(-1);
  $("ema-label").textContent = `Trend line (EMA ${r.slowN})`;
}

// ------------------------------------------------------------------ chart
function renderChart() {
  const svg = $("chart"), wrap = $("chart-wrap");
  const W = Math.max(300, Math.round(wrap.clientWidth));
  const H = W < 560 ? 260 : 320;
  const m = { l: 4, r: 56, t: 12, b: 44 }, stripH = 10;
  const plotB = H - m.b, stripY = plotB + 8;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const all = model.rows, s0 = visibleStart(), rows = all.slice(s0);
  const n = rows.length;
  const vals = rows.flatMap((r) => [r.close, r.bbUp, r.bbLo, r.emaSlow]).filter((x) => x != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  lo -= pad; hi += pad;
  const x = (i) => m.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (plotB - m.t);

  // grid + y labels
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: cssVar("--grid"), "stroke-width": 1 }, svg);
    el("text", { x: W - m.r + 8, y: y(v) + 4 }, svg).textContent = `$${v.toFixed(step < 1 ? 1 : 0)}`;
  }

  // Bollinger band
  const band = rows.map((r, i) => [i, r]).filter(([, r]) => r.bbUp != null);
  if (band.length > 1) {
    const d = band.map(([i, r], k) => `${k ? "L" : "M"}${x(i)},${y(r.bbUp)}`).join("") +
      band.slice().reverse().map(([i, r]) => `L${x(i)},${y(r.bbLo)}`).join("") + "Z";
    el("path", { d, fill: cssVar("--wash") }, svg);
  }
  // EMA trend line
  const emaPts = rows.map((r, i) => [i, r.emaSlow]).filter(([, v]) => v != null);
  if (emaPts.length > 1) el("path", { d: line(emaPts, x, y), fill: "none", stroke: cssVar("--muted"), "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg);
  // Price
  el("path", { d: line(rows.map((r, i) => [i, r.close]), x, y), fill: "none", stroke: cssVar("--ink"), "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  const lx = x(n - 1), ly = y(rows[n - 1].close);
  el("circle", { cx: lx, cy: ly, r: 4.5, fill: cssVar("--ink"), stroke: cssVar("--surface"), "stroke-width": 2 }, svg);

  // State strip: one rounded segment per run of the same confirmed state, 2px gaps between runs
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || rows[i].confirmed !== rows[runStart].confirmed) {
      const key = rows[runStart].confirmed ?? "WARMING_UP";
      const xa = x(Math.max(0, runStart - 0.5)), xb = x(Math.min(n - 1, i - 0.5));
      const wSeg = Math.max(1, xb - xa - (i < n ? 2 : 0));
      const r = el("rect", { x: xa, y: stripY, width: wSeg, height: stripH, rx: Math.min(3, wSeg / 2), fill: cssVar(STATES[key].color) }, svg);
      el("title", {}, r).textContent = STATES[key].label;
      runStart = i;
    }
  }

  // x labels: day starts (intraday) or month starts (daily)
  const marks = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const key = (t) => model.useDaily ? fmtDayKey.format(t * 1000).slice(0, 7) : fmtDayKey.format(t * 1000);
    if (!prev || key(prev.t) !== key(r.t)) marks.push(i);
  });
  const maxLabels = Math.max(2, Math.floor((W - m.r) / 70));
  const every = Math.ceil(marks.length / maxLabels);
  marks.filter((_, k) => k % every === 0).forEach((i) => {
    const t = rows[i].t * 1000;
    const label = model.useDaily ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short" }).format(t) : fmtDay.format(t);
    el("line", { x1: x(i), x2: x(i), y1: plotB, y2: plotB + 4, stroke: cssVar("--axis") }, svg);
    el("text", { x: Math.min(x(i), W - m.r - 30), y: H - 8 }, svg).textContent = label;
  });
  el("line", { x1: m.l, x2: W - m.r, y1: plotB, y2: plotB, stroke: cssVar("--axis"), "stroke-width": 1 }, svg);

  // crosshair layer
  const cross = el("g", { opacity: 0 }, svg);
  const vline = el("line", { y1: m.t, y2: plotB, stroke: cssVar("--ink-2"), "stroke-width": 1 }, cross);
  const dot = el("circle", { r: 4.5, fill: cssVar("--ink"), stroke: cssVar("--surface"), "stroke-width": 2 }, cross);
  const tip = $("tip");
  const show = (i) => {
    hoverIdx = i;
    const r = rows[i];
    cross.setAttribute("opacity", 1);
    vline.setAttribute("x1", x(i)); vline.setAttribute("x2", x(i));
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(r.close));
    const key = r.confirmed ?? "WARMING_UP";
    tip.innerHTML = "";
    const add = (cls, txt) => { const d = document.createElement("div"); d.className = cls; d.textContent = txt; tip.append(d); return d; };
    add("l", `${model.useDaily ? fmtDay.format(r.t * 1000) : fmtTime.format(r.t * 1000) + " ET"}`);
    add("v", money(r.close));
    if (r.emaSlow != null) { const row = add("row", ""); row.innerHTML = `<span class="l"></span><span></span>`; row.children[0].textContent = "Trend line"; row.children[1].textContent = money(r.emaSlow); }
    const st = add("row", ""); st.innerHTML = `<span class="l">State</span><span></span>`;
    st.children[1].innerHTML = `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:var(${STATES[key].color})"></i>`;
    st.children[1].append(STATES[key].label);
    tip.style.opacity = 1;
    const tw = tip.offsetWidth, px = (x(i) / W) * wrap.clientWidth;
    tip.style.left = `${Math.min(Math.max(0, px + 12 + tw > wrap.clientWidth ? px - tw - 12 : px + 12), wrap.clientWidth - tw)}px`;
    tip.style.top = `${(m.t / H) * wrap.clientHeight}px`;
  };
  const hide = () => { hoverIdx = null; cross.setAttribute("opacity", 0); tip.style.opacity = 0; };
  const idxAt = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
  };
  svg.onpointermove = (ev) => show(idxAt(ev));
  svg.onpointerdown = (ev) => show(idxAt(ev));
  svg.onpointerleave = hide;
  svg.setAttribute("tabindex", "0");
  svg.onkeydown = (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    show(Math.max(0, Math.min(n - 1, (hoverIdx ?? n - 1) + (ev.key === "ArrowLeft" ? -1 : 1))));
  };
  svg.onblur = hide;
  svg.setAttribute("aria-label", `${cfg().name} price over ${range}: ${money(rows[0].close)} to ${money(rows[n - 1].close)}. Current state ${STATES[rows[n - 1].confirmed ?? "WARMING_UP"].label}.`);

  // state key + table
  const used = [...new Set(rows.map((r) => r.confirmed ?? "WARMING_UP"))];
  $("state-key").innerHTML = "";
  for (const k of Object.keys(STATES).filter((k) => used.includes(k))) {
    const s = document.createElement("span");
    s.innerHTML = `<i style="background:var(${STATES[k].color})"></i>`;
    s.append(STATES[k].label);
    $("state-key").append(s);
  }
  renderTable(rows);
}

function renderTable(rows) {
  const tbl = document.createElement("table");
  tbl.innerHTML = "<tr><th>Time (ET)</th><th>Close</th><th>State</th></tr>";
  rows.slice(-60).reverse().forEach((r) => {
    const tr = tbl.insertRow();
    tr.insertCell().textContent = model.useDaily ? fmtDay.format(r.t * 1000) : fmtTime.format(r.t * 1000);
    const c = tr.insertCell(); c.className = "num"; c.textContent = money(r.close);
    tr.insertCell().textContent = STATES[r.confirmed ?? "WARMING_UP"].label;
  });
  $("data-table").replaceChildren(tbl);
}

function line(pts, x, y) { return pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""); }
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

// ------------------------------------------------------------------ watchlist
function dayChange(d) {
  return d.daily.c.length >= 2 ? (d.price / d.daily.c.at(-2) - 1) * 100 : null;
}
function renderWatchlist() {
  const nav = $("watchlist");
  nav.innerHTML = "";
  for (const w of WATCHLIST) {
    const entry = cache[w.symbol];
    const b = document.createElement("button");
    b.className = "watch-item";
    b.setAttribute("aria-pressed", String(w.symbol === current));
    const top = document.createElement("div"); top.className = "w-name";
    top.textContent = w.name;
    const sym = document.createElement("span"); sym.textContent = ` ${w.symbol}`; top.append(sym);
    const price = document.createElement("div"); price.className = "w-price";
    const st = document.createElement("div"); st.className = "w-state";
    if (entry?.data) {
      const dc = dayChange(entry.data);
      price.textContent = money(entry.data.price);
      if (dc != null) { const d = document.createElement("span"); d.className = `delta ${dc >= 0 ? "up" : "down"}`; d.textContent = ` ${pct(dc)}`; price.append(d); }
      const r = entry.model.rows.at(-1), key = r.confirmed ?? r.state;
      st.innerHTML = `<i style="background:var(${STATES[key].color})"></i>`;
      st.append(STATES[key].label);
    } else {
      price.textContent = entry?.error ? "Unavailable" : "…";
    }
    b.append(top, price, st);
    b.onclick = () => select(w.symbol);
    nav.append(b);
  }
}
function select(symbol) {
  current = symbol;
  try { localStorage.setItem("stockwatch-symbol", symbol); } catch {}
  if (location.hash !== `#${symbol}`) history.replaceState(null, "", `#${symbol}`);
  renderWatchlist();
  renderCurrent();
}
function renderCurrent() {
  const entry = cache[current];
  if (!entry?.data) {
    $("hero").innerHTML = '<p class="err"></p>';
    $("hero").firstChild.textContent = entry?.error ? `Couldn't load prices: ${entry.error}. It will try again in a minute.` : "Fetching the latest prices…";
    return;
  }
  ({ data, model } = entry);
  hoverIdx = null;
  renderHero(); renderRanges(); renderSignals(); renderChart();
  $("fresh").textContent = `Last trade ${fmtTime.format(data.marketTime * 1000)} ET · refreshes every minute`;
}

// ------------------------------------------------------------------ load
async function fetchOne(symbol) {
  try {
    const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
    if (!json.intraday?.c?.length) throw new Error("no price data returned yet");
    cache[symbol] = { data: json, model: analyze(json.intraday, json.daily) };
  } catch (e) {
    if (cache[symbol]?.data) cache[symbol].stale = e.message; // keep showing the last good data
    else cache[symbol] = { error: e.message };
  }
}
async function load() {
  // The selected stock first, so its view appears quickly; then the rest.
  await fetchOne(current);
  renderWatchlist(); renderCurrent();
  await Promise.all(WATCHLIST.filter((w) => w.symbol !== current).map((w) => fetchOne(w.symbol)));
  renderWatchlist();
  if (cache[current]?.stale) $("fresh").textContent = `Couldn't refresh (${cache[current].stale}). Showing ${fmtTime.format(data.marketTime * 1000)} ET.`;
}

{
  const fromHash = location.hash.slice(1).toUpperCase();
  let saved = null;
  try { range = localStorage.getItem("antwatch-range"); saved = localStorage.getItem("stockwatch-symbol"); } catch {}
  current = [fromHash, saved].find((s) => WATCHLIST.some((w) => w.symbol === s)) ?? WATCHLIST[0].symbol;
}
renderWatchlist();
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && data && Date.now() - data.fetchedAt > REFRESH_MS) load(); });
window.addEventListener("hashchange", () => { const s = location.hash.slice(1).toUpperCase(); if (WATCHLIST.some((w) => w.symbol === s) && s !== current) select(s); });
let rt;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => model && renderChart(), 100); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => model && renderChart());
