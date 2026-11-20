# Stock Watch (started as ANT Watch)

Tracks **Anthropic (ANT)**, **NVIDIA (NVDA)** and **SpaceX (SPCX)** and tells you when one of them is worth a look.

## How you use it

**Live page:** https://ant-watch-live.netlify.app shows all three stocks. Tap one to see its current state, a price chart with the state history, and every signal. It refreshes every minute while it's open.

**Notifications:** each stock has its own issue in the **Issues** tab of this repo, for example **📊 NVIDIA (NVDA) – live status**. The issues update every 15 minutes while the US market is open. When something important happens, a comment is added to that stock's issue, and GitHub emails you or sends a push notification if you have the GitHub mobile app.

You get a notification when:

| Alert | Meaning |
|---|---|
| 🟢 Stable | The stock has calmed down. This is what you're waiting for. |
| 🚀 Stable → Rising | It's breaking out of a calm period. This is the classic "buy before it runs" moment. |
| 📈 Rising / 📉 Falling | A clear trend has started. |
| ⚡ Volatile | Big swings with no clear direction. |
| 🔥 / 🧊 RSI | Overheated (above 70) or oversold (below 30). |
| 🚨 Big move | Up or down 5% or more in a day. |

A state change has to show up on 2 checks in a row before you're notified, so you don't get pinged every time the price wobbles.

## The method

It uses standard, widely used indicators: Wilder's **ADX** and **+DI/−DI** for trend, **EMA** crossovers (9/21 on 15‑minute bars, 20/50 on daily bars), **Bollinger Bands (20, 2)** for squeezes, **ATR (14)** for volatility and **RSI (14)** for momentum. The dashboards explain the exact rules.

A stock with fewer than 60 trading days of history is judged on 15‑minute bars, otherwise on daily bars. ANT listed on 19 Nov 2026, so it starts on 15‑minute bars. NVIDIA and SpaceX already have enough history for daily bars, so their states change more slowly.

## How it's built

- `ant_watch.py` is the notifier. It runs on GitHub Actions and updates one issue per stock.
- `web/` is the Netlify page. `web/analysis.js` is a JavaScript copy of the same rules; keep the two in sync.
- `netlify/functions/chart.mts` fetches prices for the page on the server, because Yahoo blocks requests made straight from a browser.
- The Netlify project is called `ant-watch-live`.

## Adding or removing a stock

Change the list in these three places:
1. `WATCHLIST` in `.github/workflows/ant-watch.yml`, in the form `SYMBOL:Name:IPO price` (the IPO price is optional)
2. `WATCHLIST` in `web/app.js`
3. `ALLOWED` in `netlify/functions/chart.mts`

To run a check by hand, go to **Actions → Stock Watch → Run workflow**.

_Indicators describe the past, not the future. This is not financial advice._
