# Stockwise (started as ANT Watch)

Tracks a watchlist of stocks (to start with **Anthropic (ANT)**, **NVIDIA (NVDA)** and **SpaceX (SPCX)**) and tells you when one of them is worth a look. You can add more stocks from the website.

## How you use it

**Live page:** https://stockwise-watch.netlify.app shows every stock on your list. Tap one to see its current state, a price chart with the state history, and every signal. It refreshes every minute while it's open.

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
- `netlify/functions/` holds the server code: `chart.mts` (prices), `search.mts` (stock search) and `watchlist.mts` (the saved list). They fetch from Yahoo on the server, because Yahoo blocks requests made straight from a browser. Shared code is in `netlify/lib/yahoo.mts`.
- The Netlify project is called `stockwise-watch`.

## Adding or removing a stock

On the website, tap **+ Add stock**, search by company name or ticker and tap a result. To remove the stock you're viewing, tap **Remove … from my list** under its price.

Changing the list needs your **edit key**. You enter it once on each device. The key is stored on Netlify as the secret environment variable `WATCHLIST_EDIT_KEY` (project `stockwise-watch`, production context); change it there if you lose it or want a new one, then redeploy. Anyone can view the page, but only someone with the key can change the list.

The list is saved on Netlify (`/api/watchlist`, in Netlify Blobs), so it's the same on every device. The GitHub notifier reads the same list, so added stocks get alerts too. If the website can't be reached, the notifier uses the fallback `WATCHLIST` in `.github/workflows/ant-watch.yml`. You can have up to 15 stocks.

## Time ranges

Every stock has the same buttons: **1D · 5D · 1M** use 15‑minute bars, and **3M · 6M · 1Y · 5Y** use daily bars. A button is greyed out when the stock doesn't have more history to show, for example 1Y for a stock that listed last month. The coloured strip under the chart always shows the stock's official state, the same one the notifications use.

To run a check by hand, go to **Actions → Stockwise → Run workflow**.

_Indicators describe the past, not the future. This is not financial advice._
