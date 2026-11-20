# ANT Watch

Tracks Anthropic stock (Nasdaq: **ANT**) and tells you when it's worth a look.

## How you use it

1. Open the **Issues** tab of this repo and find **📊 ANT Watch – live status**. That issue is your dashboard. It updates every 15 minutes while the US market is open.
2. When something important happens, a comment is added to that issue. GitHub then emails you, or sends a push notification if you have the GitHub mobile app.

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

It uses standard, widely used indicators: Wilder's **ADX** and **+DI/−DI** for trend, **EMA** crossovers (9/21, then 20/50 on daily bars), **Bollinger Bands (20, 2)** for squeezes, **ATR (14)** for volatility and **RSI (14)** for momentum. The dashboard explains the exact rules. ANT only listed on 19 Nov 2026, so it uses 15‑minute bars at first and switches to daily bars after 60 trading days.

## Settings

Edit `.github/workflows/ant-watch.yml` to change `TICKER` or `IPO_PRICE`. To run a check by hand, go to **Actions → ANT Watch → Run workflow**.

_Indicators describe the past, not the future. This is not financial advice._
