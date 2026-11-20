// Shared Yahoo Finance helpers for the Stockwise functions.
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const UA = { "User-Agent": "Mozilla/5.0 (stock-watch)" };

export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/;

export type Bars = { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };

async function yahoo(path: string): Promise<any> {
  let lastErr: unknown;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`https://${host}${path}`, { headers: UA });
      if (!res.ok) throw new Error(`${host} answered ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function fetchBars(symbol: string, interval: string, range: string) {
  const json = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`);
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
}

export async function search(q: string) {
  const json = await yahoo(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`);
  return (json?.quotes ?? [])
    .filter((x: any) => (x.quoteType === "EQUITY" || x.quoteType === "ETF") && x.symbol && SYMBOL_RE.test(x.symbol))
    .map((x: any) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp ?? "", type: x.typeDisp ?? "" }));
}
