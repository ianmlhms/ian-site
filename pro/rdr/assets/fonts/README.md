# Font assets

Self-hosted variable fonts, both SIL Open Font License 1.1:

| File | Family | Axes | Subset |
|---|---|---|---|
| `Fraunces-latin.woff2` | Fraunces | `opsz`, `wght` 100–900 | Latin (U+0000–00FF, Œ/œ) |
| `Fraunces-latin-ext.woff2` | Fraunces | same | Latin Extended |
| `SourceSans3-latin.woff2` | Source Sans 3 | `wght` 200–900 | Latin |
| `SourceSans3-latin-ext.woff2` | Source Sans 3 | same | Latin Extended |

Fetched from Google Fonts (`fonts.gstatic.com`) and committed, so the site has no
runtime dependency on Google. `site.css` declares each with its `unicode-range`,
so a browser only downloads the extended subset when a page actually needs it.

The Latin subset must stay: French copy on this site uses `œ` ("en plein cœur de
Schifflange") and the catalogue carries `ü`, `ö`, `é`, `è`, `à`, `ç`.
