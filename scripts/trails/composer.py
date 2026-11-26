"""Write each trail page's text from the trail's own measured data.

Nothing here is invented: every sentence states a number or a name that the
pipeline measured or looked up (computed.json from fetch_trails.py and
enrich.py, context.json from fetch_context.py, and the neighbouring trails).
A sentence whose data is missing is left out rather than filled with a
generic line, so two pages only share wording where they share facts.

compose() returns sections of ready-escaped HTML paragraphs plus highlights,
an index teaser and the meta description. Curated texts in curated.json
replace the overview section only; the measured sections are always added.
"""
from __future__ import annotations

import html
import re

BUS_ON_ROUTE_M = 150
VILLAGE_NEAR_M = 450
STOP_FAR_M = 600
MAX_LINES = 8
GENERIC_NAMES = frozenset({
    "schloss", "burg", "château", "chateau", "kierch", "kirche", "église", "eglise", "kapell",
    "kapelle", "chapelle", "chapel", "church", "museum", "musée", "musee", "moulin", "millen",
    "aussichtspunkt", "viewpoint", "panorama", "belvédère", "belvedere", "wegkreuz", "croix",
})
KIND_PRIORITY = {"castle": 0, "ruins": 1, "waterfall": 2, "viewpoint": 3, "museum": 4, "nature_reserve": 5}


def duration_label(length_km: float, elev_gain: int = 0,
                   speed_kmh: float = 4.0, climb_m_per_h: int = 600) -> str:
    """Naismith-ish moving time, rounded to half hours: '2½', '3', '½'."""
    hours = length_km / speed_kmh + (elev_gain or 0) / climb_m_per_h
    halves = max(1, round(hours * 2))
    whole, half = divmod(halves, 2)
    if whole == 0:
        return "½"
    return f"{whole}½" if half else str(whole)


def auto_difficulty(length_km: float, elev_gain: int,
                    thresholds: tuple = (7, 120, 12, 400)) -> str:
    easy_km, easy_gain, hard_km, hard_gain = thresholds
    if length_km >= hard_km or (elev_gain or 0) >= hard_gain:
        return "hard"
    if length_km < easy_km and (elev_gain or 0) < easy_gain:
        return "easy"
    return "moderate"


# --- measuring ----------------------------------------------------------------

def analyse_profile(profile: list) -> dict:
    """Highest/lowest point, longest continuous climb, steepest stretch.

    The profile runs in the direction of the GPX track. A climb continues
    through dips of less than DIP_M; the steepest stretch is measured over
    STEEP_M of distance.
    """
    if not profile or len(profile) < 5:
        return {}
    dip_m, steep_m = 15, 500
    kms = [p[0] for p in profile]
    ms = [p[1] for p in profile]
    hi = max(range(len(ms)), key=lambda i: ms[i])
    lo = min(range(len(ms)), key=lambda i: ms[i])
    best = (0, 0, 0)
    low_i, peak_i = 0, 0
    for i in range(1, len(ms)):
        if ms[i] < ms[peak_i] - dip_m or ms[i] < ms[low_i]:
            low_i, peak_i = i, i
            continue
        if ms[i] > ms[peak_i]:
            peak_i = i
            if ms[peak_i] - ms[low_i] > best[0]:
                best = (ms[peak_i] - ms[low_i], low_i, peak_i)
    steep = (0.0, 0)
    j = 0
    for i in range(len(kms)):
        while j < len(kms) - 1 and kms[j] - kms[i] < steep_m / 1000:
            j += 1
        span = kms[j] - kms[i]
        if span >= steep_m / 1000 * 0.8:
            grade = (ms[j] - ms[i]) / (span * 1000) * 100
            if grade > steep[0]:
                steep = (grade, i)
    return {
        "high_km": kms[hi], "high_m": ms[hi], "low_km": kms[lo], "low_m": ms[lo],
        "climb_m": best[0], "climb_from": kms[best[1]], "climb_to": kms[best[2]],
        "steep_pct": round(steep[0]), "steep_km": kms[steep[1]], "steep_m": steep_m,
    }


def _clean(name: str) -> str:
    return (name or "").strip()


def build_facts(trail: dict, entry: dict, ctx: dict | None, group: list) -> dict:
    """Language-independent facts for one trail (group = nearest neighbours)."""
    ctx = ctx or {}
    place = trail["place"]
    villages, seen = [], set()
    for v in ctx.get("villages", []):
        key = v["names"]["name"].casefold()
        if key in seen or v["dist_m"] > VILLAGE_NEAR_M:
            continue
        seen.add(key)
        villages.append(v)
    place_names = next((v["names"] for v in villages if v["names"]["name"].casefold() == place.casefold()), None)
    others = [v for v in villages if v["names"]["name"].casefold() != place.casefold()]
    pois = sorted((p for p in entry.get("pois") or [] if _clean(p["name"]).casefold() not in GENERIC_NAMES),
                  key=lambda p: (KIND_PRIORITY.get(p["kind"], 9), p["dist_m"]))
    churches = [c for c in ctx.get("churches", []) if _clean(c["names"]["name"]).casefold() not in GENERIC_NAMES]
    waters = ctx.get("waters", [])
    stops = sorted(entry.get("bus_stops") or [], key=lambda s: s["dist_m"])
    return {
        "has_ctx": bool(ctx),
        "slug": trail["slug"], "name": trail["name"], "place": place, "place_names": place_names,
        "region": trail["region"], "length": entry["length_km"], "gain": entry.get("elev_gain") or 0,
        "emin": entry.get("elev_min"), "emax": entry.get("elev_max"),
        "profile": analyse_profile(entry.get("profile") or []),
        "villages": others,
        "follow": [w for w in waters if w["follows"]][:2],
        "cross": [w for w in waters if not w["follows"]][:3],
        "forest": ctx.get("forest_pct"), "vineyard": ctx.get("vineyard_pct", 0),
        "orchard": ctx.get("orchard_pct", 0), "open": ctx.get("open_pct", 0),
        "surface": ctx.get("surface") or {}, "steps": ctx.get("steps", 0),
        "amenities": ctx.get("amenities") or {}, "food": ctx.get("food") or [],
        "pois": pois[:4], "churches": churches[:3], "stops": stops,
        "group": group,
    }


def compare(facts: dict) -> dict:
    """Where this trail stands among itself + its nearest neighbours."""
    group = facts["group"]
    if len(group) < 3:
        return {}
    me = {"length": facts["length"], "gain": facts["gain"], "forest": facts["forest"],
          "paved": facts["surface"].get("paved")}
    out = {"n": len(group)}
    for key in ("length", "gain", "forest", "paved"):
        values = [g.get(key) for g in group]
        if me[key] is None or any(v is None for v in values):
            continue
        if me[key] > max(values):
            out[key] = "max"
        elif me[key] < min(values):
            out[key] = "min"
    on_route = [g for g in group if g.get("bus_on_route")]
    mine = bool(facts["stops"]) and facts["stops"][0]["dist_m"] <= BUS_ON_ROUTE_M
    if mine and not on_route:
        out["bus_only"] = True
    shorter = [g for g in group if g["length"] < facts["length"] * 0.8]
    longer = [g for g in group if g["length"] > facts["length"] * 1.25]
    out["nearest"] = group[0]
    if shorter:
        out["shorter"] = min(shorter, key=lambda g: g["dist"])
    if longer:
        out["longer"] = min(longer, key=lambda g: g["dist"])
    return out


# --- formatting helpers -------------------------------------------------------

def esc(text) -> str:
    return html.escape(str(text), quote=True)


def num(value: float, lang: str, digits: int = 1) -> str:
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".") if digits else str(round(value))
    return text.replace(".", ",") if lang != "en" else text


def pct(value: int, lang: str) -> str:
    return f"{value}%" if lang == "en" else f"{value} %"


AND = {"de": "und", "fr": "et", "en": "and", "lb": "an"}
_LB_DIGIT = {0: "n", 1: "e", 2: "z", 3: "d", 4: "v", 5: "f", 6: "s", 7: "s", 8: "a", 9: "n"}
_LB_TEEN = {10: "z", 11: "e", 12: "z", 13: "d", 14: "v", 15: "f", 16: "s", 17: "s", 18: "u", 19: "n"}
_LB_TENS = {2: "z", 3: "d", 4: "v", 5: "f", 6: "s", 7: "s", 8: "a", 9: "n"}
_LB_KEEP_N = set("aeiouyäëéèöüâ") | set("ndtzh")


def _lb_spoken_initial(n: int) -> str:
    """First letter of a number as spoken in Luxembourgish (units before tens)."""
    if n >= 2000:
        return _LB_DIGIT[n // 1000 % 10] if n < 10000 else "z"
    if n >= 1000:
        return "d"
    if n >= 200:
        return _LB_DIGIT[n // 100]
    if n >= 100:
        return "h"
    if n >= 20:
        return _LB_DIGIT[n % 10] if n % 10 else _LB_TENS[n // 10]
    if n >= 10:
        return _LB_TEEN[n]
    return _LB_DIGIT[n]


def lb_n(word: str, following: str) -> str:
    """Luxembourgish n-rule: a final -n is dropped unless the next word starts
    with a vowel or n, d, t, z, h (a number counts as it is spoken)."""
    if not word.endswith("n"):
        return word
    nxt = re.sub(r"<[^>]+>", "", following).lstrip(" \u201e\u201c\"'(\u2019")
    if not nxt:
        return word
    m = re.match(r"\d+", nxt)
    initial = _lb_spoken_initial(int(m.group(0))) if m else nxt[0].lower()
    if initial in _LB_KEEP_N:
        return word
    return word[:-2] if word.endswith("nn") else word[:-1]  # sinn -> si, ginn -> gi


def join(items: list, lang: str) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    conj = lb_n("an", items[-1]) if lang == "lb" else AND[lang]
    return ", ".join(items[:-1]) + f" {conj} " + items[-1]


def fr_de(name: str) -> str:
    """'de' + a place name, with elision before a vowel: d'Ahn, de Remich."""
    plain = re.sub(r"<[^>]+>", "", name)
    return f"d'{name}" if plain[:1].lower() in "aeiouyéèêâîôû" else f"de {name}"


def link(g: dict) -> str:
    return f'<a href="{esc(g["slug"])}.html">{esc(g["name"])}</a>'


def vname(v: dict, lang: str) -> str:
    """A village name: Luxembourgish pages use name:lb, the others the
    official name, which is also what the signs and the page titles use."""
    local = v["names"].get("lb") if lang == "lb" else None
    if local and "(" not in local:
        return esc(local)
    return esc(v["names"]["name"])


LB_N_WORDS = ("an", "den", "en", "een", "keen", "sinn", "ginn", "vun", "nëmmen", "dësen", "hunn")


def lb_fix_numbers(text: str) -> str:
    """Apply the n-rule to the short words the templates put in front of a
    number, a name or a list item ('an 45' -> 'a 45', 'sinn Feld-' -> 'si Feld-')."""
    pattern = r"(?<![\w’'-])(" + "|".join(LB_N_WORDS) + r") (?=\S)"
    return re.sub(pattern, lambda m: lb_n(m.group(1), text[m.end():]) + " ", text, flags=re.I)


FOOD_KIND = {"de": ("Restaurant", "Café"), "fr": ("restaurant", "café"), "en": ("restaurant", "café"),
             "lb": ("Restaurant", "Café")}


def food_kind(place: dict, lang: str) -> str:
    """'restaurant, ' unless the name already says it."""
    word = FOOD_KIND[lang][1 if place["kind"] == "cafe" else 0]
    name = place["name"].casefold()
    if word.casefold() in name or ("cafe" in name and place["kind"] == "cafe"):
        return ""
    return word + ", "


def lines_of(stop: dict) -> list:
    return list(stop.get("lines") or [])[:MAX_LINES]


def _masc_water(name: str) -> bool:
    return bool(re.search(r"(bach|baach|graben|grouf|bur|born)$", name.casefold()))


# --- per-language text --------------------------------------------------------

REGION_IN = {
    "de": {"eislek": "im Éislek im Norden Luxemburgs", "mullerthal": "in der Region Müllerthal",
           "moselle": "an der Luxemburger Mosel", "minett": "im Minett im Süden des Landes",
           "center": "im Guttland in der Mitte des Landes"},
    "fr": {"eislek": "dans l'Éislek, au nord du Luxembourg", "mullerthal": "dans la région du Mullerthal",
           "moselle": "sur la Moselle luxembourgeoise", "minett": "dans le Minett, au sud du pays",
           "center": "dans le Guttland, au centre du pays"},
    "en": {"eislek": "in the Éislek, Luxembourg's north", "mullerthal": "in the Mullerthal region",
           "moselle": "on the Luxembourg Moselle", "minett": "in the Minett, the south of the country",
           "center": "in the Guttland, the centre of the country"},
    "lb": {"eislek": "am Éislek", "mullerthal": "am Mëllerdall", "moselle": "un der Musel",
           "minett": "am Minett", "center": "am Guttland"},
}

POI_KIND = {
    "de": {"castle": "Burg/Schloss", "ruins": "Ruine", "waterfall": "Wasserfall", "viewpoint": "Aussichtspunkt",
           "museum": "Museum", "nature_reserve": "Naturschutzgebiet"},
    "fr": {"castle": "château", "ruins": "ruines", "waterfall": "cascade", "viewpoint": "point de vue",
           "museum": "musée", "nature_reserve": "réserve naturelle"},
    "en": {"castle": "castle", "ruins": "ruins", "waterfall": "waterfall", "viewpoint": "viewpoint",
           "museum": "museum", "nature_reserve": "nature reserve"},
    "lb": {"castle": "Schlass", "ruins": "Ruin", "waterfall": "Waasserfall", "viewpoint": "Aussiichtspunkt",
           "museum": "Musée", "nature_reserve": "Naturschutzgebitt"},
}

SECTION_TITLES = {
    "de": {"route": "Der Weg im Detail", "way": "Unterwegs", "when": "Wann und wie",
           "compare": "Im Vergleich mit den Wegen in der Nähe", "ride_route": "Die Strecke im Detail"},
    "fr": {"route": "Le parcours en détail", "way": "En chemin", "when": "Quand y aller",
           "compare": "Comparé aux circuits voisins", "ride_route": "Le parcours en détail"},
    "en": {"route": "The route in detail", "way": "Along the way", "when": "When to go",
           "compare": "Compared with the trails nearby", "ride_route": "The route in detail"},
    "lb": {"route": "De Wee am Detail", "way": "Ënnerwee", "when": "Wéini goen",
           "compare": "Am Verglach mat de Weeër an der Géigend", "ride_route": "D’Streck am Detail"},
}


SURFACE_PARTS = {
    # kind: (first form, following form); {p} is the share, {path} the path word
    "en": {"paved": ("About {p} of the distance is on tarmac", "{p} on tarmac"),
           "track": ("About {p} of the distance is on farm and forest tracks", "{p} on farm and forest tracks"),
           "path": ("About {p} of the distance is on {path}", "{p} on {path}")},
    "de": {"paved": ("Etwa {p} der Strecke sind asphaltiert", "{p} sind asphaltiert"),
           "track": ("Etwa {p} der Strecke verlaufen auf Feld- und Waldwegen", "{p} verlaufen auf Feld- und Waldwegen"),
           "path": ("Etwa {p} der Strecke verlaufen auf {path}", "{p} auf {path}")},
    "fr": {"paved": ("Environ {p} du parcours est goudronné", "{p} est goudronné"),
           "track": ("Environ {p} du parcours suit des chemins agricoles et forestiers",
                     "{p} suit des chemins agricoles et forestiers"),
           "path": ("Environ {p} du parcours emprunte {path}", "{p} emprunte {path}")},
    "lb": {"paved": ("Ongeféier {p} vun der Streck sinn asphaltéiert", "{p} sinn asphaltéiert"),
           "track": ("Ongeféier {p} vun der Streck sinn Feld- a Bëschweeër", "{p} sinn Feld- a Bëschweeër"),
           "path": ("Ongeféier {p} vun der Streck sinn {path}", "{p} sinn {path}")},
}
PATH_WORD = {
    "en": ("narrow paths", "singletrack and narrow paths"),
    "de": ("schmalen Pfaden", "Trails und schmalen Pfaden"),
    "fr": ("des sentiers étroits", "des singles et sentiers étroits"),
    "lb": ("schmuel Weeër", "schmuel Weeër"),
}
LAND_PARTS = {
    "en": {"forest": ("{p} of the route runs through woodland", "{p} through woodland"),
           "vineyard": ("{p} of the route runs through vineyards", "{p} between vineyards"),
           "orchard": ("{p} of the route runs past orchards", "{p} past orchards")},
    "de": {"forest": ("{p} der Strecke führen durch Wald", "{p} durch Wald"),
           "vineyard": ("{p} der Strecke führen durch Weinberge", "{p} durch Weinberge"),
           "orchard": ("{p} der Strecke führen an Obstwiesen vorbei", "{p} an Obstwiesen vorbei")},
    "fr": {"forest": ("{p} du tracé traverse la forêt", "{p} la forêt"),
           "vineyard": ("{p} du tracé traverse les vignes", "{p} les vignes"),
           "orchard": ("{p} du tracé longe des vergers", "{p} longe des vergers")},
    "lb": {"forest": ("{p} vum Wee féieren duerch de Bësch", "{p} duerch de Bësch"),
           "vineyard": ("{p} vum Wee féieren duerch d’Wéngerten", "{p} duerch d’Wéngerten"),
           "orchard": ("{p} vum Wee féieren laanscht Bongerten", "{p} laanscht Bongerten")},
}
LAND_MIN_PCT = 5


class Text:
    """Sentences for one trail in one language. Subclasses per language."""

    def _parts(self, table: dict, shares: list, extra: dict) -> str:
        parts = []
        for kind, share in shares:
            first, following = table[kind]
            parts.append((following if parts else first).format(p=self.p(share), **extra))
        return join(parts, self.lang) + "." if parts else ""

    def surface_sentence(self) -> str:
        su = self.f["surface"]
        shares = [(k, su.get(k, 0)) for k in ("paved", "track", "path") if su.get(k, 0) > 0]
        return self._parts(SURFACE_PARTS[self.lang], shares, {"path": PATH_WORD[self.lang][1 if self.mtb else 0]})

    def land_sentence(self) -> str:
        f = self.f
        shares = [(k, f[k]) for k in ("forest", "vineyard", "orchard") if (f[k] or 0) >= LAND_MIN_PCT]
        return self._parts(LAND_PARTS[self.lang], shares, {})

    lang = "en"

    def __init__(self, f: dict, cat: str, duration: str):
        self.f = f
        self.cat = cat
        self.mtb = cat == "mtb"
        self.d = duration

    # helpers
    def n(self, v, digits=1):
        return num(v, self.lang, digits)

    def p(self, v):
        return pct(v, self.lang)

    def place(self):
        f = self.f
        if self.lang == "lb" and f["place_names"]:
            local = f["place_names"].get("lb")
            return esc(local if local and "(" not in local else f["place"])
        return esc(f["place"])

    def water(self, w):
        return esc(w["names"].get(self.lang) or w["names"]["name"])

    # sections: each returns a list of sentences (HTML-safe strings)
    def overview(self):
        return []

    def route(self):
        return []

    def way(self):
        return []

    def when(self):
        return []

    def comparison(self):
        return []

    def bus(self):
        return []


class En(Text):
    lang = "en"

    def overview(self):
        f = self.f
        kind = "mountain-bike loop" if self.mtb else "loop walk"
        s = [f"The {esc(f['name'])} is a {self.n(f['length'])} km {kind} around {self.place()} "
             f"{REGION_IN['en'][f['region']]}."]
        if f["emin"] is not None and f["gain"] >= 40:
            s.append(f"It has {f['gain']} m of climbing in total and stays between {f['emin']} and {f['emax']} m above sea level.")
        elif f["emin"] is not None:
            s.append(f"It is almost flat: the whole route stays between {f['emin']} and {f['emax']} m above sea level.")
        hours = "hour" if self.d in ("½", "1") else "hours"
        s.append(f"Riding time at a steady pace is about {self.d} {hours}." if self.mtb
                 else f"At a steady walking pace it takes about {self.d} {hours}.")
        if f["has_ctx"]:
            vs = [vname(v, "en") for v in f["villages"]]
            if len(vs) >= 2:
                s.append(f"Apart from {self.place()}, it passes {join(vs[:6], 'en')}, in the order of the GPX track.")
            elif vs:
                s.append(f"Apart from {self.place()}, the only village on the way is {vs[0]}.")
            else:
                s.append(f"Apart from {self.place()}, there is no other village on the way.")
        return s

    def route(self):
        f, s = self.f, []
        su = f["surface"]
        if su:
            s.append(self.surface_sentence())
            if su.get("unknown", 0) >= 15:
                s.append(f"For the remaining {self.p(su['unknown'])}, OpenStreetMap has no mapped way, so these shares are approximate.")
        if f["forest"] is not None:
            land = self.land_sentence()
            if land:
                s.append(land)
            else:
                s.append("There is hardly any woodland on the way" +
                         (", most of it crosses fields and meadows." if f["open"] >= 30 else "."))
        for w in f["follow"]:
            s.append(f"For about {self.n(w['along_km'])} km it runs close to the {self.water(w)}.")
        if f["cross"]:
            s.append(f"It also crosses the {join([self.water(w) for w in f['cross']], 'en')}.")
        if f["steps"]:
            s.append("There is one flight of steps on the way." if f["steps"] == 1
                     else f"There are {f['steps']} flights of steps on the way.")
        pr = f["profile"]
        if pr and f["gain"] >= 40 and pr["climb_m"] >= 20:
            sent = (f"In the direction of the GPX track, the longest climb gains {pr['climb_m']} m between "
                    f"km {self.n(pr['climb_from'])} and km {self.n(pr['climb_to'])}")
            if pr["steep_pct"] >= 4:
                sent += f"; the steepest {pr['steep_m']} m, from km {self.n(pr['steep_km'])}, average {pr['steep_pct']}%"
            s.append(sent + ".")
            s.append(f"The highest point, {pr['high_m']} m, comes at km {self.n(pr['high_km'])}.")
        elif pr:
            s.append(f"The difference between the highest and the lowest point is only {pr['high_m'] - pr['low_m']} m.")
        return s

    def way(self):
        f, s = self.f, []
        if f["pois"]:
            items = [f"{esc(p['name'])} ({POI_KIND['en'][p['kind']]}, {p['dist_m']} m from the route)" for p in f["pois"]]
            s.append(f"Within a few hundred metres: {join(items, 'en')}.")
        if f["churches"]:
            s.append(f"Churches and chapels on the way: {join([esc(c['names']['name']) for c in f['churches']], 'en')}.")
        if f["has_ctx"]:
            a = f["amenities"]
            items = []
            for key, one, many in (("bench", "bench", "benches"), ("picnic", "picnic spot", "picnic spots"),
                                   ("shelter", "shelter", "shelters"), ("playground", "playground", "playgrounds"),
                                   ("drinking_water", "drinking-water tap", "drinking-water taps"),
                                   ("toilets", "public toilet", "public toilets")):
                if a.get(key):
                    items.append(("an " if one[0] in "aeiou" else "a ") + one if a[key] == 1 else f"{a[key]} {many}")
            if items:
                s.append(f"OpenStreetMap lists {join(items, 'en')} within 60 m of the route.")
            else:
                s.append("OpenStreetMap lists no benches, picnic tables or shelters along the route.")
            if f["food"]:
                items = [f"{esc(x['name'])} ({food_kind(x, self.lang)}km {self.n(x['km'])})"
                         for x in f["food"][:4]]
                s.append(f"Places to eat right by the route: {join(items, 'en')}.")
            else:
                s.append("There is no restaurant or café directly on the route.")
        return s

    def when(self):
        f, s = self.f, []
        if not f["has_ctx"]:
            return s
        su = f["surface"]
        unpaved = su.get("track", 0) + su.get("path", 0)
        if f["forest"] >= 50:
            s.append(f"With {self.p(f['forest'])} woodland, much of the route is in shade, which helps on hot days.")
        elif f["forest"] < 15:
            s.append("There is little shade, so on hot days the morning or the evening is the better time.")
        if unpaved >= 60:
            s.append(f"{self.p(unpaved)} of the route is unpaved and can be muddy after rain and in winter"
                     + ("; expect slippery sections." if self.mtb else "; sturdy shoes help."))
        elif su.get("paved", 0) >= 70:
            s.append("As most of it is tarmac, it stays easy going after rain.")
        if f["vineyard"] >= 10:
            s.append("The grape harvest in the vineyards along the way usually runs in September and October.")
        if f["orchard"] >= 5:
            s.append("The orchards on the way flower in spring, usually in April.")
        return s

    def comparison(self):
        f, s = self.f, []
        c = compare(f)
        if not c:
            return s
        word = "loops" if self.mtb else "circuits"
        traits = []
        if c.get("length") == "max":
            traits.append("is the longest")
        if c.get("length") == "min":
            traits.append("is the shortest")
        if c.get("gain") == "max":
            traits.append("has the most climbing")
        if c.get("gain") == "min":
            traits.append("has the least climbing")
        if c.get("forest") == "max":
            traits.append("has the most woodland")
        if c.get("forest") == "min":
            traits.append("has the least woodland")
        if c.get("paved") == "max":
            traits.append("has the most tarmac")
        if c.get("paved") == "min":
            traits.append("has the least tarmac")
        if c.get("bus_only"):
            traits.append("is the only one with a bus stop right on the route")
        n = c["n"]
        if traits:
            s.append(f"Compared with the {n} nearest {word}, this one {join(traits, 'en')}.")
        else:
            s.append(f"Among the {n} nearest {word} it is neither the longest nor the shortest, and its "
                     f"{f['gain']} m of climbing are not an extreme either.")
        g = c["nearest"]
        s.append(f"The closest, {link(g)} ({self.n(g['dist'])} km away), is {self.n(g['length'])} km long "
                 f"with {g['gain']} m of climbing.")
        if c.get("shorter") and c["shorter"] is not g:
            x = c["shorter"]
            s.append(f"For something shorter nearby: {link(x)}, {self.n(x['length'])} km.")
        if c.get("longer") and c["longer"] is not g:
            x = c["longer"]
            s.append(f"For a longer {'ride' if self.mtb else 'walk'}: {link(x)}, {self.n(x['length'])} km.")
        return s

    def bus(self):
        f, s = self.f, []
        stops = f["stops"]
        if not stops:
            return ["No bus stop was found within 1.2 km of the route."]
        st = stops[0]
        lines = lines_of(st)
        lw = f" (line{'s' if len(lines) > 1 else ''} {', '.join(esc(x) for x in lines)})" if lines else ""
        if st["dist_m"] <= BUS_ON_ROUTE_M:
            s.append(f"The stop {esc(st['name'])} is right on the route{lw}.")
        elif st["dist_m"] <= STOP_FAR_M:
            s.append(f"The nearest stop is {esc(st['name'])}, {st['dist_m']} m from the route{lw}.")
        else:
            s.append(f"The nearest stop, {esc(st['name'])}, is {st['dist_m']} m from the route{lw}, so allow for the walk.")
        return s

    def meta(self):
        f = self.f
        noun = "MTB loop" if self.mtb else "loop walk"
        parts = [f"{self.n(f['length'])} km {noun}, {f['gain']} m climbing, about {self.d} h."]
        if f["villages"]:
            parts.append(f"Via {join([vname(v, 'en') for v in f['villages'][:2]], 'en')}.")
        if f["forest"] is not None:
            parts.append(f"{self.p(f['vineyard'])} vineyards." if f["vineyard"] >= 20
                         else f"{self.p(f['forest'])} woodland.")
        parts.append("Map, GPX, bus stops.")
        return parts


class De(Text):
    lang = "de"

    def overview(self):
        f = self.f
        kind = "Mountainbike-Runde" if self.mtb else "Rundwanderweg"
        s = [f"Der {esc(f['name'])} ist ein {self.n(f['length'])} km langer {kind} rund um {self.place()} "
             f"{REGION_IN['de'][f['region']]}." if not self.mtb else
             f"Die Tour {esc(f['name'])} ist eine {self.n(f['length'])} km lange {kind} rund um {self.place()} "
             f"{REGION_IN['de'][f['region']]}."]
        if f["emin"] is not None and f["gain"] >= 40:
            s.append(f"Insgesamt kommen {f['gain']} Höhenmeter zusammen, die Strecke liegt zwischen {f['emin']} "
                     f"und {f['emax']} m über dem Meeresspiegel.")
        elif f["emin"] is not None:
            s.append(f"Die Strecke ist fast flach und liegt durchgehend zwischen {f['emin']} und {f['emax']} m über dem Meeresspiegel.")
        unit = "Stunde" if self.d in ("½", "1") else "Stunden"
        s.append(f"Die Fahrzeit liegt bei etwa {self.d} {unit}." if self.mtb
                 else f"Bei normalem Tempo ist man etwa {self.d} {unit} unterwegs.")
        if f["has_ctx"]:
            vs = [vname(v, "de") for v in f["villages"]]
            if len(vs) >= 2:
                s.append(f"Außer {self.place()} liegen in der Richtung des GPX-Tracks {join(vs[:6], 'de')} am Weg.")
            elif vs:
                s.append(f"Außer {self.place()} liegt nur {vs[0]} am Weg.")
            else:
                s.append(f"Außer {self.place()} liegt kein Ort am Weg.")
        return s

    def route(self):
        f, s = self.f, []
        su = f["surface"]
        if su:
            s.append(self.surface_sentence())
            if su.get("unknown", 0) >= 15:
                s.append(f"Für die übrigen {self.p(su['unknown'])} ist in OpenStreetMap kein Weg erfasst, die Anteile sind also nur ungefähr.")
        if f["forest"] is not None:
            land = self.land_sentence()
            if land:
                s.append(land)
            else:
                s.append("Wald gibt es unterwegs kaum" +
                         (", der größte Teil führt über Felder und Wiesen." if f["open"] >= 30 else "."))
        for w in f["follow"]:
            art = "am" if _masc_water(w["names"]["name"]) else "an der"
            s.append(f"Auf etwa {self.n(w['along_km'])} km verläuft der Weg nahe {art} {self.water(w)}.")
        if f["cross"]:
            items = [("den " if _masc_water(w["names"]["name"]) else "die ") + self.water(w) for w in f["cross"]]
            s.append(f"Außerdem quert er {join(items, 'de')}.")
        if f["steps"]:
            s.append("Unterwegs gibt es eine Treppe." if f["steps"] == 1 else f"Unterwegs gibt es {f['steps']} Treppen.")
        pr = f["profile"]
        if pr and f["gain"] >= 40 and pr["climb_m"] >= 20:
            sent = (f"In Richtung des GPX-Tracks gewinnt der längste Anstieg {pr['climb_m']} Höhenmeter, von "
                    f"km {self.n(pr['climb_from'])} bis km {self.n(pr['climb_to'])}")
            if pr["steep_pct"] >= 4:
                sent += f"; am steilsten sind die {pr['steep_m']} m ab km {self.n(pr['steep_km'])} mit im Schnitt {self.p(pr['steep_pct'])}"
            s.append(sent + ".")
            s.append(f"Der höchste Punkt liegt mit {pr['high_m']} m bei km {self.n(pr['high_km'])}.")
        elif pr:
            s.append(f"Zwischen dem höchsten und dem tiefsten Punkt liegen nur {pr['high_m'] - pr['low_m']} m.")
        return s

    def way(self):
        f, s = self.f, []
        if f["pois"]:
            items = [f"{esc(p['name'])} ({POI_KIND['de'][p['kind']]}, {p['dist_m']} m vom Weg)" for p in f["pois"]]
            s.append(f"Wenige hundert Meter vom Weg entfernt: {join(items, 'de')}.")
        if f["churches"]:
            s.append(f"Kirchen und Kapellen am Weg: {join([esc(c['names']['name']) for c in f['churches']], 'de')}.")
        if f["has_ctx"]:
            a = f["amenities"]
            items = []
            for key, one, many in (("bench", "Bank", "Bänke"), ("picnic", "Picknickplatz", "Picknickplätze"),
                                   ("shelter", "Schutzhütte", "Schutzhütten"), ("playground", "Spielplatz", "Spielplätze"),
                                   ("drinking_water", "Trinkwasserstelle", "Trinkwasserstellen"),
                                   ("toilets", "öffentliche Toilette", "öffentliche Toiletten")):
                if a.get(key):
                    article = "eine" if key in ("bench", "shelter", "drinking_water", "toilets") else "einen"
                    items.append(f"{article} {one}" if a[key] == 1 else f"{a[key]} {many}")
            if items:
                s.append(f"OpenStreetMap verzeichnet bis 60 m vom Weg {join(items, 'de')}.")
            else:
                s.append("OpenStreetMap verzeichnet am Weg keine Bänke, Picknicktische oder Schutzhütten.")
            if f["food"]:
                items = [f"{esc(x['name'])} ({food_kind(x, self.lang)}km {self.n(x['km'])})"
                         for x in f["food"][:4]]
                s.append(f"Einkehren direkt am Weg: {join(items, 'de')}.")
            else:
                s.append("Direkt am Weg gibt es kein Restaurant und kein Café.")
        return s

    def when(self):
        f, s = self.f, []
        if not f["has_ctx"]:
            return s
        su = f["surface"]
        unpaved = su.get("track", 0) + su.get("path", 0)
        if f["forest"] >= 50:
            s.append(f"Mit {self.p(f['forest'])} Waldanteil liegt ein großer Teil im Schatten, was an heißen Tagen hilft.")
        elif f["forest"] < 15:
            s.append("Schatten gibt es wenig, an heißen Tagen geht man besser morgens oder abends.")
        if unpaved >= 60:
            s.append(f"{self.p(unpaved)} der Strecke sind unbefestigt und nach Regen und im Winter oft matschig"
                     + ("; mit rutschigen Stellen ist zu rechnen." if self.mtb else "; feste Schuhe helfen."))
        elif su.get("paved", 0) >= 70:
            s.append("Da der Weg größtenteils asphaltiert ist, lässt er sich auch nach Regen gut gehen.")
        if f["vineyard"] >= 10:
            s.append("Die Weinlese in den Weinbergen am Weg findet meist im September und Oktober statt.")
        if f["orchard"] >= 5:
            s.append("Die Obstwiesen am Weg blühen im Frühjahr, meist im April.")
        return s

    def comparison(self):
        f, s = self.f, []
        c = compare(f)
        if not c:
            return s
        word = "Touren" if self.mtb else "Rundwegen"
        one = "einzige" if self.mtb else "einziger"
        traits = []
        if c.get("length") == "max":
            traits.append("ist am längsten")
        if c.get("length") == "min":
            traits.append("ist am kürzesten")
        if c.get("gain") == "max":
            traits.append("hat die meisten Höhenmeter")
        if c.get("gain") == "min":
            traits.append("hat die wenigsten Höhenmeter")
        if c.get("forest") == "max":
            traits.append("hat den meisten Wald")
        if c.get("forest") == "min":
            traits.append("hat den wenigsten Wald")
        if c.get("paved") == "max":
            traits.append("hat den größten Asphaltanteil")
        if c.get("paved") == "min":
            traits.append("hat den kleinsten Asphaltanteil")
        if c.get("bus_only"):
            traits.append(f"hat als {one} eine Haltestelle direkt am Weg")
        n = c["n"]
        subject = "Diese Tour" if self.mtb else "Dieser Weg"
        if traits:
            merged = []
            for t in traits:
                if merged and merged[-1].startswith("hat ") and t.startswith("hat "):
                    t = t[4:]
                merged.append(t)
            s.append(f"{subject} {join(merged, 'de')}, verglichen mit den {n} nächstgelegenen {word}.")
        else:
            article = "die" if self.mtb else "der"
            s.append(f"{subject} ist weder {article} längste noch {article} kürzeste der {n} nächstgelegenen "
                     f"{word}, und {'ihre' if self.mtb else 'seine'} {f['gain']} Höhenmeter sind kein Extremwert.")
        g = c["nearest"]
        s.append(f"Am nächsten liegt {link(g)} ({self.n(g['dist'])} km entfernt) mit {self.n(g['length'])} km "
                 f"und {g['gain']} Höhenmetern.")
        if c.get("shorter") and c["shorter"] is not g:
            x = c["shorter"]
            s.append(f"Kürzer in der Nähe: {link(x)}, {self.n(x['length'])} km.")
        if c.get("longer") and c["longer"] is not g:
            x = c["longer"]
            s.append(f"Länger in der Nähe: {link(x)}, {self.n(x['length'])} km.")
        return s

    def bus(self):
        f, s = self.f, []
        stops = f["stops"]
        if not stops:
            return ["Im Umkreis von 1,2 km um die Strecke wurde keine Bushaltestelle gefunden."]
        st = stops[0]
        lines = lines_of(st)
        lw = f" (Linie{'n' if len(lines) > 1 else ''} {', '.join(esc(x) for x in lines)})" if lines else ""
        if st["dist_m"] <= BUS_ON_ROUTE_M:
            s.append(f"Die Haltestelle {esc(st['name'])} liegt direkt am Weg{lw}.")
        elif st["dist_m"] <= STOP_FAR_M:
            s.append(f"Die nächste Haltestelle ist {esc(st['name'])}, {st['dist_m']} m vom Weg{lw}.")
        else:
            s.append(f"Die nächste Haltestelle, {esc(st['name'])}, liegt {st['dist_m']} m vom Weg entfernt{lw}; "
                     f"dieser Fußweg kommt also noch dazu.")
        return s

    def meta(self):
        f = self.f
        noun = "MTB-Runde" if self.mtb else "Rundweg"
        parts = [f"{self.n(f['length'])} km {noun}, {f['gain']} Hm, ca. {self.d} Std."]
        if f["villages"]:
            parts.append(f"Über {join([vname(v, 'de') for v in f['villages'][:2]], 'de')}.")
        if f["forest"] is not None:
            parts.append(f"{self.p(f['vineyard'])} Weinberge." if f["vineyard"] >= 20
                         else f"{self.p(f['forest'])} Wald.")
        parts.append("Karte, GPX, Bushaltestellen.")
        return parts


class Fr(Text):
    lang = "fr"

    def overview(self):
        f = self.f
        kind = "boucle VTT" if self.mtb else "boucle de randonnée"
        s = [f"Le circuit {esc(f['name'])} est une {kind} de {self.n(f['length'])} km autour "
             f"{fr_de(self.place())}, {REGION_IN['fr'][f['region']]}."]
        if f["emin"] is not None and f["gain"] >= 40:
            s.append(f"Il cumule {f['gain']} m de dénivelé positif et reste entre {f['emin']} et {f['emax']} m d'altitude.")
        elif f["emin"] is not None:
            s.append(f"Il est presque plat : tout le parcours reste entre {f['emin']} et {f['emax']} m d'altitude.")
        s.append(f"Comptez environ {self.d} h de selle à allure régulière." if self.mtb
                 else f"À allure normale, comptez environ {self.d} h de marche.")
        if f["has_ctx"]:
            vs = [vname(v, "fr") for v in f["villages"]]
            if len(vs) >= 2:
                s.append(f"En plus {fr_de(self.place())}, il passe par {join(vs[:6], 'fr')}, dans l'ordre de la trace GPX.")
            elif vs:
                s.append(f"En plus {fr_de(self.place())}, le seul village sur le parcours est {vs[0]}.")
            else:
                s.append(f"En dehors {fr_de(self.place())}, aucun village ne se trouve sur le parcours.")
        return s

    def route(self):
        f, s = self.f, []
        su = f["surface"]
        if su:
            s.append(self.surface_sentence())
            if su.get("unknown", 0) >= 15:
                s.append(f"Pour les {self.p(su['unknown'])} restants, OpenStreetMap ne connaît pas de chemin : ces parts sont donc approximatives.")
        if f["forest"] is not None:
            land = self.land_sentence()
            if land:
                s.append(land)
            else:
                s.append("Il n'y a presque pas de forêt sur le parcours" +
                         (", qui traverse surtout des champs et des prés." if f["open"] >= 30 else "."))
        for w in f["follow"]:
            nm = self.water(w)
            if _masc_water(w["names"]["name"]):
                where = f"du ruisseau {nm}"
            elif nm[:1].lower() in "aeiouéèêh":
                where = f"de l'{nm}"
            else:
                where = f"de la {nm}"
            s.append(f"Sur environ {self.n(w['along_km'])} km, le chemin longe les abords {where}.")
        if f["cross"]:
            s.append(f"Il franchit aussi {join(['le cours d’eau ' + self.water(w) for w in f['cross']], 'fr')}.")
        if f["steps"]:
            s.append("Le parcours comporte un escalier." if f["steps"] == 1 else f"Le parcours comporte {f['steps']} escaliers.")
        pr = f["profile"]
        if pr and f["gain"] >= 40 and pr["climb_m"] >= 20:
            sent = (f"Dans le sens de la trace GPX, la plus longue montée gagne {pr['climb_m']} m entre "
                    f"le km {self.n(pr['climb_from'])} et le km {self.n(pr['climb_to'])}")
            if pr["steep_pct"] >= 4:
                sent += f" ; les {pr['steep_m']} m les plus raides, à partir du km {self.n(pr['steep_km'])}, montent en moyenne de {self.p(pr['steep_pct'])}"
            s.append(sent + ".")
            s.append(f"Le point culminant, à {pr['high_m']} m, se trouve au km {self.n(pr['high_km'])}.")
        elif pr:
            s.append(f"Entre le point le plus haut et le plus bas, il n'y a que {pr['high_m'] - pr['low_m']} m.")
        return s

    def way(self):
        f, s = self.f, []
        if f["pois"]:
            items = [f"{esc(p['name'])} ({POI_KIND['fr'][p['kind']]}, à {p['dist_m']} m du parcours)" for p in f["pois"]]
            s.append(f"À quelques centaines de mètres : {join(items, 'fr')}.")
        if f["churches"]:
            s.append(f"Églises et chapelles sur le parcours : {join([esc(c['names']['name']) for c in f['churches']], 'fr')}.")
        if f["has_ctx"]:
            a = f["amenities"]
            items = []
            for key, one, many in (("bench", "banc", "bancs"), ("picnic", "aire de pique-nique", "aires de pique-nique"),
                                   ("shelter", "abri", "abris"), ("playground", "aire de jeux", "aires de jeux"),
                                   ("drinking_water", "point d'eau potable", "points d'eau potable"),
                                   ("toilets", "toilettes publiques", "toilettes publiques")):
                if a.get(key):
                    count = a[key]
                    if count == 1:
                        article = "des" if key == "toilets" else ("une" if key in ("picnic", "playground") else "un")
                        items.append(f"{article} {one}")
                    else:
                        items.append(f"{count} {many}")
            if items:
                s.append(f"OpenStreetMap recense {join(items, 'fr')} à moins de 60 m du parcours.")
            else:
                s.append("OpenStreetMap ne recense ni banc, ni table de pique-nique, ni abri le long du parcours.")
            if f["food"]:
                items = [f"{esc(x['name'])} ({food_kind(x, self.lang)}km {self.n(x['km'])})"
                         for x in f["food"][:4]]
                s.append(f"Pour manger, directement sur le parcours : {join(items, 'fr')}.")
            else:
                s.append("Il n'y a ni restaurant ni café directement sur le parcours.")
        return s

    def when(self):
        f, s = self.f, []
        if not f["has_ctx"]:
            return s
        su = f["surface"]
        unpaved = su.get("track", 0) + su.get("path", 0)
        if f["forest"] >= 50:
            s.append(f"Avec {self.p(f['forest'])} de forêt, une grande partie du parcours est à l'ombre, ce qui aide par forte chaleur.")
        elif f["forest"] < 15:
            s.append("Il y a peu d'ombre : par forte chaleur, mieux vaut partir le matin ou en fin de journée.")
        if unpaved >= 60:
            s.append(f"{self.p(unpaved)} du parcours n'est pas revêtu et peut être boueux après la pluie et en hiver"
                     + (" ; attention aux passages glissants." if self.mtb else " ; de bonnes chaussures sont utiles."))
        elif su.get("paved", 0) >= 70:
            s.append("Comme il est en grande partie goudronné, il reste praticable après la pluie.")
        if f["vineyard"] >= 10:
            s.append("Les vendanges dans les vignes du parcours ont lieu en général en septembre et en octobre.")
        if f["orchard"] >= 5:
            s.append("Les vergers du parcours fleurissent au printemps, en général en avril.")
        return s

    def comparison(self):
        f, s = self.f, []
        c = compare(f)
        if not c:
            return s
        word = "circuits"
        traits = []
        if c.get("length") == "max":
            traits.append("le plus long")
        if c.get("length") == "min":
            traits.append("le plus court")
        if c.get("gain") == "max":
            traits.append("celui qui a le plus de dénivelé")
        if c.get("gain") == "min":
            traits.append("celui qui a le moins de dénivelé")
        if c.get("forest") == "max":
            traits.append("le plus forestier")
        if c.get("forest") == "min":
            traits.append("le moins forestier")
        if c.get("paved") == "max":
            traits.append("le plus goudronné")
        if c.get("paved") == "min":
            traits.append("le moins goudronné")
        if c.get("bus_only"):
            traits.append("le seul avec un arrêt de bus directement sur le parcours")
        n = c["n"]
        if traits:
            s.append(f"Comparé aux {n} {word} les plus proches, c'est {join(traits, 'fr')}.")
        else:
            s.append(f"Parmi les {n} {word} les plus proches, il n'est ni le plus long ni le plus court, "
                     f"et ses {f['gain']} m de dénivelé ne sont pas un extrême non plus.")
        g = c["nearest"]
        s.append(f"Le plus proche, {link(g)} (à {self.n(g['dist'])} km), fait {self.n(g['length'])} km "
                 f"pour {g['gain']} m de dénivelé.")
        if c.get("shorter") and c["shorter"] is not g:
            x = c["shorter"]
            s.append(f"Plus court à proximité : {link(x)}, {self.n(x['length'])} km.")
        if c.get("longer") and c["longer"] is not g:
            x = c["longer"]
            s.append(f"Plus long à proximité : {link(x)}, {self.n(x['length'])} km.")
        return s

    def bus(self):
        f, s = self.f, []
        stops = f["stops"]
        if not stops:
            return ["Aucun arrêt de bus n'a été trouvé à moins de 1,2 km du parcours."]
        st = stops[0]
        lines = lines_of(st)
        lw = f" (ligne{'s' if len(lines) > 1 else ''} {', '.join(esc(x) for x in lines)})" if lines else ""
        if st["dist_m"] <= BUS_ON_ROUTE_M:
            s.append(f"L'arrêt {esc(st['name'])} se trouve directement sur le parcours{lw}.")
        elif st["dist_m"] <= STOP_FAR_M:
            s.append(f"L'arrêt le plus proche est {esc(st['name'])}, à {st['dist_m']} m du parcours{lw}.")
        else:
            s.append(f"L'arrêt le plus proche, {esc(st['name'])}, est à {st['dist_m']} m du parcours{lw} : "
                     f"prévoyez cette marche en plus.")
        return s

    def meta(self):
        f = self.f
        noun = "Circuit VTT" if self.mtb else "Boucle"
        parts = [f"{noun} de {self.n(f['length'])} km, {f['gain']} m de dénivelé, env. {self.d} h."]
        if f["villages"]:
            parts.append(f"Par {join([vname(v, 'fr') for v in f['villages'][:2]], 'fr')}.")
        if f["forest"] is not None:
            parts.append(f"{self.p(f['vineyard'])} de vignes." if f["vineyard"] >= 20
                         else f"{self.p(f['forest'])} de forêt.")
        parts.append("Carte, GPX, arrêts de bus.")
        return parts


class Lb(Text):
    lang = "lb"

    def overview(self):
        f = self.f
        noun = "MTB-Ronn" if self.mtb else "Ronn"
        s = [f"Dës {noun} ronderëm {self.place()} {REGION_IN['lb'][f['region']]} ass {self.n(f['length'])} km laang."]
        an = lb_n("an", str(f["emax"]))
        if f["emin"] is not None and f["gain"] >= 40:
            s.append(f"Am Ganze sinn et {f['gain']} Héichtemeter, an de Wee läit tëscht {f['emin']} {an} "
                     f"{f['emax']} m iwwer dem Mieresspigel.")
        elif f["emin"] is not None:
            s.append(f"D’Ronn ass bal flaach: de ganze Wee läit tëscht {f['emin']} {an} {f['emax']} m iwwer dem Mieresspigel.")
        unit = "Stonn" if self.d in ("½", "1") else "Stonnen"
        s.append(f"Mam Mountainbike brauch een ongeféier {self.d} {unit}." if self.mtb
                 else f"Bei normalem Tempo brauch een ongeféier {self.d} {unit}.")
        if f["has_ctx"]:
            vs = [vname(v, "lb") for v in f["villages"]]
            if len(vs) >= 2:
                s.append(f"Nieft {self.place()} leien an der Richtung vum GPX-Track {join(vs[:6], 'lb')} um Wee.")
            elif vs:
                s.append(f"Nieft {self.place()} läit just nach {vs[0]} um Wee.")
            else:
                s.append(f"Nieft {self.place()} läit keng aner Uertschaft um Wee.")
        return s

    def route(self):
        f, s = self.f, []
        su = f["surface"]
        if su:
            s.append(self.surface_sentence())
            if su.get("unknown", 0) >= 15:
                s.append(f"Fir déi aner {self.p(su['unknown'])} ass an OpenStreetMap kee Wee agedroen. Dës Undeeler sinn also nëmmen ongeféier.")
        if f["forest"] is not None:
            land = self.land_sentence()
            if land:
                s.append(land)
            else:
                s.append("Bësch gëtt et ënnerwee bal keen" +
                         (", de gréissten Deel geet iwwer Felder a Wisen." if f["open"] >= 30 else "."))
        for w in f["follow"]:
            art = lb_n("den", self.water(w)) + " " if _masc_water(w["names"]["name"]) else "d’"
            s.append(f"Ongeféier {self.n(w['along_km'])} km laang geet de Wee laanscht {art}{self.water(w)}.")
        if f["cross"]:
            items = [(lb_n("den", self.water(w)) + " " if _masc_water(w["names"]["name"]) else "d’") + self.water(w)
                     for w in f["cross"]]
            s.append(f"Ënnerwee geet et och iwwer {join(items, 'lb')}.")
        if f["steps"]:
            s.append("Ënnerwee gëtt et eng Trap." if f["steps"] == 1 else f"Ënnerwee ginn et {f['steps']} Trapen.")
        pr = f["profile"]
        if pr and f["gain"] >= 40 and pr["climb_m"] >= 20:
            s.append(f"An der Richtung vum GPX-Track ass dat längste Stéck biergop tëscht km {self.n(pr['climb_from'])} "
                     f"a km {self.n(pr['climb_to'])}: do kommen {pr['climb_m']} Héichtemeter zesummen.")
            if pr["steep_pct"] >= 4:
                s.append(f"Am géisten ass et op de {pr['steep_m']} m ab km {self.n(pr['steep_km'])}, mat am "
                         f"Duerchschnëtt {self.p(pr['steep_pct'])} Steigung.")
            s.append(f"Den héchste Punkt ({pr['high_m']} m) ass bei km {self.n(pr['high_km'])}.")
        elif pr:
            diff = pr["high_m"] - pr["low_m"]
            s.append(f"Tëscht dem héchsten an dem déifste Punkt leien {lb_n('nëmmen', str(diff))} {diff} m.")
        return s

    def way(self):
        f, s = self.f, []
        if f["pois"]:
            items = [f"{esc(p['name'])} ({POI_KIND['lb'][p['kind']]}, {p['dist_m']} m vum Wee)" for p in f["pois"]]
            s.append(f"E puer honnert Meter vum Wee: {join(items, 'lb')}.")
        if f["churches"]:
            s.append(f"Kierchen a Kapellen um Wee: {join([esc(c['names']['name']) for c in f['churches']], 'lb')}.")
        if f["has_ctx"]:
            a = f["amenities"]
            items = []
            for key, one, many in (("bench", "Bank", "Bänken"), ("picnic", "Plaz fir ze picknicken", "Plaze fir ze picknicken"),
                                   ("shelter", "Hütt", "Hütten"), ("playground", "Spillplaz", "Spillplazen"),
                                   ("drinking_water", "Pëtz mat Drénkwaasser", "Pëtzer mat Drénkwaasser"),
                                   ("toilets", "ëffentlech Toilette", "ëffentlech Toiletten")):
                if a.get(key):
                    article = lb_n("en", one) if key == "drinking_water" else "eng"
                    items.append(f"{article} {one}" if a[key] == 1 else f"{a[key]} {many}")
            if items:
                s.append(f"Laut OpenStreetMap ginn et bis 60 m vum Wee {join(items, 'lb')}.")
            else:
                s.append("Laut OpenStreetMap gëtt et um Wee keng Bänken, keng Dëscher fir ze picknicken a keng Hütten.")
            if f["food"]:
                items = [f"{esc(x['name'])} ({food_kind(x, self.lang)}km {self.n(x['km'])})"
                         for x in f["food"][:4]]
                s.append(f"Iessen an drénken direkt um Wee: {join(items, 'lb')}.")
            else:
                s.append("Direkt um Wee gëtt et kee Restaurant a kee Café.")
        return s

    def when(self):
        f, s = self.f, []
        if not f["has_ctx"]:
            return s
        su = f["surface"]
        unpaved = su.get("track", 0) + su.get("path", 0)
        if f["forest"] >= 50:
            s.append(f"Well {self.p(f['forest'])} vum Wee duerch de Bësch féieren, ass et dacks schiedeg. Dat hëlleft, wann et waarm ass.")
        elif f["forest"] < 15:
            s.append("Et gëtt wéineg Schiet. Wann et waarm ass, gitt Dir besser moies oder owes.")
        if unpaved >= 60:
            s.append(f"{self.p(unpaved)} vun der Streck sinn net asphaltéiert. No Reen an am Wanter kann et do matscheg sinn"
                     + ("; passt op rutscheg Stécker op." if self.mtb else "; gutt Schong hëllefen."))
        elif su.get("paved", 0) >= 70:
            s.append("Well de Wee meeschtens asphaltéiert ass, kann een och nom Reen ouni Problem goen.")
        if f["vineyard"] >= 10:
            s.append("D’Drauwelies an de Wéngerten um Wee ass meeschtens am September an Oktober.")
        if f["orchard"] >= 5:
            s.append("D’Bongerten um Wee bléien am Fréijoer, meeschtens am Abrëll.")
        return s

    def comparison(self):
        f, s = self.f, []
        c = compare(f)
        if not c:
            return s
        word = "Touren" if self.mtb else "Ronnen"
        n = c["n"]
        count = {3: "dräi", 4: "véier", 5: "fënnef"}.get(n, str(n))
        group = f"{lb_n('den', count)} {count} nooste {word}"
        if c.get("length") in ("max", "min"):
            adj = "laang" if c["length"] == "max" else "kuerz"
            s.append(f"Keng vun {group} ass esou {adj} wéi dës.")
        more = []
        if c.get("gain") == "max":
            more.append("déi meescht Héichtemeter")
        if c.get("gain") == "min":
            more.append("déi mannst Héichtemeter")
        if c.get("forest") == "max":
            more.append("de meeschte Bësch")
        if c.get("forest") == "min":
            more.append("de mannste Bësch")
        if c.get("paved") == "max":
            more.append("de meeschten Asphalt")
        if c.get("paved") == "min":
            more.append("de mannsten Asphalt")
        if more:
            s.append(f"Am Verglach mat {group} huet dës {join(more, 'lb')}.")
        if c.get("bus_only"):
            s.append(f"Et ass déi eenzeg vun dëse {word} mat engem Busarrêt direkt um Wee.")
        if not s:
            s.append(f"Ënnert {group} ass dës weder ganz laang nach ganz kuerz, an hir "
                     f"{f['gain']} Héichtemeter sinn och net extrem.")
        g = c["nearest"]
        s.append(f"Am noosten ass {link(g)} ({self.n(g['dist'])} km ewech), mat {self.n(g['length'])} km "
                 f"{lb_n('an', str(g['gain']))} {g['gain']} Héichtemeter.")
        if c.get("shorter") and c["shorter"] is not g:
            x = c["shorter"]
            s.append(f"Méi kuerz an der Géigend: {link(x)}, {self.n(x['length'])} km.")
        if c.get("longer") and c["longer"] is not g:
            x = c["longer"]
            s.append(f"Méi laang an der Géigend: {link(x)}, {self.n(x['length'])} km.")
        return s

    def bus(self):
        f, s = self.f, []
        stops = f["stops"]
        if not stops:
            return ["Bis 1,2 km vun der Streck gouf keen Arrêt fonnt."]
        st = stops[0]
        lines = lines_of(st)
        lw = f" (Linn{'en' if len(lines) > 1 else ''} {', '.join(esc(x) for x in lines)})" if lines else ""
        if st["dist_m"] <= BUS_ON_ROUTE_M:
            s.append(f"{lb_n('Den', 'A')} Arrêt {esc(st['name'])} ass direkt um Wee{lw}.")
        elif st["dist_m"] <= STOP_FAR_M:
            s.append(f"Deen noosten Arrêt ass {esc(st['name'])}, {st['dist_m']} m vum Wee{lw}.")
        else:
            s.append(f"Deen noosten Arrêt, {esc(st['name'])}, ass {st['dist_m']} m vum Wee ewech{lw}. "
                     f"Dee Wee kënnt also nach dobäi.")
        return s

    def meta(self):
        f = self.f
        noun = "MTB-Ronn" if self.mtb else "Ronn"
        parts = [f"{noun}, {self.n(f['length'])} km, {f['gain']} Héichtemeter, ongeféier {self.d} h."]
        if f["villages"]:
            parts.append(f"Iwwer {join([vname(v, 'lb') for v in f['villages'][:2]], 'lb')}.")
        if f["forest"] is not None:
            parts.append(f"{self.p(f['vineyard'])} Wéngerten." if f["vineyard"] >= 20
                         else f"{self.p(f['forest'])} Bësch.")
        parts.append("Kaart, GPX, Busarrêten.")
        return parts


TEXTS = {"en": En, "de": De, "fr": Fr, "lb": Lb}
META_MAX = 160


def _plain(html_text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", html_text))


def compose(facts: dict, lang: str, cat_key: str, duration: str) -> dict:
    """Sections of HTML paragraphs, highlights, teaser and meta description."""
    t = TEXTS[lang](facts, cat_key, duration)
    titles = SECTION_TITLES[lang]
    sections = [
        {"key": "overview", "title": "", "paras": [" ".join(t.overview())]},
        {"key": "route", "title": titles["ride_route" if cat_key == "mtb" else "route"], "paras": [" ".join(t.route())]},
        {"key": "way", "title": titles["way"], "paras": [" ".join(t.way())]},
        {"key": "when", "title": titles["when"], "paras": [" ".join(t.when())]},
        {"key": "compare", "title": titles["compare"], "paras": [" ".join(t.comparison())]},
    ]
    sections = [s for s in sections if any(p.strip() for p in s["paras"])]

    meta_parts = t.meta()
    meta = ""
    for part in meta_parts:
        candidate = (meta + " " + part).strip()
        if len(_plain(candidate)) > META_MAX:
            continue
        meta = candidate
    highlights = [esc(p["name"]) for p in facts["pois"][:2]]
    pr = facts["profile"]
    hl_words = {
        "de": ("Höchster Punkt {} m", "{} Wald", "{} Weinberge", "Haltestelle direkt am Weg"),
        "fr": ("Point culminant {} m", "{} de forêt", "{} de vignes", "Arrêt de bus sur le parcours"),
        "en": ("Highest point {} m", "{} woodland", "{} vineyards", "Bus stop right on the route"),
        "lb": ("Héchste Punkt {} m", "{} Bësch", "{} Wéngerten", "Busarrêt direkt um Wee"),
    }[lang]
    for w in facts["follow"][:1]:
        highlights.append(esc(w["names"].get(lang) or w["names"]["name"]))
    if pr:
        highlights.append(hl_words[0].format(pr["high_m"]))
    if facts["forest"] is not None:
        if facts["vineyard"] >= 20:
            highlights.append(hl_words[2].format(pct(facts["vineyard"], lang)))
        else:
            highlights.append(hl_words[1].format(pct(facts["forest"], lang)))
    if facts["stops"] and facts["stops"][0]["dist_m"] <= BUS_ON_ROUTE_M:
        highlights.append(hl_words[3])
    via = [vname(v, lang) for v in facts["villages"][:2]]
    teaser_bits = []
    if via:
        teaser_bits.append({"de": "Über ", "fr": "Par ", "en": "Via ", "lb": "Iwwer "}[lang] + join(via, lang))
    if facts["forest"] is not None:
        teaser_bits.append(hl_words[2].format(pct(facts["vineyard"], lang)) if facts["vineyard"] >= 20
                           else hl_words[1].format(pct(facts["forest"], lang)))
    via_text = teaser_bits[0] if via else ""
    teaser = " · ".join(teaser_bits) or (highlights[0] if highlights else "")
    return {"sections": sections, "highlights": highlights[:5], "teaser": teaser, "via": via_text, "meta": meta,
            "bus_html": " ".join(t.bus())}
