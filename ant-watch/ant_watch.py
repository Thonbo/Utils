#!/usr/bin/env python3
"""ANT Watch - follows a stock (default: Anthropic, Nasdaq: ANT) and classifies it as
RISING, FALLING, STABLE, VOLATILE or NORMAL using widely used technical indicators:

  * ADX(14) with +DI/-DI (Wilder)  -> is there a trend, and which way?
  * EMA fast/slow crossover         -> short-term vs longer-term direction
  * Bollinger Bands(20, 2) width    -> squeeze (calm) vs expansion (wild)
  * ATR(14) as % of price (Wilder)  -> how much it moves per bar vs. usual
  * RSI(14) (Wilder)                -> overheated (>70) / oversold (<30)

Runs on GitHub Actions. State and the dashboard live in one GitHub issue; a comment is
added to that issue (which notifies you) only when something is worth a look.

Python standard library only. Not financial advice.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    ET = timezone.utc

TICKER = os.environ.get("TICKER", "ANT")
IPO_PRICE = float(os.environ.get("IPO_PRICE", "83"))
BIG_MOVE_PCT = float(os.environ.get("BIG_MOVE_PCT", "5"))
CONFIRM_RUNS = 2          # a new state must show up this many checks in a row before alerting
WARMUP_BARS = 30          # fewer bars than this -> not enough data yet
DAILY_SWITCH_BARS = 60    # once this many trading days exist, judge on daily bars
STATE_MARK = "ant-watch-state"
LABEL = "ant-watch"

# --------------------------------------------------------------------------- indicators


def ema(values, n):
    out = [None] * len(values)
    if len(values) < n:
        return out
    k = 2 / (n + 1)
    prev = sum(values[:n]) / n
    out[n - 1] = prev
    for i in range(n, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def sma(values, n):
    out = [None] * len(values)
    for i in range(n - 1, len(values)):
        out[i] = sum(values[i - n + 1:i + 1]) / n
    return out


def bollinger(closes, n=20, k=2.0):
    mid = sma(closes, n)
    upper, lower, width = [None] * len(closes), [None] * len(closes), [None] * len(closes)
    for i in range(n - 1, len(closes)):
        sd = statistics.pstdev(closes[i - n + 1:i + 1])
        upper[i] = mid[i] + k * sd
        lower[i] = mid[i] - k * sd
        width[i] = (upper[i] - lower[i]) / mid[i] if mid[i] else None
    return mid, upper, lower, width


def rsi(closes, n=14):
    out = [None] * len(closes)
    if len(closes) <= n:
        return out
    gains = [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
    losses = [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]
    ag, al = sum(gains[:n]) / n, sum(losses[:n]) / n

    def val(g, l):
        if l == 0:
            return 100.0 if g > 0 else 50.0
        return 100 - 100 / (1 + g / l)

    out[n] = val(ag, al)
    for i in range(n, len(gains)):
        ag = (ag * (n - 1) + gains[i]) / n
        al = (al * (n - 1) + losses[i]) / n
        out[i + 1] = val(ag, al)
    return out


def true_ranges(highs, lows, closes):
    tr = [highs[0] - lows[0]]
    for i in range(1, len(closes)):
        tr.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    return tr


def atr(highs, lows, closes, n=14):
    tr = true_ranges(highs, lows, closes)
    out = [None] * len(tr)
    if len(tr) < n:
        return out
    prev = sum(tr[:n]) / n
    out[n - 1] = prev
    for i in range(n, len(tr)):
        prev = (prev * (n - 1) + tr[i]) / n
        out[i] = prev
    return out


def adx(highs, lows, closes, n=14):
    """Wilder's ADX. Returns (adx, +DI, -DI) series."""
    size = len(closes)
    adx_s, pdi_s, mdi_s = [None] * size, [None] * size, [None] * size
    if size < 2 * n + 1:
        return adx_s, pdi_s, mdi_s
    tr = true_ranges(highs, lows, closes)
    pdm, mdm = [0.0], [0.0]
    for i in range(1, size):
        up, down = highs[i] - highs[i - 1], lows[i - 1] - lows[i]
        pdm.append(up if up > down and up > 0 else 0.0)
        mdm.append(down if down > up and down > 0 else 0.0)
    s_tr, s_p, s_m = sum(tr[1:n + 1]), sum(pdm[1:n + 1]), sum(mdm[1:n + 1])
    dxs = []
    for i in range(n, size):
        if i > n:
            s_tr = s_tr - s_tr / n + tr[i]
            s_p = s_p - s_p / n + pdm[i]
            s_m = s_m - s_m / n + mdm[i]
        pdi = 100 * s_p / s_tr if s_tr else 0.0
        mdi = 100 * s_m / s_tr if s_tr else 0.0
        pdi_s[i], mdi_s[i] = pdi, mdi
        dxs.append(100 * abs(pdi - mdi) / (pdi + mdi) if (pdi + mdi) else 0.0)
        if len(dxs) == n:
            adx_s[i] = sum(dxs) / n
        elif len(dxs) > n:
            adx_s[i] = (adx_s[i - 1] * (n - 1) + dxs[-1]) / n
    return adx_s, pdi_s, mdi_s


def pct_rank(series, value, lookback=100):
    hist = [v for v in series[-lookback:] if v is not None]
    if not hist:
        return None
    return sum(1 for v in hist if v <= value) / len(hist)


# --------------------------------------------------------------------------- classification

STATES = {
    "RISING":   ("📈", "Rising",   "A clear uptrend: trend strength is high and buyers are in control."),
    "FALLING":  ("📉", "Falling",  "A clear downtrend: trend strength is high and sellers are in control."),
    "STABLE":   ("🟢", "Stable",   "Calm and sideways: no real trend and price swings are narrower than usual."),
    "VOLATILE": ("⚡", "Volatile", "Big, choppy swings without a clear direction."),
    "NORMAL":   ("⚪", "Normal",   "Nothing stands out: mild moves, no strong trend, normal swings."),
    "WARMING_UP": ("⏳", "Warming up", "Not enough price history yet to judge reliably."),
}

FOR_YOU = {
    "RISING":   "If you plan to buy, waiting longer may mean paying more. Check whether RSI is overheated (>70) before chasing.",
    "FALLING":  "Usually best to wait. Many people wait for a downtrend to flatten out (turn Stable) before buying.",
    "STABLE":   "This is the calm you've been waiting for. A Stable period that breaks upward is the classic 'buy before it runs' moment.",
    "VOLATILE": "Usually best to wait - prices can swing a lot within hours.",
    "NORMAL":   "No action signal. Keep waiting for Stable.",
    "WARMING_UP": "Hang tight - the tracker needs a few more hours of trading data.",
}


def analyze(bars, fast=9, slow=21):
    """bars: dict of lists t/o/h/l/c/v. Returns a dict with the candidate state and indicator values."""
    c, h, l, v = bars["c"], bars["h"], bars["l"], bars["v"]
    n = len(c)
    res = {"bars": n, "close": c[-1] if c else None, "fast_n": fast, "slow_n": slow}
    if n < max(WARMUP_BARS, slow + 1):
        res["state"] = "WARMING_UP"
        return res

    adx_s, pdi_s, mdi_s = adx(h, l, c)
    ef, es = ema(c, fast), ema(c, slow)
    _, bb_up, bb_lo, bbw = bollinger(c)
    atr_s = atr(h, l, c)
    atr_pct = [a / c[i] if a is not None and c[i] else None for i, a in enumerate(atr_s)]
    rsi_s = rsi(c)

    res.update(
        adx=adx_s[-1], pdi=pdi_s[-1], mdi=mdi_s[-1], ema_fast=ef[-1], ema_slow=es[-1],
        bb_upper=bb_up[-1], bb_lower=bb_lo[-1], bbw=bbw[-1], atr_pct=atr_pct[-1], rsi=rsi_s[-1],
    )
    res["bbw_rank"] = pct_rank(bbw, bbw[-1]) if bbw[-1] is not None else None
    hist_atr = [x for x in atr_pct[-100:] if x is not None]
    res["vol_ratio"] = atr_pct[-1] / statistics.median(hist_atr) if hist_atr and atr_pct[-1] else None
    recent_v = [x for x in v[-21:-1] if x]
    res["volume_ratio"] = v[-1] / (sum(recent_v) / len(recent_v)) if recent_v and v[-1] else None

    if res["adx"] is None:
        res["state"] = "WARMING_UP"
        return res

    price = c[-1]
    strong = res["adx"] >= 25
    up = strong and res["pdi"] > res["mdi"] and price > es[-1] and ef[-1] > es[-1]
    down = strong and res["mdi"] > res["pdi"] and price < es[-1] and ef[-1] < es[-1]
    volatile = (res["bbw_rank"] is not None and res["bbw_rank"] >= 0.8) or \
               (res["vol_ratio"] is not None and res["vol_ratio"] >= 1.5)
    calm = res["adx"] < 20 and res["bbw_rank"] is not None and res["bbw_rank"] <= 0.35 and \
        (res["vol_ratio"] is None or res["vol_ratio"] < 1.2)

    if up:
        state = "RISING"
    elif down:
        state = "FALLING"
    elif volatile:
        state = "VOLATILE"
    elif calm:
        state = "STABLE"
    else:
        state = "NORMAL"
    res["state"] = state
    res["volatile_flag"] = volatile
    return res


# --------------------------------------------------------------------------- alerts / state machine

ALERT_TEXT = {
    "STABLE": "🟢 **Look now: {t} has settled down (Stable).** This is the calm you said you're waiting for.",
    "RISING": "📈 **{t} is now in an uptrend (Rising).** If you're planning to buy, prices may run from here.",
    "FALLING": "📉 **{t} has turned into a downtrend (Falling).** Usually a time to wait.",
    "VOLATILE": "⚡ **{t} has turned volatile.** Big swings, no clear direction - usually a time to wait.",
}


def step(prev: dict, res: dict, day_change, today: str):
    """Advance the stored state with a new analysis. Returns (new_state, alerts[list of str])."""
    s = dict(prev or {})
    s.setdefault("confirmed", None)
    alerts = []
    cand = res["state"]

    # --- hysteresis: only accept a new state after it is seen CONFIRM_RUNS times in a row
    if cand == s["confirmed"]:
        s["pending"], s["pending_count"] = None, 0
    else:
        if cand == s.get("pending"):
            s["pending_count"] = s.get("pending_count", 0) + 1
        else:
            s["pending"], s["pending_count"] = cand, 1
        if s["pending_count"] >= CONFIRM_RUNS or s["confirmed"] is None:
            old = s["confirmed"]
            s["confirmed"], s["pending"], s["pending_count"] = cand, None, 0
            s["since"] = res.get("time")
            if old is not None and cand in ALERT_TEXT and cand != "WARMING_UP":
                msg = ALERT_TEXT[cand].format(t=TICKER)
                if old == "STABLE" and cand == "RISING":
                    msg = (f"🚀 **{TICKER} is breaking out of a calm period (Stable → Rising).** "
                           "Rises out of a quiet stretch are the classic 'buy before it runs' moment.")
                    if res.get("volume_ratio") and res["volume_ratio"] >= 1.5:
                        msg += f" Volume is {res['volume_ratio']:.1f}× normal, which backs it up."
                alerts.append(msg + f" _(was: {STATES[old][1]})_")

    # --- RSI zone crossings (overheated / oversold)
    r = res.get("rsi")
    if r is not None:
        zone = "hot" if r >= 70 else "cold" if r <= 30 else "mid"
        if zone != s.get("rsi_zone") and s.get("rsi_zone") is not None:
            if zone == "hot":
                alerts.append(f"🔥 **{TICKER} looks overheated (RSI {r:.0f} > 70).** Prices often cool off after this - "
                              "chasing here is risky.")
            elif zone == "cold":
                alerts.append(f"🧊 **{TICKER} looks oversold (RSI {r:.0f} < 30).** Selling may be overdone - "
                              "worth a look if it starts to stabilize.")
        s["rsi_zone"] = zone

    # --- big daily moves, max one alert per direction per day
    if day_change is not None:
        moves = s.get("moves") or {}
        if moves.get("date") != today:
            moves = {"date": today}
        if day_change >= BIG_MOVE_PCT and not moves.get("up"):
            moves["up"] = True
            alerts.append(f"🚨 **{TICKER} is up {day_change:+.1f}% today.**")
        if day_change <= -BIG_MOVE_PCT and not moves.get("down"):
            moves["down"] = True
            alerts.append(f"🚨 **{TICKER} is down {day_change:+.1f}% today.**")
        s["moves"] = moves
    return s, alerts


# --------------------------------------------------------------------------- data


def fetch_bars(ticker, interval, rng):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}"
           f"?interval={interval}&range={rng}&includePrePost=false")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (ant-watch)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return parse_chart(json.load(r))


def parse_chart(payload):
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        raise ValueError(f"no chart data: {(payload.get('chart') or {}).get('error')}")
    res = result[0]
    q = (res.get("indicators") or {}).get("quote", [{}])[0]
    bars = {k: [] for k in "tohlcv"}
    for i, t in enumerate(res.get("timestamp") or []):
        o, h, l, c = (q.get(k, [None])[i] for k in ("open", "high", "low", "close"))
        if None in (o, h, l, c):
            continue
        bars["t"].append(t)
        bars["o"].append(o)
        bars["h"].append(h)
        bars["l"].append(l)
        bars["c"].append(c)
        bars["v"].append((q.get("volume") or [0] * (i + 1))[i] or 0)
    bars["meta"] = res.get("meta") or {}
    return bars


# --------------------------------------------------------------------------- dashboard


def fmt(x, spec=".2f", none="–"):
    return none if x is None else format(x, spec)


def readings(res):
    rows = []
    a = res.get("adx")
    if a is not None:
        word = "strong trend" if a >= 25 else "weak / no trend" if a < 20 else "trend forming"
        rows.append(("Trend strength (ADX 14)", fmt(a, ".1f"), f"{word} (<20 none, >25 strong)"))
        lead = "buyers ahead" if res["pdi"] > res["mdi"] else "sellers ahead"
        rows.append(("Direction (+DI / −DI)", f"{res['pdi']:.1f} / {res['mdi']:.1f}", lead))
    if res.get("ema_slow") is not None:
        rel = "short-term above longer-term ↑" if res["ema_fast"] > res["ema_slow"] else "short-term below longer-term ↓"
        rows.append((f"Moving averages (EMA {res['fast_n']} / {res['slow_n']})",
                     f"${res['ema_fast']:.2f} / ${res['ema_slow']:.2f}", rel))
    if res.get("bbw") is not None:
        rk = res.get("bbw_rank")
        word = "narrow (squeeze)" if rk is not None and rk <= 0.35 else "wide" if rk is not None and rk >= 0.8 else "average"
        rows.append(("Bollinger Band width (20, 2)", f"{res['bbw'] * 100:.1f}%",
                     f"{word} – narrower than {100 - rk * 100:.0f}% of recent history" if rk is not None else word))
    if res.get("atr_pct") is not None:
        vr = res.get("vol_ratio")
        rows.append(("Typical move per bar (ATR 14)", f"{res['atr_pct'] * 100:.2f}%",
                     f"{vr:.1f}× its usual" if vr else ""))
    if res.get("rsi") is not None:
        r = res["rsi"]
        word = "overheated" if r >= 70 else "oversold" if r <= 30 else "neutral"
        rows.append(("Momentum (RSI 14)", f"{r:.0f}", f"{word} (>70 hot, <30 cold)"))
    if res.get("volume_ratio") is not None:
        rows.append(("Volume vs 20-bar average", f"{res['volume_ratio']:.1f}×", ""))
    return rows


def render(state, res, quote, alerts_log, owner):
    key = state.get("confirmed") or res["state"]
    emoji, name, meaning = STATES[key]
    lines = [f"## {emoji} {TICKER} is **{name}**", ""]
    price = quote.get("price")
    bits = [f"**${price:.2f}**"] if price else []
    if quote.get("day_change") is not None:
        bits.append(f"{quote['day_change']:+.1f}% today")
    if price and IPO_PRICE:
        bits.append(f"{(price / IPO_PRICE - 1) * 100:+.1f}% vs IPO price ${IPO_PRICE:g}")
    lines.append(" · ".join(bits))
    lines.append(f"<sub>Updated {datetime.now(ET).strftime('%a %b %d, %H:%M ET')} · judged on "
                 f"{res['timeframe']} ({res['bars']} bars)"
                 + (f" · {name} since {state['since']}" if state.get("since") else "") + "</sub>")
    lines += ["", f"**What it means:** {meaning}", "", f"**For you (waiting to buy):** {FOR_YOU[key]}"]
    if state.get("pending") and state["pending"] != key:
        lines += ["", f"_Possibly changing to **{STATES[state['pending']][1]}** – waiting for one more check to confirm._"]
    rows = readings(res)
    if rows:
        lines += ["", "| Signal | Value | Reading |", "|---|---|---|"]
        lines += [f"| {a} | {b} | {c} |" for a, b, c in rows]
    if alerts_log:
        lines += ["", "**Recent alerts**", ""] + [f"- {a}" for a in alerts_log[-5:]]
    lines += ["", "<details><summary>How the states are decided</summary>", "",
              "- **Rising** – ADX ≥ 25, +DI above −DI, price above the slow EMA and fast EMA above slow EMA.",
              "- **Falling** – the mirror image of Rising.",
              "- **Volatile** – no clear trend, and Bollinger width in the top 20% of recent history or ATR ≥ 1.5× usual.",
              "- **Stable** – ADX < 20, Bollinger width in the bottom 35% of recent history, ATR not elevated.",
              "- **Normal** – everything else.",
              "- A new state must show up on **2 checks in a row** before you're notified (avoids flip-flopping).",
              "- Extra alerts: RSI crossing 70/30, and moves of ±"
              f"{BIG_MOVE_PCT:g}% in a day.",
              "- Uses 15-minute bars while the stock is new; switches to daily bars after "
              f"{DAILY_SWITCH_BARS} trading days.",
              "", "</details>", "",
              f"<sub>Checks every 15 min during US market hours. You get a notification when a comment is added to this "
              f"issue{f' (cc @{owner})' if owner else ''}. Technical indicators describe the past, not the future – "
              "this is not financial advice.</sub>"]
    lines += ["", f"<!-- {STATE_MARK}: {json.dumps(state, separators=(',', ':'))} -->"]
    return "\n".join(lines)


def load_state(body):
    m = re.search(rf"<!-- {STATE_MARK}: (\{{.*?\}}) -->", body or "", re.S)
    return json.loads(m.group(1)) if m else {}


# --------------------------------------------------------------------------- GitHub


class GitHub:
    def __init__(self, repo, token):
        self.repo, self.token = repo, token

    def call(self, method, path, data=None):
        req = urllib.request.Request(
            f"https://api.github.com/repos/{self.repo}{path}", method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ant-watch"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)

    def find_issue(self):
        for it in self.call("GET", f"/issues?state=open&labels={LABEL}&per_page=10"):
            if "pull_request" not in it:
                return it
        return None


# --------------------------------------------------------------------------- main


def run(intraday, daily, prev_state):
    use_daily = len(daily["c"]) >= DAILY_SWITCH_BARS
    bars = daily if use_daily else intraday
    res = analyze(bars, *((20, 50) if use_daily else (9, 21)))
    res["timeframe"] = "daily bars" if use_daily else "15-minute bars"
    last_t = bars["t"][-1]
    res["time"] = datetime.fromtimestamp(last_t, ET).strftime("%b %d %H:%M ET")

    meta = intraday.get("meta") or {}
    price = meta.get("regularMarketPrice") or intraday["c"][-1]
    prev_close = daily["c"][-2] if len(daily["c"]) >= 2 else None  # None on the first trading day
    day_change = (price / prev_close - 1) * 100 if prev_close else None
    quote = {"price": price, "day_change": day_change}

    fingerprint = f"{last_t}:{round(bars['c'][-1], 4)}"
    if prev_state.get("fingerprint") == fingerprint:
        return None  # market closed / no new data – nothing to do
    today = datetime.fromtimestamp(last_t, ET).strftime("%Y-%m-%d")
    state, alerts = step(prev_state, res, day_change, today)
    state["fingerprint"] = fingerprint
    return state, alerts, res, quote


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print the dashboard instead of updating GitHub")
    ap.add_argument("--state-file", help="(dry-run) JSON file used to keep state between local runs")
    args = ap.parse_args()

    try:
        intraday = fetch_bars(TICKER, "15m", "60d")
        daily = fetch_bars(TICKER, "1d", "2y")
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(f"Could not fetch price data, will try again next run: {e}")
        return 0

    owner = os.environ.get("GITHUB_REPOSITORY_OWNER", "")
    gh, issue = None, None
    if args.dry_run:
        prev = json.load(open(args.state_file)) if args.state_file and os.path.exists(args.state_file) else {}
    else:
        gh = GitHub(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"])
        issue = gh.find_issue()
        prev = load_state(issue["body"]) if issue else {}

    out = run(intraday, daily, prev)
    if out is None:
        print("No new price data since last check (market closed?). Nothing to do.")
        return 0
    state, alerts, res, quote = out
    stamp = datetime.now(ET).strftime("%b %d %H:%M")
    state["log"] = (state.get("log") or []) + [f"{stamp} – {a}" for a in alerts]
    state["log"] = state["log"][-5:]
    body = render(state, res, quote, state["log"], owner)
    print(f"{TICKER}: candidate={res['state']} confirmed={state['confirmed']} alerts={len(alerts)}")

    if args.dry_run:
        print("\n" + body)
        for a in alerts:
            print("ALERT:", a)
        if args.state_file:
            json.dump(state, open(args.state_file, "w"))
        return 0

    title = f"📊 {TICKER} Watch – live status"
    if issue is None:
        issue = gh.call("POST", "/issues", {"title": title, "body": body, "labels": [LABEL]})
        print(f"Created dashboard issue #{issue['number']}")
    else:
        gh.call("PATCH", f"/issues/{issue['number']}", {"body": body})
    if alerts:
        price = f" (${quote['price']:.2f})" if quote.get("price") else ""
        text = "\n\n".join(alerts) + f"\n\nCurrent price{price}. Full status is in the issue description above."
        if owner:
            text += f"\n\n@{owner}"
        gh.call("POST", f"/issues/{issue['number']}/comments", {"body": text})
        print(f"Posted {len(alerts)} alert(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
