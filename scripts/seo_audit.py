#!/usr/bin/env python3
"""SEO audit of ian.lu: every sitemap URL plus every internal page they link to.

Two sources, same checks:

  --live            fetch https://ian.lu politely (default 1 request per 1.2 s,
                    a normal browser UA, backs off when Imunify360 answers with
                    its "One moment, please" challenge page)
  (default) local   read the working tree as the server would serve it: a path
                    ending in / is its index.html, the Redirect lines of every
                    .htaccess are applied, everything else is a 404

Per URL: the redirect chain and final status, canonical (absolute, self),
robots meta, the hreflang cluster (reciprocal, every target 200 and
self-canonical, x-default valid), title / description length and uniqueness,
h1, words of main text, the closest near-duplicate page (5-word shingles),
internal links in and out (orphans, links that redirect or 404), JSON-LD
validity, html lang vs. the language the text is written in. Also probes the
duplicate URL forms (http, www, index.html, missing .html, trailing slash).

    python3 scripts/seo_audit.py --out ~/Library/Caches/seo-audit/local
    python3 scripts/seo_audit.py --live --out ~/Library/Caches/seo-audit/live

Writes <out>/audit.csv (one row per URL) and <out>/summary.txt.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "https://ian.lu"
SITEMAPS = ("sitemap.xml",)  # followed recursively: an index lists the others
LEGACY_SITEMAPS = ("sitemap-trails.xml", "sitemap-mtb.xml")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/18.0 Safari/605.1.15")
TITLE_RANGE = (25, 65)
DESC_RANGE = (70, 165)
THIN_WORDS = 250
NEAR_DUP = 0.5
SHINGLE = 5
NOT_DEPLOYED = ("scripts/", "supabase/", "cloudflare/", ".git/", ".github/", "data/")
STOPWORDS = {
    "de": {"und", "ist", "die", "mit", "nicht", "eine", "sich", "auf", "von", "man", "wird", "werden"},
    "fr": {"et", "est", "les", "une", "des", "pour", "dans", "sur", "le", "la", "du", "au"},
    "en": {"the", "and", "is", "with", "you", "of", "to", "on", "this", "from", "at", "are"},
    "lb": {"ass", "mat", "dës", "een", "vum", "net", "geet", "ënnerwee", "laanscht", "iwwer", "vun", "dem"},
}


# --- fetching -----------------------------------------------------------------

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class LiveFetcher:
    def __init__(self, delay: float):
        self.delay = delay
        self.opener = urllib.request.build_opener(NoRedirect)
        self.last = 0.0
        self.count = 0

    def fetch(self, url: str, head: bool = False) -> tuple:
        for attempt in range(6):
            wait = self.delay - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.count += 1
            req = urllib.request.Request(url, method="HEAD" if head else "GET", headers={
                "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                "Accept-Language": "de,en;q=0.8"})
            try:
                with self.opener.open(req, timeout=30) as resp:
                    status, headers = resp.status, dict(resp.headers)
                    body = b"" if head else resp.read()
            except urllib.error.HTTPError as err:
                status, headers = err.code, dict(err.headers or {})
                body = b"" if head else (err.read() or b"")
            except Exception as err:  # network trouble: retry, then report it
                print(f"  ! {url}: {err}", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
                continue
            text = body.decode("utf-8", "replace")
            if "One moment, please" in text[:3000] or status == 429:
                pause = 60 * (attempt + 1)
                print(f"  … challenge page on {url}, pausing {pause} s", file=sys.stderr)
                time.sleep(pause)
                continue
            return status, {k.lower(): v for k, v in headers.items()}, text
        return 0, {}, ""


class LocalFetcher:
    """Serve the working tree the way Plesk does (incl. .htaccess Redirects)."""

    def __init__(self):
        self.count = 0
        self.redirects = []  # (kind, pattern, target)
        for root, dirs, files in os.walk(REPO):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "scripts", "data")]
            if ".htaccess" in files:
                with open(os.path.join(root, ".htaccess"), encoding="utf-8") as f:
                    for line in f:
                        parts = line.split()
                        if len(parts) >= 4 and parts[0] == "Redirect":
                            self.redirects.append(("exact", parts[2], parts[3], int(parts[1])))
                        elif len(parts) >= 4 and parts[0] == "RedirectMatch":
                            self.redirects.append(("regex", parts[2], parts[3], int(parts[1])))

    def fetch(self, url: str, head: bool = False) -> tuple:
        self.count += 1
        parts = urlsplit(url)
        if parts.scheme == "http":
            return 301, {"location": urlunsplit(("https",) + tuple(parts[1:]))}, ""
        if parts.netloc != "ian.lu":
            return 0, {}, ""
        path = parts.path or "/"
        for kind, pattern, target, code in self.redirects:
            if (kind == "exact" and path == pattern) or (kind == "regex" and re.match(pattern, path)):
                return code, {"location": urljoin(ORIGIN, target)}, ""
        rel = path.lstrip("/")
        if any(rel.startswith(p) for p in NOT_DEPLOYED):
            return 404, {}, ""
        fs = os.path.join(REPO, rel)
        if path.endswith("/"):
            fs = os.path.join(fs, "index.html")
        elif os.path.isdir(fs):
            return 301, {"location": urljoin(ORIGIN, path + "/")}, ""
        if not os.path.isfile(fs):
            return 404, {}, ""
        if head or not fs.endswith((".html", ".xml", ".txt")):
            return 200, {"content-type": "application/octet-stream"}, ""
        with open(fs, encoding="utf-8", errors="replace") as f:
            ctype = "text/html" if fs.endswith(".html") else "text/xml"
            return 200, {"content-type": ctype}, f.read()


def follow(fetcher, url: str, head: bool = False) -> tuple:
    """(chain [(url, status)], final status, headers, body)."""
    chain = []
    current = url
    for _ in range(10):
        status, headers, body = fetcher.fetch(current, head)
        chain.append((current, status))
        if status in (301, 302, 303, 307, 308) and headers.get("location"):
            current = urljoin(current, headers["location"])
            continue
        return chain, status, headers, body
    return chain, -1, {}, ""


# --- parsing ------------------------------------------------------------------

class PageParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "template"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.title = ""
        self.meta = {}
        self.canonical = []
        self.alternates = []
        self.h1 = []
        self.links = []
        self.jsonld = []
        self.imgs = []
        self._stack = []
        self._in_title = self._in_h1 = self._in_jsonld = False
        self._main_depth = 0
        self._skip_depth = 0
        self._nav_depth = 0
        self.main_text = []
        self.body_text = []
        self._buf = ""
        self.has_main = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "html":
            self.lang = a.get("lang", "")
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key:
                self.meta[key] = a.get("content", "")
        elif tag == "link":
            rel = a.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonical.append(a.get("href", ""))
            if "alternate" in rel and a.get("hreflang"):
                self.alternates.append((a["hreflang"], a.get("href", "")))
        elif tag == "h1":
            self._in_h1 = True
            self.h1.append("")
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "img":
            self.imgs.append(a)
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_jsonld = True
            self._buf = ""
        if tag == "main":
            self._main_depth += 1
            self.has_main = True
        if tag in self.SKIP:
            self._skip_depth += 1
        if tag == "nav":
            self._nav_depth += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "h1":
            self._in_h1 = False
        elif tag == "script" and self._in_jsonld:
            self.jsonld.append(self._buf)
            self._in_jsonld = False
        if tag == "main" and self._main_depth:
            self._main_depth -= 1
        if tag in self.SKIP and self._skip_depth:
            self._skip_depth -= 1
        if tag == "nav" and self._nav_depth:
            self._nav_depth -= 1

    def handle_data(self, data):
        if self._in_jsonld:
            self._buf += data
            return
        if self._in_title:
            self.title += data
        if self._in_h1 and self.h1:
            self.h1[-1] += data
        if self._skip_depth or self._nav_depth:
            return
        self.body_text.append(data)
        if self._main_depth:
            self.main_text.append(data)


def words_of(texts: list) -> list:
    return re.findall(r"[\wÀ-ÿ’'-]+", " ".join(texts).lower())


def detect_lang(words: list) -> tuple:
    counts = {lang: sum(1 for w in words if w in sw) for lang, sw in STOPWORDS.items()}
    total = sum(counts.values()) or 1
    best = max(counts, key=counts.get)
    return best, counts[best] / total


def jsonld_check(blocks: list) -> tuple:
    types, errors = [], []
    for raw in blocks:
        try:
            data = json.loads(raw)
        except ValueError as err:
            errors.append(f"invalid JSON: {err}")
            continue
        nodes = data.get("@graph", [data]) if isinstance(data, dict) else data
        for node in nodes:
            t = node.get("@type", "?") if isinstance(node, dict) else "?"
            types.append(t if isinstance(t, str) else "/".join(t))
            if isinstance(node, dict) and t == "BreadcrumbList":
                for item in node.get("itemListElement", []):
                    if not item.get("item") and item is not node["itemListElement"][-1]:
                        errors.append("breadcrumb item without URL")
            if isinstance(node, dict) and "geo" in node:
                g = node["geo"]
                if not (isinstance(g.get("latitude"), (int, float)) and isinstance(g.get("longitude"), (int, float))):
                    errors.append("geo without numeric lat/lon")
    return types, errors


# --- the audit ----------------------------------------------------------------

def norm(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def is_internal_page(url: str) -> bool:
    parts = urlsplit(url)
    if parts.netloc not in ("ian.lu", "www.ian.lu") or parts.scheme not in ("http", "https"):
        return False
    path = parts.path
    return path.endswith("/") or path.endswith(".html") or "." not in path.rsplit("/", 1)[-1]


def sitemap_urls(fetcher, live: bool) -> tuple:
    """{url: [sitemap names]}, {url: lastmod}, notes."""
    found = defaultdict(list)
    lastmods = {}
    notes = []
    queue = [f"{ORIGIN}/{name}" for name in SITEMAPS]
    if not live:
        queue += [f"{ORIGIN}/{name}" for name in LEGACY_SITEMAPS if os.path.exists(os.path.join(REPO, name))]
    seen = set()
    while queue:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        chain, status, _, body = follow(fetcher, sm)
        if status != 200:
            notes.append(f"sitemap {sm}: status {status}")
            continue
        name = sm.rsplit("/", 1)[-1]
        if "<sitemapindex" in body:
            queue.extend(re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body))
            continue
        for block in re.findall(r"<url>(.*?)</url>", body, re.S):
            loc = re.search(r"<loc>\s*([^<\s]+)\s*</loc>", block)
            if not loc:
                continue
            found[loc.group(1)].append(name)
            mod = re.search(r"<lastmod>\s*([^<\s]+)\s*</lastmod>", block)
            if mod:
                lastmods[loc.group(1)] = mod.group(1)
    if live:  # also read the two legacy files if they still exist on the server
        for name in LEGACY_SITEMAPS:
            sm = f"{ORIGIN}/{name}"
            if sm not in seen:
                chain, status, _, body = follow(fetcher, sm)
                notes.append(f"legacy sitemap {name}: status {status}, "
                             f"{len(re.findall('<loc>', body))} URLs (not in the index)")
    return found, lastmods, notes


def shingles(words: list) -> set:
    return {" ".join(words[i:i + SHINGLE]) for i in range(max(0, len(words) - SHINGLE + 1))}


def section_of(url: str) -> str:
    m = re.match(r"https://ian\.lu/(trails|mtb)/(de|fr|en|lb)/", url)
    return f"{m.group(1)}/{m.group(2)}" if m else "other"


def audit(fetcher, live: bool, out: str, limit: int = 0) -> None:
    os.makedirs(out, exist_ok=True)
    in_sitemap, lastmods, notes = sitemap_urls(fetcher, live)
    dup_in_sitemaps = {u: s for u, s in in_sitemap.items() if len(s) > 1}
    urls = list(in_sitemap)
    if limit:
        urls = urls[:limit]
    pages = {}
    queue = list(urls)
    queued = set(queue)
    from_sitemap = set(urls)
    t0 = time.time()
    while queue:
        url = queue.pop(0)
        chain, status, headers, body = follow(fetcher, url)
        rec = {"url": url, "chain": chain, "status": status, "final": chain[-1][0],
               "ctype": headers.get("content-type", ""), "sitemap": url in from_sitemap}
        if status == 200 and "html" in rec["ctype"] and body:
            p = PageParser()
            try:
                p.feed(body)
            except Exception as err:  # broken markup should not stop the audit
                rec["parse_error"] = str(err)
            rec["p"] = p
            out_links = []
            for href in p.links:
                target = norm(urljoin(rec["final"], href.strip()))
                if is_internal_page(target):
                    out_links.append(target)
            rec["links"] = out_links
            # crawl one level: pages linked from sitemap pages
            if url in from_sitemap:
                for target in set(out_links):
                    if target not in queued:
                        queued.add(target)
                        queue.append(target)
        pages[url] = rec
        done = len(pages)
        if done % 100 == 0:
            print(f"  {done} fetched, {len(queue)} queued, {time.time() - t0:.0f} s", file=sys.stderr)

    # duplicate URL form probes on a sample
    probes = []
    sample = [u for u in urls if u.endswith(".html")][:3] + [u for u in urls if u.endswith("/")][:3]
    for u in sample:
        parts = urlsplit(u)
        variants = [urlunsplit(("http",) + tuple(parts[1:])),
                    urlunsplit((parts.scheme, "www.ian.lu") + tuple(parts[2:]))]
        if u.endswith(".html"):
            variants.append(u[:-5])
            variants.append(u + "/")
        else:
            variants.append(u + "index.html")
            if u.rstrip("/") != ORIGIN:
                variants.append(u.rstrip("/"))
        for v in variants:
            chain, status, _, body = follow(fetcher, v, head=False)
            canon = ""
            if status == 200 and body:
                pp = PageParser()
                pp.feed(body)
                canon = pp.canonical[0] if pp.canonical else ""
            probes.append((u, v, " > ".join(f"{s}" for _, s in chain), chain[-1][0], canon))

    # inlinks
    inlinks = Counter()
    for url, rec in pages.items():
        for target in set(rec.get("links", [])):
            if target != url:
                inlinks[target] += 1
    final_of = {u: r["final"] for u, r in pages.items()}
    status_of = {u: r["status"] for u, r in pages.items()}

    titles = Counter(r["p"].title.strip() for r in pages.values() if "p" in r)
    descs = Counter(r["p"].meta.get("description", "").strip() for r in pages.values() if "p" in r)

    # near duplicates within each section (same language + category)
    by_section = defaultdict(list)
    for url, rec in pages.items():
        if "p" in rec and rec["status"] == 200:
            w = words_of(rec["p"].main_text if rec["p"].has_main else rec["p"].body_text)
            rec["words"] = len(w)
            rec["sh"] = shingles(w)
            rec["lang_detected"] = detect_lang(w)
            by_section[section_of(url)].append(url)
    # boilerplate: sentences (digits ignored) that recur on >= 10% of a section
    for section, members in by_section.items():
        if section == "other" or len(members) < 10:
            continue
        sent_of = {}
        freq = Counter()
        for u in members:
            p = pages[u]["p"]
            text = " ".join(p.main_text if p.has_main else p.body_text)
            sents = [re.sub(r"\d+([.,]\d+)?", "#", x.strip().lower()) for x in re.split(r"(?<=[.!?:])\s+|\n", text)]
            sents = [x for x in sents if len(x.split()) >= 4]
            sent_of[u] = sents
            freq.update(set(sents))
        limit = max(3, len(members) // 10)
        for u in members:
            unique = [x for x in sent_of[u] if freq[x] < limit]
            pages[u]["unique_words"] = sum(len(x.split()) for x in unique)
    for section, members in by_section.items():
        if section == "other":
            continue
        for i, a in enumerate(members):
            sa = pages[a]["sh"]
            best, best_url = 0.0, ""
            for b in members:
                if a == b:
                    continue
                sb = pages[b]["sh"]
                if not sa or not sb:
                    continue
                j = len(sa & sb) / len(sa | sb)
                if j > best:
                    best, best_url = j, b
            pages[a]["dup"] = (best, best_url)

    rows = []
    issue_counter = Counter()
    for url, rec in pages.items():
        issues = []
        row = {"url": url, "in_sitemap": ";".join(in_sitemap.get(url, [])),
               "lastmod": lastmods.get(url, ""),
               "chain": " > ".join(str(s) for _, s in rec["chain"]),
               "final_url": rec["final"], "final_status": rec["status"]}
        if rec["status"] != 200:
            issues.append(f"status {rec['status']}")
        if len(rec["chain"]) > 1:
            issues.append("redirects" + (" (in sitemap)" if rec["sitemap"] else ""))
        p = rec.get("p")
        if p:
            canon = p.canonical[0] if p.canonical else ""
            robots = p.meta.get("robots", "")
            noindex = "noindex" in robots.lower()
            self_canon = canon == rec["final"]
            title = p.title.strip()
            desc = p.meta.get("description", "").strip()
            row.update({
                "canonical": canon, "canonical_self": self_canon, "robots": robots,
                "lang": p.lang, "title": title, "title_len": len(title), "title_dups": titles[title] - 1,
                "desc_len": len(desc), "desc_dups": descs[desc] - 1,
                "h1_count": len(p.h1), "h1": " | ".join(h.strip() for h in p.h1)[:120],
                "words_main": rec.get("words", 0), "unique_words": rec.get("unique_words", ""),
                "near_dup": f"{rec['dup'][0]:.2f}" if rec.get("dup") else "",
                "near_dup_with": rec["dup"][1] if rec.get("dup") else "",
                "inlinks": inlinks.get(url, 0), "outlinks_internal": len(set(rec.get("links", []))),
                "hreflang": len(p.alternates),
            })
            row["indexable"] = (not noindex) and self_canon
            if len(p.canonical) > 1:
                issues.append("several canonicals")
            if not canon:
                issues.append("no canonical")
            elif not canon.startswith("https://ian.lu/"):
                issues.append("canonical not absolute https://ian.lu")
            elif not self_canon:
                issues.append("canonical points elsewhere")
            if noindex and rec["sitemap"]:
                issues.append("noindex in sitemap")
            if not (TITLE_RANGE[0] <= len(title) <= TITLE_RANGE[1]):
                issues.append(f"title length {len(title)}")
            if titles[title] > 1:
                issues.append("duplicate title")
            if not desc:
                issues.append("no description")
            elif not (DESC_RANGE[0] <= len(desc) <= DESC_RANGE[1]):
                issues.append(f"description length {len(desc)}")
            if desc and descs[desc] > 1:
                issues.append("duplicate description")
            if len(p.h1) != 1:
                issues.append(f"{len(p.h1)} h1")
            if not noindex and rec.get("words", 0) < THIN_WORDS and section_of(url) != "other" \
                    and "/region-" not in url:
                issues.append(f"thin ({rec.get('words', 0)} words)")
            if rec.get("dup") and rec["dup"][0] >= NEAR_DUP:
                issues.append(f"near-duplicate {rec['dup'][0]:.2f}")
            if not noindex and inlinks.get(url, 0) == 0 and rec["sitemap"]:
                issues.append("orphan (no internal links in)")
            lang_d, share = rec.get("lang_detected", ("", 0))
            page_lang = (p.lang or "")[:2]
            if page_lang and lang_d and page_lang != lang_d and share > 0.5 and rec.get("words", 0) > 60:
                issues.append(f"text reads as {lang_d}, html lang {page_lang}")
            # internal links that redirect / break
            bad = []
            for target in set(rec.get("links", [])):
                if urlsplit(target).path.startswith("/pb/"):
                    bad.append(f"→robots-blocked {target}")
                    continue
                tp_rec = pages.get(target, {}).get("p")
                if tp_rec and tp_rec.canonical and tp_rec.canonical[0] != target and status_of.get(target) == 200 \
                        and "noindex" not in tp_rec.meta.get("robots", ""):
                    bad.append(f"→non-canonical {target}")
                if target in status_of:
                    if final_of[target] != target:
                        bad.append(f"→redirect {target}")
                    elif status_of[target] != 200:
                        bad.append(f"→{status_of[target]} {target}")
            if bad:
                issues.append(f"{len(bad)} bad internal links")
                row["bad_links"] = " ".join(sorted(bad))[:600]
            # hreflang
            h_issues = []
            cluster = dict(p.alternates)
            if p.alternates and not noindex:
                if rec["final"] not in cluster.values():
                    h_issues.append("no self entry")
                if "x-default" not in cluster:
                    h_issues.append("no x-default")
                for hl, target in p.alternates:
                    t = pages.get(target)
                    if not t:
                        h_issues.append(f"{hl} target not crawled")
                        continue
                    if t["status"] != 200 or t["final"] != target:
                        h_issues.append(f"{hl} target status {t['status']}")
                        continue
                    tp = t.get("p")
                    if not tp:
                        continue
                    if (tp.canonical[:1] or [""])[0] != target:
                        h_issues.append(f"{hl} target not self-canonical")
                    if hl != "x-default" and rec["final"] not in dict(tp.alternates).values():
                        h_issues.append(f"{hl} not reciprocal")
            if h_issues:
                issues.append("hreflang: " + ", ".join(sorted(set(h_issues))))
            types, errors = jsonld_check(p.jsonld)
            row["jsonld"] = ",".join(types)
            if errors:
                issues.append("JSON-LD: " + "; ".join(errors))
            no_size = [i for i in p.imgs if not (i.get("width") and i.get("height")) and "aspect-ratio" not in i.get("style", "")]
            if no_size:
                issues.append(f"{len(no_size)} img without size")
        if url in dup_in_sitemaps:
            issues.append("listed in several sitemaps")
        row["issues"] = "; ".join(issues)
        for issue in issues:
            issue_counter[re.sub(r"\d+(\.\d+)?", "N", issue.split(":")[0])] += 1
        rows.append(row)

    fields = ["url", "in_sitemap", "lastmod", "chain", "final_url", "final_status", "indexable", "canonical",
              "canonical_self", "robots", "lang", "title", "title_len", "title_dups", "desc_len", "desc_dups",
              "h1_count", "h1", "words_main", "unique_words", "near_dup", "near_dup_with", "inlinks", "outlinks_internal",
              "hreflang", "jsonld", "bad_links", "issues"]
    with open(os.path.join(out, "audit.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for row in sorted(rows, key=lambda r: r["url"]):
            w.writerow(row)

    sm_rows = [r for r in rows if r["in_sitemap"]]
    lines = [
        f"Source: {'live https://ian.lu' if live else 'local working tree ' + REPO}",
        f"Requests: {fetcher.count}",
        f"Sitemap URLs: {len(sm_rows)} (listed in several sitemaps: {len(dup_in_sitemaps)})",
        f"Pages fetched incl. linked: {len(rows)}",
        f"Sitemap URLs not 200 or redirecting: {sum(1 for r in sm_rows if r['final_status'] != 200 or r['chain'] != '200')}",
        f"Sitemap URLs not indexable (noindex or canonical elsewhere): {sum(1 for r in sm_rows if r.get('indexable') is False)}",
        f"Distinct lastmod values in sitemaps: {len(set(lastmods.values()))}",
        "",
        "Issue counts (all crawled URLs):",
    ]
    lines += [f"  {n:5d}  {k}" for k, n in issue_counter.most_common()]
    for section in sorted(by_section):
        if section == "other":
            continue
        dups = [pages[u]["dup"][0] for u in by_section[section] if pages[u].get("dup")]
        words = [pages[u].get("words", 0) for u in by_section[section]]
        uniq = sorted(pages[u].get("unique_words", 0) or 0 for u in by_section[section])
        if dups:
            dups.sort()
            lines.append(f"  {section}: {len(dups)} pages, near-dup median {dups[len(dups)//2]:.2f}, "
                         f"max {dups[-1]:.2f}; words median {sorted(words)[len(words)//2]}, "
                         f"unique-sentence words median {uniq[len(uniq)//2]}")
    lines += ["", "Non-200 / redirecting URLs found:"]
    lines += [f"  {r['chain']:12s} {r['url']} -> {r['final_url']}" for r in rows
              if r["final_status"] != 200 or r["chain"] != "200"][:200]
    lines += ["", "Duplicate URL form probes (original, variant, chain, final, canonical served):"]
    lines += [f"  {a}\n      {b}: {c} -> {d} canon={e}" for a, b, c, d, e in probes]
    lines += ["", "Notes:"] + [f"  {n}" for n in notes]
    with open(os.path.join(out, "summary.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines[:40]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--delay", type=float, default=1.2)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=os.path.expanduser("~/Library/Caches/seo-audit/local"))
    args = ap.parse_args()
    fetcher = LiveFetcher(args.delay) if args.live else LocalFetcher()
    audit(fetcher, args.live, os.path.expanduser(args.out), args.limit)


if __name__ == "__main__":
    main()
