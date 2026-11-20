// Stock search for the "Add stock" box: /api/search?q=tesla
import { search } from "../lib/yahoo.mts";

export default async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!q) return Response.json({ results: [] });
  try {
    return Response.json({ results: await search(q) }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    return Response.json({ error: `Search unavailable: ${(e as Error).message}` }, { status: 502 });
  }
};

export const config = { path: "/api/search" };
