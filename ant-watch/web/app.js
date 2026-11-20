import { analyze, analyzeSeries } from "./analysis.js";

// The list itself lives on the server (/api/watchlist) so it is the same on every device.
// This default is only used if the server can't be reached.
const DEFAULT_WATCHLIST = [
  { symbol: "ANT", name: "Anthropic", ipo: 83 },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "SPCX", name: "SpaceX", ipo: 135 },
];
const REFRESH_MS = 60_000;
const NS = "http://www.w3.org/2000/svg";
const DAY = 86_400;

// Same buttons for every stock. Short ranges use 15-minute bars, long ones daily bars.
const RANGES = [
  { key: "1D", src: "intra", days: 1 },
  { key: "5D", src: "intra", days: 5 },
  { key: "1M", src: "intra", days: 22 },
  { key: "3M", src: "daily", months: 3 },
  { key: "6M", src: "daily", months: 6 },
  { key: "1Y", src: "daily", months: 12 },
  { key: "5Y", src: "daily", months: 60 },
];

// Icons are Lucide (lucide-static 1.69.0, ISC licence): RISING = trending-up, FALLING = trending-down, STABLE = minus, VOLATILE = activity, NORMAL = circle, WARMING_UP = hourglass.
const STATES = {
  RISING:     { label: "Rising",     color: "--s-rising",   meaning: "A clear uptrend: trend strength is high and buyers are in control.",
                you: "If you plan to buy, waiting longer may mean paying more. Check that momentum isn't overheated (RSI above 70) before you chase it.",
                icon: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>' },
  FALLING:    { label: "Falling",    color: "--s-falling",  meaning: "A clear downtrend: trend strength is high and sellers are in control.",
                you: "Usually best to wait. Many people wait for a downtrend to flatten out and turn Stable before buying.",
                icon: '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>' },
  STABLE:     { label: "Stable",     color: "--s-stable",   meaning: "Calm and sideways: no real trend, and price swings are narrower than usual.",
                you: "This is the calm you've been waiting for. A Stable stretch that then breaks upward is the classic 'buy before it runs' moment.",
                icon: '<path d="M5 12h14"/>' },
  VOLATILE:   { label: "Volatile",   color: "--s-volatile", meaning: "Big, choppy swings without a clear direction.",
                you: "Usually best to wait. Prices can swing a lot within hours.",
                icon: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>' },
  NORMAL:     { label: "Normal",     color: "--s-normal",   meaning: "Nothing stands out: mild moves, no strong trend and normal swings.",
                you: "There's no signal to act on. Keep waiting for Stable.",
                icon: '<circle cx="12" cy="12" r="10"/>' },
  WARMING_UP: { label: "Warming up", color: "--s-warm",     meaning: "There isn't enough price history yet to judge reliably.",
                you: "Hang tight. The tracker needs a few more hours of trading data.",
                icon: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>' },
};

const $ = (id) => document.getElementById(id);
const ET = "America/New_York";
const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric" });
const fmtDayYear = new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short" });
const fmtYear = new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric" });
const fmtHour = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric" });
const fmtDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: ET });
const money = (x) => `$${x.toFixed(2)}`;
const pct = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let WATCHLIST = DEFAULT_WATCHLIST;
const cache = {}; // symbol -> { data, model, intraRows, dailyRows, error, stale }
let current = null, data = null, model = null, entry = null, range = store.get("stockwatch-range") || "5D", hoverIdx = null;
const cfg = () => WATCHLIST.find((w) => w.symbol === current) ?? { symbol: current, name: current };

function icon(state) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATES[state].icon}</svg>`;
}
// Small Lucide icons used inline in text (lucide-static 1.69.0).
const LUCIDE = {
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
};
function lucide(name, size = 16) {
  return `<svg class="lucide" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name]}</svg>`;
}
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
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
  const badge = h("div", "badge");
  badge.style.setProperty("--c", `var(${s.color})`);
  badge.innerHTML = icon(key);
  badge.append(`${cfg().name} is ${s.label}`);
  hero.append(badge);

  const pr = h("div", "price-row");
  pr.innerHTML = `<span class="price">${money(data.price)}</span>` +
    (dayChange != null ? `<span class="delta ${dayChange >= 0 ? "up" : "down"}">${lucide(dayChange >= 0 ? "arrow-up" : "arrow-down", 16)}${pct(dayChange)} today</span>` : "") +
    (ipo ? `<span class="sub">${pct((data.price / ipo - 1) * 100)} vs IPO price $${ipo}</span>` : "");
  pr.append(h("span", "sub", `Ticker: ${current}`));
  hero.append(pr);

  const adv = h("div", "advice");
  adv.innerHTML = `<p><b>What it means:</b> ${s.meaning}</p><p><b>For you (waiting to buy):</b> ${s.you}</p>` +
    (key !== "WARMING_UP" ? `<p class="sub">${s.label} since ${model.useDaily ? fmtDay.format(rows[start].t * 1000) : fmtTime.format(rows[start].t * 1000) + " ET"} · judged on ${model.timeframe}</p>` : "") +
    (last.pending && last.pending !== key ? `<p class="pending">This may be turning ${STATES[last.pending].label}. It needs one more bar to confirm.</p>` : "");
  hero.append(adv);

  const rm = h("button", "link-btn", `Remove ${cfg().name} from my list`);
  rm.onclick = () => removeStock(current);
  if (WATCHLIST.length > 1) hero.append(rm);
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
// Each range shows bars from one source; a range is greyed out when it would show no
// more history than the range before it (e.g. 1Y for a stock that listed last month).
function sliceFor(r) {
  const rows = r.src === "intra" ? entry.intraRows : entry.dailyRows;
  if (!rows.length) return { rows, start: 0, firstT: Infinity };
  let start = 0;
  if (r.days) {
    let seen = 0, prev = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const k = fmtDayKey.format(rows[i].t * 1000);
      if (k !== prev) { if (seen === r.days) { start = i + 1; break; } seen++; prev = k; }
    }
  } else {
    const cutoff = rows.at(-1).t - r.months * 30.44 * DAY;
    start = Math.max(0, rows.findIndex((x) => x.t >= cutoff));
  }
  return { rows, start, firstT: rows[start].t };
}
function enabledRanges() {
  // A range is on when it reaches back to an earlier trading day than the ranges before it.
  const out = {};
  let earliest = null;
  RANGES.forEach((r, i) => {
    const { firstT } = sliceFor(r);
    const day = Number.isFinite(firstT) ? fmtDayKey.format(firstT * 1000) : null;
    out[r.key] = i === 0 || (day != null && day < earliest);
    if (out[r.key] && day != null && (earliest == null || day < earliest)) earliest = day;
  });
  return out;
}
function effectiveRange() {
  const en = enabledRanges();
  if (en[range]) return range;
  const idx = RANGES.findIndex((r) => r.key === range);
  for (let i = Math.min(idx, RANGES.length - 1); i >= 0; i--) if (en[RANGES[i].key]) return RANGES[i].key;
  return RANGES[0].key;
}
function renderRanges() {
  const en = enabledRanges(), eff = effectiveRange();
  const box = $("ranges");
  box.innerHTML = "";
  for (const r of RANGES) {
    const b = h("button", null, r.key);
    b.setAttribute("aria-pressed", String(r.key === eff));
    b.disabled = !en[r.key];
    if (b.disabled) b.title = `${cfg().name} doesn't have more history to show yet`;
    b.onclick = () => { range = r.key; store.set("stockwatch-range", range); renderRanges(); renderChart(); };
    box.append(b);
  }
}

// The official state for any bar on screen: the confirmed state of the last bar of the
// timeframe the stock is judged on, at or before the end of that on-screen bar.
function officialStateAt(t, displayIsDaily) {
  const rows = model.rows, end = t + (displayIsDaily ? DAY - 1 : 0);
  let lo = 0, hi = rows.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].t <= end) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans < 0 ? "WARMING_UP" : rows[ans].confirmed ?? "WARMING_UP";
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

  const rk = effectiveRange(), r = RANGES.find((x) => x.key === rk), isDaily = r.src === "daily";
  const sl = sliceFor(r), rows = sl.rows.slice(sl.start);
  const n = rows.length;
  if (!n) return;
  const states = rows.map((x) => officialStateAt(x.t, isDaily));
  $("ema-label").textContent = `Trend line (EMA ${rows[0].slowN})`;

  const vals = rows.flatMap((x) => [x.close, x.bbUp, x.bbLo, x.emaSlow]).filter((v) => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  lo -= pad; hi += pad;
  const x = (i) => m.l + (n <= 1 ? (W - m.l - m.r) / 2 : (i / (n - 1)) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (plotB - m.t);

  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: cssVar("--grid"), "stroke-width": 1 }, svg);
    el("text", { x: W - m.r + 8, y: y(v) + 4 }, svg).textContent = `$${v.toFixed(step < 1 ? 1 : 0)}`;
  }

  const band = rows.map((x, i) => [i, x]).filter(([, x]) => x.bbUp != null);
  if (band.length > 1) {
    el("path", { d: band.map(([i, b], k) => `${k ? "L" : "M"}${x(i)},${y(b.bbUp)}`).join("") +
      band.slice().reverse().map(([i, b]) => `L${x(i)},${y(b.bbLo)}`).join("") + "Z", fill: cssVar("--wash") }, svg);
  }
  const emaPts = rows.map((x, i) => [i, x.emaSlow]).filter(([, v]) => v != null);
  if (emaPts.length > 1) el("path", { d: line(emaPts, x, y), fill: "none", stroke: cssVar("--muted"), "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg);
  el("path", { d: line(rows.map((x, i) => [i, x.close]), x, y), fill: "none", stroke: cssVar("--ink"), "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  el("circle", { cx: x(n - 1), cy: y(rows[n - 1].close), r: 4.5, fill: cssVar("--ink"), stroke: cssVar("--surface"), "stroke-width": 2 }, svg);

  // State strip: one rounded segment per run of the same state, 2px gaps between runs
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || states[i] !== states[runStart]) {
      const key = states[runStart];
      const xa = x(Math.max(0, runStart - 0.5)), xb = x(Math.min(n - 1, i - 0.5));
      const wSeg = Math.max(2, xb - xa - (i < n ? 2 : 0));
      const seg = el("rect", { x: xa, y: stripY, width: wSeg, height: stripH, rx: Math.min(3, wSeg / 2), fill: cssVar(STATES[key].color) }, svg);
      el("title", {}, seg).textContent = STATES[key].label;
      runStart = i;
    }
  }

  // x labels: hours (1D), days (5D/1M), months (3M–1Y) or years (5Y)
  const keyFn = rk === "1D" ? (t) => fmtHour.format(t * 1000) : !isDaily ? (t) => fmtDayKey.format(t * 1000)
    : rk === "5Y" ? (t) => fmtYear.format(t * 1000) : (t) => fmtDayKey.format(t * 1000).slice(0, 7);
  const labelFn = rk === "1D" ? (t) => fmtHour.format(t * 1000) : !isDaily ? (t) => fmtDay.format(t * 1000)
    : rk === "5Y" ? (t) => fmtYear.format(t * 1000) : (t) => fmtMonth.format(t * 1000);
  const marks = [];
  rows.forEach((row, i) => { if (i === 0 || keyFn(rows[i - 1].t) !== keyFn(row.t)) marks.push(i); });
  const maxLabels = Math.max(2, Math.floor((W - m.r) / 64));
  const every = Math.ceil(marks.length / maxLabels);
  marks.filter((_, k) => k % every === 0).forEach((i) => {
    el("line", { x1: x(i), x2: x(i), y1: plotB, y2: plotB + 4, stroke: cssVar("--axis") }, svg);
    el("text", { x: Math.min(x(i), W - m.r - 30), y: H - 8 }, svg).textContent = labelFn(rows[i].t);
  });
  el("line", { x1: m.l, x2: W - m.r, y1: plotB, y2: plotB, stroke: cssVar("--axis"), "stroke-width": 1 }, svg);

  // crosshair + tooltip
  const cross = el("g", { opacity: 0 }, svg);
  const vline = el("line", { y1: m.t, y2: plotB, stroke: cssVar("--ink-2"), "stroke-width": 1 }, cross);
  const dot = el("circle", { r: 4.5, fill: cssVar("--ink"), stroke: cssVar("--surface"), "stroke-width": 2 }, cross);
  const tip = $("tip");
  const show = (i) => {
    hoverIdx = i;
    const row = rows[i], key = states[i];
    cross.setAttribute("opacity", 1);
    vline.setAttribute("x1", x(i)); vline.setAttribute("x2", x(i));
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(row.close));
    tip.innerHTML = "";
    tip.append(h("div", "l", isDaily ? fmtDayYear.format(row.t * 1000) : `${fmtTime.format(row.t * 1000)} ET`));
    tip.append(h("div", "v", money(row.close)));
    const addRow = (label, value) => { const d = h("div", "row"); d.append(h("span", "l", label), value); tip.append(d); };
    if (row.emaSlow != null) addRow("Trend line", h("span", null, money(row.emaSlow)));
    const st = h("span");
    st.innerHTML = `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:var(${STATES[key].color})"></i>`;
    st.append(STATES[key].label);
    addRow("State", st);
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
  svg.setAttribute("aria-label", `${cfg().name} price over ${rk}: ${money(rows[0].close)} to ${money(rows[n - 1].close)}. Current state ${STATES[states[n - 1]].label}.`);

  const keyEl = $("state-key");
  keyEl.innerHTML = "";
  for (const k of Object.keys(STATES).filter((k) => states.includes(k))) {
    const sp = h("span");
    sp.innerHTML = `<i style="background:var(${STATES[k].color})"></i>`;
    sp.append(STATES[k].label);
    keyEl.append(sp);
  }
  renderTable(rows, states, isDaily);
}

function renderTable(rows, states, isDaily) {
  const tbl = document.createElement("table");
  tbl.innerHTML = `<tr><th>${isDaily ? "Date" : "Time (ET)"}</th><th>Close</th><th>State</th></tr>`;
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 60); i--) {
    const tr = tbl.insertRow();
    tr.insertCell().textContent = isDaily ? fmtDayYear.format(rows[i].t * 1000) : fmtTime.format(rows[i].t * 1000);
    const c = tr.insertCell(); c.className = "num"; c.textContent = money(rows[i].close);
    tr.insertCell().textContent = STATES[states[i]].label;
  }
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
    const e = cache[w.symbol];
    const b = h("button", "watch-item");
    b.setAttribute("aria-pressed", String(w.symbol === current));
    const top = h("div", "w-name", w.name);
    top.append(h("span", null, ` ${w.symbol}`));
    const price = h("div", "w-price", e?.data ? money(e.data.price) : e?.error ? "Unavailable" : "…");
    const st = h("div", "w-state");
    if (e?.data) {
      const dc = dayChange(e.data);
      if (dc != null) price.append(h("span", `delta ${dc >= 0 ? "up" : "down"}`, ` ${pct(dc)}`));
      const r = e.model.rows.at(-1), key = r.confirmed ?? r.state;
      st.innerHTML = `<i style="background:var(${STATES[key].color})"></i>`;
      st.append(STATES[key].label);
    }
    b.append(top, price, st);
    b.onclick = () => select(w.symbol);
    nav.append(b);
  }
  const add = h("button", "watch-item add-item");
  // Lucide "plus"
  add.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg><span>Add stock</span>';
  add.setAttribute("aria-expanded", String(!$("add-panel").hidden));
  add.onclick = () => toggleAdd();
  nav.append(add);
}
function select(symbol) {
  current = symbol;
  store.set("stockwatch-symbol", symbol);
  if (location.hash !== `#${symbol}`) history.replaceState(null, "", `#${symbol}`);
  renderWatchlist();
  renderCurrent();
}
function renderCurrent() {
  entry = cache[current];
  if (!entry?.data) {
    $("hero").innerHTML = "";
    $("hero").append(h("p", entry?.error ? "err" : "skeleton", entry?.error ? `Couldn't load prices: ${entry.error}. It will try again in a minute.` : "Fetching the latest prices…"));
    return;
  }
  ({ data, model } = entry);
  hoverIdx = null;
  renderHero(); renderRanges(); renderSignals(); renderChart();
  $("fresh").textContent = entry.stale
    ? `Couldn't refresh (${entry.stale}). Showing ${fmtTime.format(data.marketTime * 1000)} ET.`
    : `Last trade ${fmtTime.format(data.marketTime * 1000)} ET · refreshes every minute`;
}

// ------------------------------------------------------------------ add / remove stocks
let searchTimer = null, searchSeq = 0;
function toggleAdd(open) {
  const panel = $("add-panel");
  panel.hidden = open === undefined ? !panel.hidden : !open;
  $("add-key-row").hidden = !!store.get("stockwatch-key");
  $("add-msg").textContent = "";
  renderWatchlist();
  if (!panel.hidden) $("add-search").focus();
}
async function runSearch(q) {
  const seq = ++searchSeq, list = $("add-results");
  if (!q.trim()) { list.innerHTML = ""; return; }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
    const json = await res.json();
    if (seq !== searchSeq) return; // a newer search is on its way
    if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
    list.innerHTML = "";
    if (!json.results.length) list.append(h("li", "muted", "No stocks found."));
    for (const r of json.results) {
      const li = h("li");
      const b = h("button", "result");
      const inList = WATCHLIST.some((w) => w.symbol === r.symbol);
      b.append(h("b", null, r.symbol), h("span", null, r.name), h("small", null, inList ? "On your list" : [r.exchange, r.type].filter(Boolean).join(" · ")));
      b.disabled = inList;
      b.onclick = () => addStock(r.symbol, r.name);
      li.append(b);
      list.append(li);
    }
  } catch (e) {
    if (seq === searchSeq) { list.innerHTML = ""; list.append(h("li", "err", `Search failed: ${e.message}`)); }
  }
}
function editKey() {
  const typed = $("add-key")?.value.trim();
  if (typed) store.set("stockwatch-key", typed);
  return store.get("stockwatch-key");
}
async function changeList(action, symbol, name) {
  const key = editKey();
  if (!key) throw new Error("Enter your edit key first.");
  const res = await fetch("/api/watchlist", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Edit-Key": key },
    body: JSON.stringify({ action, symbol, name }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) { store.set("stockwatch-key", null); $("add-key-row").hidden = false; }
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  WATCHLIST = json.stocks;
}
async function addStock(symbol, name) {
  const msg = $("add-msg");
  msg.className = "muted"; msg.textContent = `Adding ${symbol}…`;
  try {
    await changeList("add", symbol, name);
    $("add-search").value = ""; $("add-results").innerHTML = "";
    toggleAdd(false);
    await fetchOne(symbol);
    select(symbol);
  } catch (e) {
    msg.className = "err"; msg.textContent = e.message;
  }
}
async function removeStock(symbol) {
  const name = cfg().name;
  if (!confirm(`Remove ${name} (${symbol}) from your list? You'll stop getting alerts for it.`)) return;
  if (!store.get("stockwatch-key")) {
    const k = prompt("Enter your edit key to change the list:");
    if (!k) return;
    store.set("stockwatch-key", k.trim());
  }
  try {
    await changeList("remove", symbol);
    delete cache[symbol];
    select(WATCHLIST.some((w) => w.symbol === current) ? current : WATCHLIST[0].symbol);
  } catch (e) {
    alert(`Couldn't remove ${symbol}: ${e.message}`);
  }
}

// ------------------------------------------------------------------ load
async function fetchOne(symbol) {
  try {
    const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
    if (!json.intraday?.c?.length && !json.daily?.c?.length) throw new Error("no price data returned yet");
    const m = analyze(json.intraday, json.daily);
    const intraRows = m.useDaily ? analyzeSeries(json.intraday, 9, 21) : m.rows;
    const dailyRows = m.useDaily ? m.rows : analyzeSeries(json.daily, 20, 50);
    cache[symbol] = { data: json, model: m, intraRows, dailyRows };
  } catch (e) {
    if (cache[symbol]?.data) cache[symbol].stale = e.message; // keep showing the last good data
    else cache[symbol] = { error: e.message };
  }
}
async function loadWatchlist() {
  try {
    const res = await fetch("/api/watchlist", { cache: "no-store" });
    const json = await res.json();
    if (res.ok && Array.isArray(json.stocks) && json.stocks.length) WATCHLIST = json.stocks;
  } catch {}
  if (!WATCHLIST.some((w) => w.symbol === current)) current = WATCHLIST[0].symbol;
}
async function load() {
  await loadWatchlist();
  // The selected stock first, so its view appears quickly; then the rest.
  await fetchOne(current);
  renderWatchlist(); renderCurrent();
  await Promise.all(WATCHLIST.filter((w) => w.symbol !== current).map((w) => fetchOne(w.symbol)));
  renderWatchlist();
}

current = location.hash.slice(1).toUpperCase() || store.get("stockwatch-symbol") || DEFAULT_WATCHLIST[0].symbol;
$("add-search").addEventListener("input", (ev) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(ev.target.value), 250); });
$("add-close").onclick = () => toggleAdd(false);
$("add-panel").addEventListener("keydown", (ev) => { if (ev.key === "Escape") toggleAdd(false); });
renderWatchlist();
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && data && Date.now() - data.fetchedAt > REFRESH_MS) load(); });
window.addEventListener("hashchange", () => { const s = location.hash.slice(1).toUpperCase(); if (WATCHLIST.some((w) => w.symbol === s) && s !== current) select(s); });
let rt;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => model && renderChart(), 100); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => model && renderChart());
