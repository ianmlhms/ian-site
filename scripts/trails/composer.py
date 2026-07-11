"""Compose trail descriptions from real facts for trails without curated text.

Every sentence is built from the trail's own data — region, place name,
measured length, elevation gain, path share, POIs actually on the route —
so no two pages read the same. Variant sentences are chosen deterministically
per trail (hash of slug), so rebuilds are stable.

Curated texts in data/trails/curated.json always win over composed ones.
"""
from __future__ import annotations

import hashlib

FLAT_GAIN_M = 120
HILLY_GAIN_M = 300
BUS_ON_ROUTE_M = 150
KIND_PRIORITY = {"castle": 0, "ruins": 1, "waterfall": 2, "viewpoint": 3, "museum": 4, "nature_reserve": 5}


def duration_label(length_km: float, elev_gain: int = 0) -> str:
    """Naismith-ish walking time, rounded to half hours: '2½', '3', '½'."""
    hours = length_km / 4.0 + (elev_gain or 0) / 600.0
    halves = max(1, round(hours * 2))
    whole, half = divmod(halves, 2)
    if whole == 0:
        return "½"
    return f"{whole}½" if half else str(whole)


def auto_difficulty(length_km: float, elev_gain: int) -> str:
    if length_km >= 12 or (elev_gain or 0) >= 400:
        return "hard"
    if length_km < 7 and (elev_gain or 0) < FLAT_GAIN_M:
        return "easy"
    return "moderate"


def _pick(slug: str, key: str, options: list):
    digest = hashlib.md5(f"{slug}:{key}".encode()).hexdigest()
    return options[int(digest, 16) % len(options)]


OPENERS = {
    "de": {
        "eislek": [
            "Rund um {p} zeigt sich das Éislek von seiner typischen Seite: tiefe Täler, bewaldete Kämme und weite Blicke über die Ardennenlandschaft im Norden Luxemburgs.",
            "Diese Autopédestre erkundet die Umgebung von {p} im Éislek, dem hügeligen Norden Luxemburgs mit seinen stillen Wäldern und tief eingeschnittenen Flusstälern.",
            "{p} liegt mitten im Éislek — die Runde führt durch die für den Luxemburger Norden typische Mischung aus Höhenrücken, Wald und offenen Weiden.",
        ],
        "mullerthal": [
            "Bei {p} wandert man am Rand der Müllerthal-Region, der „Kleinen Luxemburger Schweiz“ mit ihren Sandsteinfelsen und bewaldeten Bachtälern.",
            "Diese Autopédestre erkundet die Gegend um {p} in der Müllerthal-Region, wo Sandstein, Wald und kleine Bäche die Landschaft prägen.",
            "{p} gehört zur Müllerthal-Region im Osten Luxemburgs — felsige Abschnitte, schattige Wälder und ruhige Feldpassagen wechseln sich auf dieser Runde ab.",
        ],
        "moselle": [
            "Rund um {p} prägen Weinberge und weite Blicke über das Moseltal die Landschaft — die Runde verbindet Rebhänge, Plateauwege und stille Seitentäler.",
            "Diese Autopédestre erkundet die Umgebung von {p} an der Luxemburger Mosel, zwischen Rebzeilen, Obstwiesen und Ausblicken zum deutschen Ufer.",
            "{p} liegt in der Moselregion im Südosten Luxemburgs; die Runde wechselt zwischen Weinbergen, Feldern und kurzen Waldstücken.",
        ],
        "minett": [
            "Rund um {p} zeigt der Minett, der Süden Luxemburgs, seine grüne Seite: Auf ehemaligem Bergbaugelände sind Wälder und artenreiche Brachen entstanden.",
            "Diese Autopédestre erkundet die Gegend um {p} in den Roten Erden, wo die Natur die Spuren des Eisenerzabbaus zurückerobert hat.",
            "{p} gehört zum Minett im Süden des Landes — die Runde verbindet Wald, offene Flur und Erinnerungen an die Industriegeschichte der Region.",
        ],
        "center": [
            "Rund um {p} im Zentrum Luxemburgs wandert man durchs Guttland: sanfte Hügel, Felder, Bachtäler und immer wieder Wald.",
            "Diese Autopédestre erkundet die Umgebung von {p} im Guttland, der abwechslungsreichen Mitte des Landes zwischen Feldern und Wäldern.",
            "{p} liegt im Guttland — auf dieser Runde wechseln sich ruhige Feldwege, Waldstücke und Dorfränder ab.",
        ],
    },
    "fr": {
        "eislek": [
            "Autour de {p}, l'Éislek se montre sous son jour typique : vallées profondes, crêtes boisées et larges vues sur les Ardennes luxembourgeoises.",
            "Cette Auto-Pédestre explore les environs de {p}, dans l'Éislek, le nord vallonné du Luxembourg aux forêts calmes et aux vallées encaissées.",
            "{p} se trouve en plein Éislek — la boucle traverse ce mélange de crêtes, de forêts et de pâturages typique du nord du pays.",
        ],
        "mullerthal": [
            "Près de {p}, on marche aux portes de la région du Mullerthal, la « Petite Suisse luxembourgeoise », avec ses rochers de grès et ses vallons boisés.",
            "Cette Auto-Pédestre explore les alentours de {p}, dans la région du Mullerthal, où grès, forêts et petits ruisseaux façonnent le paysage.",
            "{p} appartient à la région du Mullerthal, à l'est du Luxembourg — passages rocheux, forêts ombragées et tronçons champêtres s'y succèdent.",
        ],
        "moselle": [
            "Autour de {p}, vignobles et vues sur la vallée de la Moselle dominent — la boucle relie coteaux, chemins de plateau et vallons tranquilles.",
            "Cette Auto-Pédestre parcourt les environs de {p}, sur la Moselle luxembourgeoise, entre rangs de vigne, vergers et échappées vers la rive allemande.",
            "{p} se situe dans la région de la Moselle, au sud-est du pays ; la boucle alterne vignes, champs et petits bois.",
        ],
        "minett": [
            "Autour de {p}, le Minett, le sud du Luxembourg, montre son visage vert : forêts et friches riches en espèces ont recouvert les anciens sites miniers.",
            "Cette Auto-Pédestre explore les alentours de {p}, dans les Terres Rouges, où la nature a repris les traces de l'extraction du minerai de fer.",
            "{p} fait partie du Minett, au sud du pays — la boucle mêle forêts, campagne ouverte et mémoire industrielle.",
        ],
        "center": [
            "Autour de {p}, au centre du Luxembourg, on traverse le Guttland : collines douces, champs, vallons et forêts en alternance.",
            "Cette Auto-Pédestre explore les environs de {p}, dans le Guttland, le cœur varié du pays entre champs et bois.",
            "{p} se trouve dans le Guttland — chemins champêtres, passages en forêt et abords de village rythment la boucle.",
        ],
    },
    "en": {
        "eislek": [
            "Around {p} the Éislek shows its classic face: deep valleys, wooded ridges and wide views over Luxembourg's Ardennes.",
            "This Auto-Pédestre explores the surroundings of {p} in the Éislek, Luxembourg's hilly north of quiet forests and deeply cut river valleys.",
            "{p} sits in the heart of the Éislek — the loop crosses the mix of ridgelines, forest and open pasture typical of the country's north.",
        ],
        "mullerthal": [
            "Near {p} you walk on the edge of the Mullerthal region, Luxembourg's 'Little Switzerland' of sandstone rocks and wooded stream valleys.",
            "This Auto-Pédestre explores the area around {p} in the Mullerthal region, where sandstone, forest and small streams shape the landscape.",
            "{p} belongs to the Mullerthal region in Luxembourg's east — rocky passages, shaded woods and quiet field sections take turns on this loop.",
        ],
        "moselle": [
            "Around {p}, vineyards and views over the Moselle valley set the scene — the loop links vine slopes, plateau tracks and quiet side valleys.",
            "This Auto-Pédestre tours the surroundings of {p} on the Luxembourg Moselle, between vine rows, orchards and glimpses across to the German bank.",
            "{p} lies in the Moselle region in the country's south-east; the loop alternates between vines, fields and short stretches of woodland.",
        ],
        "minett": [
            "Around {p} the Minett — Luxembourg's south — shows its green side: forests and species-rich heath have reclaimed the former mining land.",
            "This Auto-Pédestre explores the area around {p} in the Red Rocks region, where nature has taken back the traces of iron-ore mining.",
            "{p} is part of the Minett in the south of the country — the loop combines woodland, open country and echoes of the region's industrial past.",
        ],
        "center": [
            "Around {p}, in central Luxembourg, you cross the Guttland: gentle hills, fields, stream valleys and stretches of forest.",
            "This Auto-Pédestre explores the surroundings of {p} in the Guttland, the varied heart of the country between fields and woods.",
            "{p} lies in the Guttland — quiet farm tracks, woodland passages and village edges give this loop its rhythm.",
        ],
    },
}

LENGTH_SENTENCES = {
    "de": [
        "Die Schleife ist {l} km lang; mit normalem Tempo ist man etwa {d} Stunden unterwegs.",
        "Mit {l} km Länge ist die Runde in rund {d} Stunden zu schaffen.",
        "Der Rundweg misst {l} km — je nach Tempo etwa {d} Stunden Gehzeit.",
    ],
    "fr": [
        "La boucle fait {l} km ; comptez environ {d} h de marche à allure normale.",
        "Avec ses {l} km, le circuit se parcourt en {d} h environ.",
        "Le parcours mesure {l} km — soit environ {d} h de marche selon le rythme.",
    ],
    "en": [
        "The loop is {l} km long; at a normal pace expect about {d} hours.",
        "At {l} km, the circuit takes roughly {d} hours.",
        "The route measures {l} km — about {d} hours of walking, depending on pace.",
    ],
}

NATURE_CLAUSES = {
    "de": [", und der größte Teil der Strecke verläuft auf Wald- und Feldwegen",
           ", gut die Hälfte der Strecke verläuft abseits von Straßen",
           ", die Runde nutzt teils ruhige Sträßchen, teils Feld- und Waldwege"],
    "fr": [", et la plus grande partie du tracé suit des chemins forestiers et agricoles",
           ", environ la moitié du tracé évite le bitume",
           ", le tracé combine petites routes calmes et chemins"],
    "en": [", and most of the way follows forest and field tracks",
           ", with about half the distance away from tarmac",
           ", mixing quiet lanes with field and forest paths"],
}

TERRAIN_SENTENCES = {
    "de": {"flat": "Nennenswerte Steigungen gibt es kaum{nat}.",
           "rolling": "Unterwegs kommen rund {g} Höhenmeter zusammen{nat}.",
           "hilly": "Mit etwa {g} Höhenmetern ist die Runde spürbar hügelig{nat}."},
    "fr": {"flat": "Le dénivelé reste insignifiant{nat}.",
           "rolling": "Le parcours cumule environ {g} m de dénivelé{nat}.",
           "hilly": "Avec quelque {g} m de dénivelé, la boucle est nettement vallonnée{nat}."},
    "en": {"flat": "There is barely any climbing{nat}.",
           "rolling": "The route gathers about {g} m of ascent{nat}.",
           "hilly": "With some {g} m of climbing, the loop is distinctly hilly{nat}."},
}

POI_SENTENCES = {
    "de": {"one": ["Unterwegs kommt man an {a} vorbei.", "Am Weg liegt {a}."],
           "two": ["Unterwegs kommt man unter anderem an {a} und {b} vorbei.",
                    "Am Weg liegen unter anderem {a} und {b}.",
                    "Sehenswert am Weg: {a} und {b}."]},
    "fr": {"one": ["En chemin, on passe près de {a}.", "Sur le parcours : {a}."],
           "two": ["En chemin, on passe notamment près de {a} et de {b}.",
                    "Sur le parcours, entre autres : {a} et {b}.",
                    "À voir en chemin : {a} et {b}."]},
    "en": {"one": ["Along the way you pass {a}.", "On the route: {a}."],
           "two": ["Along the way you pass {a} and {b}, among other sights.",
                    "On the route, among others: {a} and {b}.",
                    "Worth a look en route: {a} and {b}."]},
}

LANDSCAPE_SENTENCES = {
    "de": ["Die Strecke verläuft überwiegend auf naturnahen Wegen durch Wald und Flur.",
           "Feld- und Waldwege wechseln sich mit ruhigen Nebenstraßen ab.",
           "Die Runde verbindet auf kleinen Wegen die schönsten Ecken rund um den Ort."],
    "fr": ["Le tracé suit surtout des chemins proches de la nature, entre bois et campagne.",
           "Chemins agricoles et forestiers alternent avec de calmes routes secondaires.",
           "Par de petits chemins, la boucle relie les plus beaux coins des alentours."],
    "en": ["The route mostly follows near-natural paths through woods and open country.",
           "Field and forest tracks alternate with quiet back roads.",
           "On small paths, the loop links the prettiest corners around the village."],
}

PRACTICAL_SENTENCES = {
    "de": ["Wie alle Autopédestres ist die Runde dauerhaft mit dem blauen Symbol markiert und lässt sich an jedem Punkt beginnen.",
           "Markiert ist die Schleife durchgehend mit dem blauen Autopédestre-Zeichen; als Rundweg hat sie keinen festen Startpunkt."],
    "fr": ["Comme toutes les Auto-Pédestres, la boucle est balisée en permanence du symbole bleu et peut se commencer n'importe où.",
           "Le circuit est entièrement balisé du signe bleu des Auto-Pédestres ; en boucle, il n'a pas de départ imposé."],
    "en": ["Like every Auto-Pédestre, the loop is permanently waymarked with the blue symbol and can be started at any point.",
           "The circuit carries the blue Auto-Pédestre waymark throughout; being a loop, it has no fixed start."],
}

HIGHLIGHT_LABELS = {
    "de": {"gain": "{g} Höhenmeter", "flat": "Kaum Steigungen", "natural": "Überwiegend Wald- und Feldwege",
           "bus": "Bushaltestelle direkt am Weg"},
    "fr": {"gain": "{g} m de dénivelé", "flat": "Très peu de dénivelé", "natural": "Surtout chemins forestiers et agricoles",
           "bus": "Arrêt de bus sur le parcours"},
    "en": {"gain": "{g} m of climbing", "flat": "Barely any climbing", "natural": "Mostly forest and field tracks",
           "bus": "Bus stop right on the route"},
}

REGION_HIGHLIGHT = {
    "de": {"eislek": "Éislek-Landschaft", "mullerthal": "Müllerthal-Region", "moselle": "Moselregion",
           "minett": "Minett – Rote Erde", "center": "Guttland"},
    "fr": {"eislek": "Paysages de l'Éislek", "mullerthal": "Région du Mullerthal", "moselle": "Région de la Moselle",
           "minett": "Minett – Terres Rouges", "center": "Guttland"},
    "en": {"eislek": "Éislek landscape", "mullerthal": "Mullerthal region", "moselle": "Moselle region",
           "minett": "Minett – Red Rocks", "center": "Guttland"},
}


def _fmt_len(length_km: float, lang: str) -> str:
    return f"{length_km:g}".replace(".", "," if lang != "en" else ".")


def _sorted_pois(entry: dict) -> list:
    pois = entry.get("pois") or []
    return sorted(pois, key=lambda p: (KIND_PRIORITY.get(p["kind"], 9), p["dist_m"]))


def compose(trail: dict, entry: dict, region: str, lang: str) -> dict:
    """Return {"paragraphs": [p1, p2], "highlights": [...]} from facts."""
    slug, place = trail["slug"], trail["place"]
    gain = entry.get("elev_gain") or 0
    natural = entry.get("natural_pct") or 0
    band = "flat" if gain < FLAT_GAIN_M else ("hilly" if gain >= HILLY_GAIN_M else "rolling")
    nat_idx = 0 if natural >= 70 else (1 if natural >= 40 else 2)

    opener = _pick(slug, f"open-{lang}", OPENERS[lang][region]).format(p=place)
    length_s = _pick(slug, f"len-{lang}", LENGTH_SENTENCES[lang]).format(
        l=_fmt_len(entry["length_km"], lang), d=duration_label(entry["length_km"], gain))
    terrain_s = TERRAIN_SENTENCES[lang][band].format(g=gain, nat=NATURE_CLAUSES[lang][nat_idx])
    paragraph1 = f"{opener} {length_s} {terrain_s}"

    pois = _sorted_pois(entry)
    if len(pois) >= 2:
        poi_s = _pick(slug, f"poi-{lang}", POI_SENTENCES[lang]["two"]).format(a=pois[0]["name"], b=pois[1]["name"])
    elif len(pois) == 1:
        poi_s = _pick(slug, f"poi-{lang}", POI_SENTENCES[lang]["one"]).format(a=pois[0]["name"])
    else:
        poi_s = _pick(slug, f"land-{lang}", LANDSCAPE_SENTENCES[lang])
    practical_s = _pick(slug, f"prak-{lang}", PRACTICAL_SENTENCES[lang])
    paragraph2 = f"{poi_s} {practical_s}"

    labels = HIGHLIGHT_LABELS[lang]
    highlights = [p["name"] for p in pois[:2]]
    if gain >= 250:
        highlights.append(labels["gain"].format(g=gain))
    elif gain and gain < 100:
        highlights.append(labels["flat"])
    if natural >= 70:
        highlights.append(labels["natural"])
    stops = entry.get("bus_stops") or []
    if stops and stops[0]["dist_m"] <= BUS_ON_ROUTE_M:
        highlights.append(labels["bus"])
    if len(highlights) < 3:
        highlights.append(REGION_HIGHLIGHT[lang][region])
    return {"paragraphs": [paragraph1, paragraph2], "highlights": highlights[:4]}
