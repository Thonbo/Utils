// Price bars for one stock: /api/chart?symbol=NVDA
// Fetched on the server because Yahoo blocks requests made straight from a browser.
import { fetchBars, SYMBOL_RE } from "../lib/yahoo.mts";

export default async (req: Request) => {
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 });
  try {
    const [intra, daily] = await Promise.all([fetchBars(symbol, "15m", "60d"), fetchBars(symbol, "1d", "5y")]);
    const m = intra.meta;
    return Response.json(
      {
        ticker: symbol,
        name: m.longName ?? m.shortName ?? symbol,
        currency: m.currency ?? "USD",
        price: m.regularMarketPrice ?? intra.bars.c.at(-1),
        marketTime: m.regularMarketTime ?? intra.bars.t.at(-1),
        intraday: intra.bars,
        daily: daily.bars,
        fetchedAt: Date.now(),
      },
      { headers: { "Cache-Control": "public, max-age=60", "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (e) {
    return Response.json({ error: `Price data unavailable: ${(e as Error).message}` }, { status: 502 });
  }
};

export const config = { path: "/api/chart" };
