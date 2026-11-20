// Fetches price bars from Yahoo Finance on the server (browsers are blocked by CORS)
// and returns a compact JSON payload for the ANT Watch page.
// Only these symbols can be requested (keep in sync with WATCHLIST in ant-watch/web/app.js).
const ALLOWED = new Set(["ANT", "NVDA", "SPCX"]);
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

type Bars = { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };

async function fetchBars(symbol: string, interval: string, range: string) {
  let lastErr: unknown;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${symbol}?interval=${interval}&range=${range}&includePrePost=false`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (ant-watch)" } });
      if (!res.ok) throw new Error(`${host} answered ${res.status}`);
      const json: any = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) throw new Error(json?.chart?.error?.description ?? "no chart data");
      const q = r.indicators?.quote?.[0] ?? {};
      const bars: Bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
      (r.timestamp ?? []).forEach((t: number, i: number) => {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if ([o, h, l, c].some((x) => x == null)) return;
        bars.t.push(t); bars.o.push(o); bars.h.push(h); bars.l.push(l); bars.c.push(c); bars.v.push(q.volume?.[i] ?? 0);
      });
      return { meta: r.meta ?? {}, bars };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export default async (req: Request) => {
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "ANT").toUpperCase();
  if (!ALLOWED.has(symbol)) return Response.json({ error: `Unknown symbol ${symbol}` }, { status: 400 });
  try {
    const [intra, daily] = await Promise.all([fetchBars(symbol, "15m", "60d"), fetchBars(symbol, "1d", "2y")]);
    const m = intra.meta;
    return Response.json(
      {
        ticker: symbol,
        price: m.regularMarketPrice ?? intra.bars.c.at(-1),
        marketTime: m.regularMarketTime ?? intra.bars.t.at(-1),
        intraday: intra.bars,
        daily: daily.bars,
        fetchedAt: Date.now(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60",
          "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (e) {
    return Response.json({ error: `Price data unavailable: ${(e as Error).message}` }, { status: 502 });
  }
};

export const config = { path: "/api/chart" };
