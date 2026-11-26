/* Flow: the generated trail directories (/trails, /mtb). A trail page carries its measured sections in the HTML (not only
 * via JS), a breadcrumb to its region page, valid JSON-LD (TouristAttraction + TouristTrip + 3-step BreadcrumbList),
 * photos with reserved size and no layout shift while it loads and scrolls; the region page lists its trails and links
 * back; the index links every region; the language switch keeps the trail; the MTB site and Luxembourgish work too. */
import { runIfMain } from "./lib.mjs";

async function pageFacts(page) {
  return page.evaluate(() => {
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
    const graph = ld.flatMap((d) => d["@graph"] || [d]);
    const crumbs = graph.find((n) => n["@type"] === "BreadcrumbList");
    return {
      h1: document.querySelector("h1")?.textContent.trim(),
      details: document.querySelectorAll("section.detail").length,
      words: document.querySelector("main")?.innerText.split(/\s+/).length || 0,
      types: graph.map((n) => n["@type"]),
      crumbItems: crumbs ? crumbs.itemListElement.length : 0,
      regionHref: document.querySelector(".crumbs a:nth-of-type(2)")?.getAttribute("href") || "",
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      hreflangs: document.querySelectorAll('link[rel="alternate"][hreflang]').length,
      imgsUnsized: [...document.querySelectorAll(".gallery img")].filter((i) => !i.getAttribute("width") || !i.getAttribute("height")).length,
      lazyImgs: [...document.querySelectorAll(".gallery img")].every((i) => i.loading === "lazy"),
      emDash: document.body.innerText.includes("—"),
    };
  });
}

async function layoutShift(page) {
  return page.evaluate(async () => {
    let cls = 0;
    new PerformanceObserver((list) => { for (const e of list.getEntries()) { if (!e.hadRecentInput) cls += e.value; } })
      .observe({ type: "layout-shift", buffered: true });
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    await new Promise((r) => setTimeout(r, 600));
    return cls;
  });
}

export const flow = {
  name: "trail-pages",
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    h.step("a German trail page: measured sections in the HTML, breadcrumb to its region, JSON-LD, sized lazy photos");
    await h.goto("/trails/de/ahn.html");
    const de = await pageFacts(page);
    h.eq(de.h1, "Auto-Pédestre Ahn", "the h1 is the trail name");
    h.expect(de.details >= 4, `${de.details} measured sections (route, on the way, when, comparison)`);
    h.expect(de.words > 400, `${de.words} words of visible text`);
    h.expect(de.types.includes("TouristTrip") && de.types.includes("TouristAttraction"), `JSON-LD types ${de.types.join(", ")}`);
    h.eq(de.crumbItems, 3, "breadcrumb: index > region > trail");
    h.eq(de.regionHref, "region-moselle.html", "the breadcrumb links the Moselle region page");
    h.eq(de.canonical, "https://ian.lu/trails/de/ahn.html", "self-canonical");
    h.eq(de.hreflangs, 5, "de, fr, en, lb and x-default");
    h.eq(de.imgsUnsized, 0, "every photo has width and height");
    h.expect(de.lazyImgs, "gallery photos load lazily");
    h.expect(!de.emDash, "no em dash in the visible text");
    const cls = await layoutShift(page);
    h.expect(cls < 0.1, `cumulative layout shift ${cls.toFixed(3)} < 0.1 while loading and scrolling`);

    h.step("the region page lists the region's trails and links back to the trail");
    await h.goto(`/trails/de/${de.regionHref}`);
    const region = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent,
      items: document.querySelectorAll(".hub-list li").length,
      hasAhn: !!document.querySelector('.hub-list a[href="ahn.html"]'),
      others: document.querySelectorAll(".region-links a").length,
    }));
    h.expect(region.items >= 10, `${region.items} trails listed on "${region.h1}"`);
    h.expect(region.hasAhn, "Ahn is in the list");
    h.eq(region.others, 4, "links to the four other regions");

    h.step("the index links every region page and still lists every trail");
    await h.goto("/trails/en/");
    const index = await page.evaluate(() => ({
      regions: [...document.querySelectorAll(".region-links a")].map((a) => a.getAttribute("href")),
      cards: document.querySelectorAll(".card").length,
    }));
    h.eq(index.regions.length, 5, `five region links (${index.regions.join(", ")})`);
    h.eq(index.cards, 154, "154 trail cards");

    h.step("the language switch keeps the trail; the Luxembourgish page has its own text");
    await h.goto("/trails/de/ahn.html");
    await page.click('.langs a[data-lang="lb"]');
    await page.waitForLoadState("domcontentloaded");
    h.expect(page.url().endsWith("/trails/lb/ahn.html"), `switched to ${page.url()}`);
    const lb = await page.evaluate(() => document.querySelector("article.desc")?.textContent || "");
    h.expect(/Dës Ronn ronderëm/.test(lb), "the Luxembourgish overview is there");

    h.step("an MTB page in English works the same way");
    await h.goto("/mtb/en/redrock-ellergrond.html");
    const mtb = await pageFacts(page);
    h.expect(mtb.details >= 3 && mtb.types.includes("TouristTrip"), `${mtb.details} sections, JSON-LD ${mtb.types.join(", ")}`);
    h.expect(mtb.regionHref.startsWith("region-"), `breadcrumb region ${mtb.regionHref}`);

    h.eq(errors, [], "no page errors");
  },
};

runIfMain(import.meta.url, flow);
