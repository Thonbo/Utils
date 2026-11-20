# Project rules

- **Icons: always use Lucide icons** (https://lucide.dev). Never draw or invent custom icons, and don't use text glyphs (▲ ▼ ✓ etc.) as icons. Copy the exact SVG from the `lucide-static` package and note the icon name in a comment.
- The owner is not a developer: keep explanations short and plain.

## Stockwise (`ant-watch/`)

- See `ant-watch/README.md`. The rules in `ant-watch/ant_watch.py` and `ant-watch/web/analysis.js` must stay identical.
- The website is the Netlify project `stockwise-watch`; server code is in `netlify/functions/` and `netlify/lib/`.
