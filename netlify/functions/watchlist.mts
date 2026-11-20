// The shared watchlist, stored in Netlify Blobs so it is the same on every device.
// GET  /api/watchlist                      -> { stocks: [{symbol, name, ipo?}] }  (public; the GitHub notifier reads it)
// POST /api/watchlist {action, symbol}     -> add or remove a stock; needs header X-Edit-Key = env WATCHLIST_EDIT_KEY
import { getStore } from "@netlify/blobs";
import { fetchBars, SYMBOL_RE } from "../lib/yahoo.mts";

type Stock = { symbol: string; name: string; ipo?: number };
const DEFAULT: Stock[] = [
  { symbol: "ANT", name: "Anthropic", ipo: 83 },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "SPCX", name: "SpaceX", ipo: 135 },
];
const MAX_STOCKS = 15;
const KEY = "stocks";

const store = () => getStore({ name: "watchlist", consistency: "strong" });
const noStore = { "Cache-Control": "no-store" };

async function read(): Promise<Stock[]> {
  const list = await store().get(KEY, { type: "json" });
  return Array.isArray(list) && list.length ? list : DEFAULT;
}

function shortName(name: string) {
  return name.replace(/,?\s+(Inc\.?|Corporation|Corp\.?|Incorporated|Holdings?|Ltd\.?|PLC|plc|N\.V\.|S\.A\.|Co\.?|Company|Group)$/i, "").trim() || name;
}

export default async (req: Request) => {
  if (req.method === "GET") return Response.json({ stocks: await read() }, { headers: noStore });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expected = Netlify.env.get("WATCHLIST_EDIT_KEY");
  if (!expected) return Response.json({ error: "Editing is not set up on this site (no WATCHLIST_EDIT_KEY)." }, { status: 503, headers: noStore });
  if (req.headers.get("X-Edit-Key") !== expected) return Response.json({ error: "Wrong edit key." }, { status: 401, headers: noStore });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const symbol = String(body?.symbol ?? "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 });

  let list = await read();
  if (body.action === "add") {
    if (list.some((s) => s.symbol === symbol)) return Response.json({ stocks: list }, { headers: noStore });
    if (list.length >= MAX_STOCKS) return Response.json({ error: `The list is full (${MAX_STOCKS} stocks). Remove one first.` }, { status: 400 });
    let name = symbol;
    try {
      const { meta, bars } = await fetchBars(symbol, "1d", "5d"); // make sure it exists and has prices
      if (!bars.c.length) throw new Error("no prices");
      name = shortName(String(body.name || meta.longName || meta.shortName || symbol)).slice(0, 40);
    } catch {
      return Response.json({ error: `No price data found for ${symbol}.` }, { status: 400 });
    }
    list = [...list, { symbol, name }];
  } else if (body.action === "remove") {
    if (list.length <= 1) return Response.json({ error: "Keep at least one stock on the list." }, { status: 400 });
    list = list.filter((s) => s.symbol !== symbol);
  } else {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  await store().setJSON(KEY, list);
  return Response.json({ stocks: list }, { headers: noStore });
};

export const config = { path: "/api/watchlist" };
