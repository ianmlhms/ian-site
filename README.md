# ian-site

The personal website of Ian Mulheims — a simple static site (HTML + CSS + a little JS).

## How it's published

```
edit files locally  →  git push  →  GitHub
                                      ├─ GitHub Pages (preview)
                                      └─ EuroDNS / Plesk (live domain, once connected)
```

To make a change, edit the files and push:

```sh
git add -A
git commit -m "describe the change"
git push
```

The site updates automatically wherever it's connected.

## Files

| File         | Purpose                          |
| ------------ | -------------------------------- |
| `index.html` | Page structure and content       |
| `style.css`  | Styling                          |
| `main.js`    | Small bits of interactivity      |
| `assets/`    | Images and other static assets   |
