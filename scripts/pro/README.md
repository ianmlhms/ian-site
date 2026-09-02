# Client preview generator

1. Copy `data/pro/demo-bistro.json` to `data/pro/<business-slug>.json` and replace the invented content. Keep every visible sentence in a language object (`fr`, `de`, `en`).
2. Put the business's approved images in `pro/<business-slug>/img/`, then reference them with relative paths such as `img/hero.webp`. Do not use `..` or absolute paths.
3. Run `python3 scripts/pro/build.py`. It validates every JSON file and writes the default page at `pro/<slug>/index.html`, with the other languages beneath `de/` and `en/`.
4. Run `python3 scripts/check_site.py`, open the generated preview at `/pro/<slug>/`, and confirm the information with the business before making anything public.

The generator writes `noindex,follow` to every preview and never adds previews to a sitemap. The `sections` array determines both content order and which sections exist.
