// Same indicators and rules as ant_watch.py (keep the two in sync).
// Every series is causal, so the value at index i only uses bars 0..i.

export const WARMUP_BARS = 30;
export const DAILY_SWITCH_BARS = 60;
export const CONFIRM_RUNS = 2;

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export function bollinger(c, n = 20, k = 2) {
  const mid = [], up = [], lo = [], width = [];
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) { mid.push(null); up.push(null); lo.push(null); width.push(null); continue; }
    const w = c.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    mid.push(m); up.push(m + k * sd); lo.push(m - k * sd); width.push(m ? (2 * k * sd) / m : null);
  }
  return { mid, up, lo, width };
}

export function rsi(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  const g = [], l = [];
  for (let i = 1; i < c.length; i++) { g.push(Math.max(c[i] - c[i - 1], 0)); l.push(Math.max(c[i - 1] - c[i], 0)); }
  let ag = g.slice(0, n).reduce((a, b) => a + b, 0) / n, al = l.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const val = (a, b) => (b === 0 ? (a > 0 ? 100 : 50) : 100 - 100 / (1 + a / b));
  out[n] = val(ag, al);
  for (let i = n; i < g.length; i++) {
    ag = (ag * (n - 1) + g[i]) / n; al = (al * (n - 1) + l[i]) / n; out[i + 1] = val(ag, al);
  }
  return out;
}

function trueRanges(h, l, c) {
  const tr = [h[0] - l[0]];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  return tr;
}

export function atr(h, l, c, n = 14) {
  const tr = trueRanges(h, l, c);
  const out = new Array(tr.length).fill(null);
  if (tr.length < n) return out;
  let prev = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < tr.length; i++) { prev = (prev * (n - 1) + tr[i]) / n; out[i] = prev; }
  return out;
}

export function adx(h, l, c, n = 14) {
  const size = c.length;
  const A = new Array(size).fill(null), P = new Array(size).fill(null), M = new Array(size).fill(null);
  if (size < 2 * n + 1) return { adx: A, pdi: P, mdi: M };
  const tr = trueRanges(h, l, c), pdm = [0], mdm = [0];
  for (let i = 1; i < size; i++) {
    const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
    pdm.push(up > down && up > 0 ? up : 0); mdm.push(down > up && down > 0 ? down : 0);
  }
  const sum = (a, s, e) => a.slice(s, e).reduce((x, y) => x + y, 0);
  let sTr = sum(tr, 1, n + 1), sP = sum(pdm, 1, n + 1), sM = sum(mdm, 1, n + 1);
  const dxs = [];
  for (let i = n; i < size; i++) {
    if (i > n) { sTr = sTr - sTr / n + tr[i]; sP = sP - sP / n + pdm[i]; sM = sM - sM / n + mdm[i]; }
    const pdi = sTr ? (100 * sP) / sTr : 0, mdi = sTr ? (100 * sM) / sTr : 0;
    P[i] = pdi; M[i] = mdi;
    dxs.push(pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0);
    if (dxs.length === n) A[i] = dxs.reduce((a, b) => a + b, 0) / n;
    else if (dxs.length > n) A[i] = (A[i - 1] * (n - 1) + dxs[dxs.length - 1]) / n;
  }
  return { adx: A, pdi: P, mdi: M };
}

function median(a) {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Indicators + candidate state for every bar. */
export function analyzeSeries(bars, fast = 9, slow = 21) {
  const { c, h, l, v } = bars;
  const ad = adx(h, l, c), ef = ema(c, fast), es = ema(c, slow), bb = bollinger(c), at = atr(h, l, c), rs = rsi(c);
  const atrPct = at.map((x, i) => (x != null && c[i] ? x / c[i] : null));
  const rows = [];
  for (let i = 0; i < c.length; i++) {
    const r = {
      i, t: bars.t[i], close: c[i], adx: ad.adx[i], pdi: ad.pdi[i], mdi: ad.mdi[i], emaFast: ef[i], emaSlow: es[i],
      bbUp: bb.up[i], bbLo: bb.lo[i], bbw: bb.width[i], atrPct: atrPct[i], rsi: rs[i], fastN: fast, slowN: slow,
      bbwRank: null, volRatio: null, volumeRatio: null,
    };
    if (r.bbw != null) {
      const hist = bb.width.slice(Math.max(0, i - 99), i + 1).filter((x) => x != null);
      r.bbwRank = hist.filter((x) => x <= r.bbw).length / hist.length;
    }
    const ah = atrPct.slice(Math.max(0, i - 99), i + 1).filter((x) => x != null);
    if (ah.length && r.atrPct) r.volRatio = r.atrPct / median(ah);
    const rv = v.slice(Math.max(0, i - 20), i).filter((x) => x);
    if (rv.length && v[i]) r.volumeRatio = v[i] / (rv.reduce((a, b) => a + b, 0) / rv.length);

    if (i + 1 < Math.max(WARMUP_BARS, slow + 1) || r.adx == null) r.state = "WARMING_UP";
    else {
      const strong = r.adx >= 25;
      const up = strong && r.pdi > r.mdi && c[i] > r.emaSlow && r.emaFast > r.emaSlow;
      const down = strong && r.mdi > r.pdi && c[i] < r.emaSlow && r.emaFast < r.emaSlow;
      const volatile = (r.bbwRank != null && r.bbwRank >= 0.8) || (r.volRatio != null && r.volRatio >= 1.5);
      const calm = r.adx < 20 && r.bbwRank != null && r.bbwRank <= 0.35 && (r.volRatio == null || r.volRatio < 1.2);
      r.state = up ? "RISING" : down ? "FALLING" : volatile ? "VOLATILE" : calm ? "STABLE" : "NORMAL";
    }
    rows.push(r);
  }
  // Hysteresis, as in the notifier: a new state counts once seen CONFIRM_RUNS bars in a row.
  let confirmed = null, pending = null, count = 0;
  for (const r of rows) {
    if (r.state === confirmed) { pending = null; count = 0; }
    else {
      if (r.state === pending) count++; else { pending = r.state; count = 1; }
      if (count >= CONFIRM_RUNS || confirmed == null) { confirmed = r.state; pending = null; count = 0; }
    }
    r.confirmed = confirmed; r.pending = pending;
  }
  return rows;
}

/** Picks the timeframe exactly like the notifier does. */
export function analyze(intraday, daily) {
  const useDaily = daily.c.length >= DAILY_SWITCH_BARS;
  const bars = useDaily ? daily : intraday;
  const rows = analyzeSeries(bars, ...(useDaily ? [20, 50] : [9, 21]));
  return { useDaily, bars, rows, timeframe: useDaily ? "daily bars" : "15-minute bars" };
}
