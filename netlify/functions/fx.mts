// Exchange rate for the currency setting: /api/fx?from=USD&to=DKK -> { rate }
import { fetchBars } from "../lib/yahoo.mts";

const CODE = /^[A-Z]{3}$/;

export default async (req: Request) => {
  const u = new URL(req.url);
  const from = (u.searchParams.get("from") ?? "").toUpperCase(), to = (u.searchParams.get("to") ?? "").toUpperCase();
  if (!CODE.test(from) || !CODE.test(to)) return Response.json({ error: "Use 3-letter currency codes" }, { status: 400 });
  if (from === to) return Response.json({ from, to, rate: 1 });
  try {
    const { meta, bars } = await fetchBars(`${from}${to}=X`, "1d", "5d");
    const rate = meta.regularMarketPrice ?? bars.c.at(-1);
    if (!rate) throw new Error("no rate");
    return Response.json({ from, to, rate, at: meta.regularMarketTime ?? null },
      { headers: { "Cache-Control": "public, max-age=900", "Netlify-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } });
  } catch (e) {
    return Response.json({ error: `Exchange rate unavailable: ${(e as Error).message}` }, { status: 502 });
  }
};

export const config = { path: "/api/fx" };
