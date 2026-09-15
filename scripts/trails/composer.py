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


def _pick(slug: str, key: str, options: list):
    digest = hashlib.md5(f"{slug}:{key}".encode()).hexdigest()
    return options[int(digest, 16) % len(options)]


OPENERS = {
    "de": {
        "eislek": [
            "Rund um {p} zeigt sich das Éislek von seiner typischen Seite: tiefe Täler, bewaldete Kämme und weite Blicke über die Ardennenlandschaft im Norden Luxemburgs.",
            "Auf dieser Runde erkundet man die Umgebung von {p} im Éislek, dem hügeligen Norden Luxemburgs mit seinen stillen Wäldern und tief eingeschnittenen Flusstälern.",
            "{p} liegt mitten im Éislek — die Runde führt durch die für den Luxemburger Norden typische Mischung aus Höhenrücken, Wald und offenen Weiden.",
        ],
        "mullerthal": [
            "Bei {p} wandert man am Rand der Müllerthal-Region, der „Kleinen Luxemburger Schweiz“ mit ihren Sandsteinfelsen und bewaldeten Bachtälern.",
            "Auf dieser Runde erkundet man die Gegend um {p} in der Müllerthal-Region, wo Sandstein, Wald und kleine Bäche die Landschaft prägen.",
            "{p} gehört zur Müllerthal-Region im Osten Luxemburgs — felsige Abschnitte, schattige Wälder und ruhige Feldpassagen wechseln sich auf dieser Runde ab.",
        ],
        "moselle": [
            "Rund um {p} prägen Weinberge und weite Blicke über das Moseltal die Landschaft — die Runde verbindet Rebhänge, Plateauwege und stille Seitentäler.",
            "Auf dieser Runde erkundet man die Umgebung von {p} an der Luxemburger Mosel, zwischen Rebzeilen, Obstwiesen und Ausblicken zum deutschen Ufer.",
            "{p} liegt in der Moselregion im Südosten Luxemburgs; die Runde wechselt zwischen Weinbergen, Feldern und kurzen Waldstücken.",
        ],
        "minett": [
            "Rund um {p} zeigt der Minett, der Süden Luxemburgs, seine grüne Seite: Auf ehemaligem Bergbaugelände sind Wälder und artenreiche Brachen entstanden.",
            "Auf dieser Runde erkundet man die Gegend um {p} in den Roten Erden, wo die Natur die Spuren des Eisenerzabbaus zurückerobert hat.",
            "{p} gehört zum Minett im Süden des Landes — die Runde verbindet Wald, offene Flur und Erinnerungen an die Industriegeschichte der Region.",
        ],
        "center": [
            "Rund um {p} im Zentrum Luxemburgs wandert man durchs Guttland: sanfte Hügel, Felder, Bachtäler und immer wieder Wald.",
            "Auf dieser Runde erkundet man die Umgebung von {p} im Guttland, der abwechslungsreichen Mitte des Landes zwischen Feldern und Wäldern.",
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
    "lb": {
        "eislek": [
            "Ronderëm {p} gesäit een déi typesch Landschaft vum Éislek: déif Däller, Bëscher a fräi Siichten iwwer d’Hiwwelen am Norde vu Lëtzebuerg.",
            "Dës Ronn féiert duerch d’Géigend ronderëm {p} am Éislek, mat senge Bëscher an déiwen Däller.",
            "{p} läit am Éislek. Op dëser Ronn geet et iwwer d’Hiwwelen, duerch de Bësch a laanscht d’Weeden."
        ],
        "mullerthal": [
            "Bei {p} féiert d’Wanderung duerch de Mëllerdall, déi Kleng Lëtzebuerger Schwäiz mat hire Sandsteenfielsen a Bëscher laanscht d’Baachen.",
            "Dës Ronn féiert duerch d’Géigend ronderëm {p} am Mëllerdall, wou Sandsteen, Bësch a kleng Baachen d’Landschaft prägen.",
            "{p} läit an der Regioun Mëllerdall am Oste vu Lëtzebuerg. Op dëser Ronn geet et laanscht Fielsen, duerch de Bësch an iwwer d’Felder."
        ],
        "moselle": [
            "Ronderëm {p} prägen d’Wéngerten an d’Siicht op de Museldall d’Landschaft. D’Ronn féiert iwwer d’Héichten an duerch roueg Säitendäller.",
            "Dës Ronn féiert duerch d’Géigend ronderëm {p} un der Musel, laanscht Wéngerten an Uebstbeem, mat Blécker op déi däitsch Säit.",
            "{p} läit an der Muselregioun am Südoste vu Lëtzebuerg. Op dëser Ronn geet et laanscht Wéngerten, iwwer d’Felder an duerch de Bësch."
        ],
        "minett": [
            "Ronderëm {p} am Minett ass et gréng: Do, wou fréier Minett ofgebaut gouf, wuessen haut Beem a vill verschidde Planzen.",
            "Dës Ronn féiert duerch d’Géigend ronderëm {p} am Minett, wou haut nees Planzen op de fréieren Ofbaugebidder wuessen.",
            "{p} läit am Minett am Süde vum Land. D’Ronn féiert duerch de Bësch an iwwer oppe Flächen, laanscht Spuere vun der Industriegeschicht."
        ],
        "center": [
            "Ronderëm {p} féiert d’Wanderung duerch d’Guttland: iwwer Hiwwelen a Felder, laanscht Baachen an duerch de Bësch.",
            "Dës Ronn féiert duerch d’Géigend ronderëm {p} am Guttland, tëscht Felder a Bëscher an der Mëtt vum Land.",
            "{p} läit am Guttland. Op dëser Ronn entdeckt een d’Géigend zu Fouss."
        ]
    },
}

LENGTH_SENTENCES = {
    "de": [
        "Die Schleife ist {l} km lang; mit normalem Tempo ist man etwa {d} {h} unterwegs.",
        "Mit {l} km Länge ist die Runde in rund {d} {h} zu schaffen.",
        "Der Rundweg misst {l} km — je nach Tempo etwa {d} {h} Gehzeit.",
    ],
    "fr": [
        "La boucle fait {l} km ; comptez environ {d} h de marche à allure normale.",
        "Avec ses {l} km, le circuit se parcourt en {d} h environ.",
        "Le parcours mesure {l} km — soit environ {d} h de marche selon le rythme.",
    ],
    "en": [
        "The loop is {l} km long; at a normal pace expect about {d} {h}.",
        "At {l} km, the circuit takes roughly {d} {h}.",
        "The route measures {l} km — about {d} {h} of walking, depending on pace.",
    ],
    "lb": [
        "D’Ronn ass {l} km laang. Bei normalem Tempo ass een ongeféier {d} {h} ënnerwee.",
        "Fir dës Ronn ({l} km) brauch een ongeféier {d} {h}.",
        "De Wee ass {l} km laang. Jee nom Tempo dauert d’Wanderung ongeféier {d} {h}."
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
    "lb": [
        ", an de gréissten Deel vum Wee féiert duerch de Bësch an iwwer Feldweeër",
        ", an ongeféier d’Hallschent vum Wee ass net asphaltéiert",
        ", an d’Ronn féiert deels iwwer roueg Stroossen, deels iwwer Feldweeër a Bëschweeër"
    ],
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
    "lb": {
        "flat": "Et geet kaum biergop{nat}.",
        "rolling": "Ënnerwee kommen ongeféier {g} Héichtemeter zesummen{nat}.",
        "hilly": "Mat ongeféier {g} Héichtemeter geet et op dëser Ronn dacks biergop a biergof{nat}."
    },
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
    "lb": {
        "one": [
            "Ënnerwee ze gesinn: {a}.",
            "Um Wee: {a}."
        ],
        "two": [
            "Ënnerwee ze gesinn: {a} an {b}.",
            "Um Wee, ënner anerem: {a} an {b}.",
            "Op dëser Ronn ze gesinn: {a} an {b}."
        ]
    },
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
    "lb": [
        "De Wee féiert virun allem duerch de Bësch an iwwer d’Felder.",
        "Feldweeër a Bëschweeër wiessele sech mat rouegen Niewestroossen of.",
        "Iwwer kleng Weeër entdeckt een op dëser Ronn d’Géigend ronderëm d’Uertschaft."
    ],
}

PRACTICAL_SENTENCES = {
    "de": ["Wie alle Autopédestres ist die Runde dauerhaft mit dem blauen Symbol markiert und lässt sich an jedem Punkt beginnen.",
           "Markiert ist die Schleife durchgehend mit dem blauen Autopédestre-Zeichen; als Rundweg hat sie keinen festen Startpunkt."],
    "fr": ["Comme tous les Auto-Pédestres, la boucle est balisée en permanence du symbole bleu et peut se commencer n'importe où.",
           "Le circuit est entièrement balisé du signe bleu des Auto-Pédestres ; en boucle, il n'a pas de départ imposé."],
    "en": ["Like every Auto-Pédestre, the loop is permanently waymarked with the blue symbol and can be started at any point.",
           "The circuit carries the blue Auto-Pédestre waymark throughout; being a loop, it has no fixed start."],
    "lb": [
        "Wéi all Auto-Pédestre ass d’Ronn permanent mam bloe Symbol markéiert. Dir kënnt op all Punkt ufänken.",
        "D’Ronn ass iwwerall mam bloen Auto-Pédestre-Symbol markéiert. Et gëtt kee feste Startpunkt."
    ],
}

HIGHLIGHT_LABELS = {
    "de": {"gain": "{g} Höhenmeter", "flat": "Kaum Steigungen", "natural": "Überwiegend Wald- und Feldwege",
           "bus": "Bushaltestelle direkt am Weg"},
    "fr": {"gain": "{g} m de dénivelé", "flat": "Très peu de dénivelé", "natural": "Surtout chemins forestiers et agricoles",
           "bus": "Arrêt de bus sur le parcours"},
    "en": {"gain": "{g} m of climbing", "flat": "Barely any climbing", "natural": "Mostly forest and field tracks",
           "bus": "Bus stop right on the route"},
    "lb": {
        "gain": "{g} Héichtemeter",
        "flat": "Wéineg Héichtemeter",
        "natural": "Virun allem Bëschweeër a Feldweeër",
        "bus": "Busarrêt direkt um Wee"
    },
}

REGION_HIGHLIGHT = {
    "de": {"eislek": "Éislek-Landschaft", "mullerthal": "Müllerthal-Region", "moselle": "Moselregion",
           "minett": "Minett – Rote Erde", "center": "Guttland"},
    "fr": {"eislek": "Paysages de l'Éislek", "mullerthal": "Région du Mullerthal", "moselle": "Région de la Moselle",
           "minett": "Minett – Terres Rouges", "center": "Guttland"},
    "en": {"eislek": "Éislek landscape", "mullerthal": "Mullerthal region", "moselle": "Moselle region",
           "minett": "Minett – Red Rocks", "center": "Guttland"},
    "lb": {
        "eislek": "Landschaft vum Éislek",
        "mullerthal": "Regioun Mëllerdall",
        "moselle": "Muselregioun",
        "minett": "Minett — Rout Äerd",
        "center": "Guttland"
    },
}


MTB_OPENERS = {
    "de": {
        "eislek": [
            "Rund um {p} führt die Tour durch das Éislek, den bergigen Norden Luxemburgs — lange Anstiege, schnelle Waldabfahrten und weite Blicke über die Ardennenkämme.",
            "Diese MTB-Runde erkundet die Gegend um {p} im Éislek, wo tiefe Täler und bewaldete Höhenrücken für ständiges Auf und Ab sorgen.",
            "{p} liegt mitten im Éislek — die Runde nutzt die für den Norden typische Mischung aus Waldpfaden, Forstwegen und offenen Kammpassagen.",
        ],
        "mullerthal": [
            "Bei {p} fährt man durch die Müllerthal-Region: sandige Waldböden, Felspassagen in Sichtweite und ein ständiger Wechsel aus Tal und Plateau.",
            "Diese MTB-Runde erkundet die Gegend um {p} in der Müllerthal-Region, wo Sandsteinfelsen und dichte Wälder die Kulisse stellen.",
            "{p} gehört zur Müllerthal-Region im Osten Luxemburgs — die Tour verbindet flowige Waldtrails mit kurzen, knackigen Rampen.",
        ],
        "moselle": [
            "Rund um {p} rollt die Tour durch die Weinbaulandschaft der Luxemburger Mosel — Anstiege durch die Rebhänge, schnelle Plateauwege und Blicke über das Flusstal.",
            "Diese MTB-Runde erkundet die Umgebung von {p} an der Mosel: Weinberge, Feldwege auf dem Plateau und Abfahrten Richtung Fluss.",
            "{p} liegt in der Moselregion — der Anstieg aus dem Tal ist der Preis für die Aussicht, die Abfahrt die Belohnung.",
        ],
        "minett": [
            "Rund um {p} fährt man mitten durch den Minett: alte Tagebauflächen, rote Erde und ein überraschend verwinkeltes Wegenetz aus Trails und Forstwegen.",
            "Diese MTB-Runde erkundet die Gegend um {p} in den Roten Erden, wo auf ehemaligem Bergbaugelände heute einige der besten Trails des Landes liegen.",
            "{p} gehört zum Minett — kurze steile Rampen, schnelle Kurven und Industriegeschichte am Wegesrand prägen die Runde.",
        ],
        "center": [
            "Rund um {p} im Guttland rollt die Tour über Feldwege, Waldpassagen und ruhige Verbindungssträßchen — ideales Terrain, um Kilometer zu machen.",
            "Diese MTB-Runde erkundet die Umgebung von {p} im Guttland, der hügeligen Mitte des Landes zwischen Feldern und Wäldern.",
            "{p} liegt im Guttland — die Runde wechselt zwischen rollenden Feldpassagen und kurzen Waldstücken.",
        ],
    },
    "fr": {
        "eislek": [
            "Autour de {p}, le circuit traverse l'Éislek, le nord montagneux du Luxembourg — longues montées, descentes forestières rapides et larges vues sur les crêtes ardennaises.",
            "Ce circuit VTT explore les environs de {p}, dans l'Éislek, où vallées profondes et crêtes boisées imposent un constant jeu de montées et descentes.",
            "{p} se trouve en plein Éislek — le tour enchaîne sentiers forestiers, chemins d'exploitation et passages de crête typiques du nord.",
        ],
        "mullerthal": [
            "Près de {p}, on roule dans la région du Mullerthal : sols forestiers sablonneux, rochers de grès en toile de fond et alternance permanente de vallons et de plateaux.",
            "Ce circuit VTT explore les alentours de {p}, dans la région du Mullerthal, entre rochers de grès et forêts denses.",
            "{p} appartient à la région du Mullerthal — le tour combine singletracks fluides et rampes courtes et raides.",
        ],
        "moselle": [
            "Autour de {p}, le circuit parcourt le vignoble de la Moselle luxembourgeoise — montées dans les coteaux, chemins rapides sur le plateau et vues sur la vallée.",
            "Ce circuit VTT explore les environs de {p}, sur la Moselle : vignes, chemins de plateau et descentes vers le fleuve.",
            "{p} se situe dans la région de la Moselle — la montée depuis la vallée se paie, la descente récompense.",
        ],
        "minett": [
            "Autour de {p}, on roule en plein Minett : anciennes mines à ciel ouvert, terre rouge et un réseau étonnamment dense de trails et chemins forestiers.",
            "Ce circuit VTT explore les alentours de {p}, dans les Terres Rouges, où les friches minières abritent quelques-uns des meilleurs trails du pays.",
            "{p} fait partie du Minett — rampes courtes et raides, virages rapides et patrimoine industriel au bord du chemin.",
        ],
        "center": [
            "Autour de {p}, dans le Guttland, le circuit enchaîne chemins agricoles, passages forestiers et petites routes calmes — un terrain idéal pour avaler les kilomètres.",
            "Ce circuit VTT explore les environs de {p}, dans le Guttland, le centre vallonné du pays entre champs et bois.",
            "{p} se trouve dans le Guttland — le tour alterne portions champêtres roulantes et courts secteurs boisés.",
        ],
    },
    "en": {
        "eislek": [
            "Around {p} the tour crosses the Éislek, Luxembourg's mountainous north — long climbs, fast forest descents and wide views over the Ardennes ridges.",
            "This MTB loop explores the area around {p} in the Éislek, where deep valleys and wooded ridgelines keep the trail constantly rising and falling.",
            "{p} sits in the heart of the Éislek — the loop links the forest paths, gravel roads and open ridge sections typical of the north.",
        ],
        "mullerthal": [
            "Near {p} you ride through the Mullerthal region: sandy forest floor, sandstone rocks in sight and a constant switch between valley and plateau.",
            "This MTB loop explores the area around {p} in the Mullerthal region, with sandstone cliffs and dense forest as the backdrop.",
            "{p} belongs to the Mullerthal region — the tour mixes flowing forest trails with short, punchy ramps.",
        ],
        "moselle": [
            "Around {p} the tour rolls through the Luxembourg Moselle wine country — climbs through the vineyards, fast plateau tracks and views over the river valley.",
            "This MTB loop explores the surroundings of {p} on the Moselle: vines, plateau farm tracks and descents back towards the river.",
            "{p} lies in the Moselle region — the climb out of the valley is the price, the descent the reward.",
        ],
        "minett": [
            "Around {p} you ride straight through the Minett: former open-cast mines, red earth and a surprisingly intricate network of trails and forest roads.",
            "This MTB loop explores the area around {p} in the Red Rocks region, where the old mining land now hides some of the country's best trails.",
            "{p} is part of the Minett — short steep ramps, fast corners and industrial heritage beside the trail define the loop.",
        ],
        "center": [
            "Around {p}, in the Guttland, the tour rolls over farm tracks, forest sections and quiet lanes — ideal terrain for covering distance.",
            "This MTB loop explores the surroundings of {p} in the Guttland, the rolling centre of the country between fields and woods.",
            "{p} lies in the Guttland — the loop alternates between rolling farmland sections and short stretches of forest.",
        ],
    },
    "lb": {
        "eislek": [
            "Ronderëm {p} féiert den Tour duerch den Éislek am Norde vu Lëtzebuerg: laang Stécker biergop a biergof duerch de Bësch a fräi Siichten iwwer d’Hiwwelen.",
            "Dës MTB-Ronn féiert duerch d’Géigend ronderëm {p} am Éislek. Tëscht den déiwen Däller an den Héichte geet et ëmmer erëm biergop a biergof.",
            "{p} läit am Éislek. D’Ronn verbënnt schmuel Weeër a breet Bëschweeër mat oppene Passagen op den Héichten."
        ],
        "mullerthal": [
            "Bei {p} geet et mam Mountainbike duerch de Mëllerdall: iwwer sandege Buedem am Bësch, mat Fielsen an der Géigend an engem Wiessel tëscht Däller an Héichten.",
            "Dës MTB-Ronn féiert duerch d’Géigend ronderëm {p} am Mëllerdall, tëscht Sandsteenfielsen an dichte Bëscher.",
            "{p} läit an der Regioun Mëllerdall. Den Tour verbënnt schmuel Weeër am Bësch mat kuerze géie Stécker biergop."
        ],
        "moselle": [
            "Ronderëm {p} féiert den Tour duerch d’Wéngerten un der Musel. Et geet biergop op d’Héichten, mat Siichten iwwer de Museldall.",
            "Dës MTB-Ronn féiert duerch d’Géigend ronderëm {p} un der Musel: laanscht Wéngerten, iwwer Feldweeër op den Héichten an nees biergof a Richtung Floss.",
            "{p} läit an der Muselregioun. Vum Dall geet et biergop bei d’Wéngerten, mat Siichten iwwer d’Musel, ier et nees biergof geet."
        ],
        "minett": [
            "Ronderëm {p} geet et mam Mountainbike duerch de Minett: iwwer fréier Ofbaugebidder mat rouder Äerd an duerch e Netz vu schmuele Weeër a Bëschweeër.",
            "Dës MTB-Ronn féiert duerch d’Géigend ronderëm {p} am Minett, wou haut Trails iwwer déi fréier Ofbaugebidder féieren.",
            "{p} läit am Minett. Kuerz géi Passagen, Kéieren a Spuere vun der Industriegeschicht begleeden dësen Tour."
        ],
        "center": [
            "Ronderëm {p} am Guttland féiert den Tour iwwer Feldweeër, duerch de Bësch an iwwer roueg Niewestroossen.",
            "Dës MTB-Ronn féiert duerch d’Géigend ronderëm {p} am Guttland, tëscht Felder a Bëscher an der Mëtt vum Land.",
            "{p} läit am Guttland. Op dëser Ronn wiesselen d’Passagen iwwer d’Felder mat kuerze Stécker duerch de Bësch of."
        ]
    },
}

MTB_LENGTH_SENTENCES = {
    "de": [
        "Die Runde ist {l} km lang; mit normalem Tempo sitzt man etwa {d} {h} im Sattel.",
        "Mit {l} km Länge ist die Tour in rund {d} {h} zu fahren.",
        "Die Strecke misst {l} km — je nach Tempo etwa {d} {h} Fahrzeit.",
    ],
    "fr": [
        "La boucle fait {l} km ; comptez environ {d} h de selle à allure normale.",
        "Avec ses {l} km, le circuit se roule en {d} h environ.",
        "Le parcours mesure {l} km — soit environ {d} h de VTT selon le rythme.",
    ],
    "en": [
        "The loop is {l} km long; at a normal pace expect about {d} {h} in the saddle.",
        "At {l} km, the tour takes roughly {d} {h} to ride.",
        "The route measures {l} km — about {d} {h} of riding, depending on pace.",
    ],
    "lb": [
        "D’Ronn ass {l} km laang. Bei normalem Tempo ass ee mam Vëlo ongeféier {d} {h} ënnerwee.",
        "Fir dësen Tour ({l} km) brauch ee mam Mountainbike ongeféier {d} {h}.",
        "D’Streck ass {l} km laang. Jee nom Tempo dauert den Tour ongeféier {d} {h}."
    ],
}

MTB_NATURE_CLAUSES = {
    "de": [", und der Großteil verläuft abseits des Asphalts auf Wald- und Feldwegen",
           ", etwa die Hälfte der Strecke ist unbefestigt",
           ", die Tour mischt ruhige Sträßchen mit Wald- und Feldwegen"],
    "fr": [", et la majeure partie se roule hors bitume, sur chemins forestiers et agricoles",
           ", environ la moitié du parcours est non revêtue",
           ", le tour mêle petites routes calmes et chemins"],
    "en": [", and most of it runs off-tarmac on forest and field tracks",
           ", with about half the distance unpaved",
           ", mixing quiet lanes with forest and field tracks"],
    "lb": [
        ", an de gréissten Deel vun der Streck féiert iwwer Bëschweeër a Feldweeër ouni Asphalt",
        ", an ongeféier d’Hallschent vun der Streck ass net asphaltéiert",
        ", an den Tour verbënnt roueg Stroosse mat Bëschweeër a Feldweeër"
    ],
}

MTB_TERRAIN_SENTENCES = {
    "de": {"flat": "Große Steigungen fehlen — die Runde rollt zügig{nat}.",
           "rolling": "Unterwegs sammeln sich rund {g} Höhenmeter an{nat}.",
           "hilly": "Mit etwa {g} Höhenmetern ist die Tour konditionell fordernd{nat}."},
    "fr": {"flat": "Pas de grosses montées — la boucle roule vite{nat}.",
           "rolling": "Le parcours cumule environ {g} m de dénivelé{nat}.",
           "hilly": "Avec quelque {g} m de dénivelé, le tour demande de la caisse{nat}."},
    "en": {"flat": "There are no big climbs — the loop rolls fast{nat}.",
           "rolling": "The route gathers about {g} m of climbing{nat}.",
           "hilly": "With some {g} m of climbing, the tour demands fitness{nat}."},
    "lb": {
        "flat": "Et geet nëmme wéineg biergop{nat}.",
        "rolling": "Op der Streck kommen ongeféier {g} Héichtemeter zesummen{nat}.",
        "hilly": "Mat ongeféier {g} Héichtemeter brauch een eng gutt Konditioun fir dësen Tour{nat}."
    },
}

MTB_POI_SENTENCES = {
    "de": {"one": ["Unterwegs kommt man an {a} vorbei.", "An der Strecke liegt {a}."],
           "two": ["Unterwegs kommt man unter anderem an {a} und {b} vorbei.",
                    "An der Strecke liegen unter anderem {a} und {b}.",
                    "Sehenswert an der Strecke: {a} und {b}."]},
    "fr": {"one": ["En chemin, on passe près de {a}.", "Sur le parcours : {a}."],
           "two": ["En chemin, on passe notamment près de {a} et de {b}.",
                    "Sur le parcours, entre autres : {a} et {b}.",
                    "À voir en chemin : {a} et {b}."]},
    "en": {"one": ["Along the way you pass {a}.", "On the route: {a}."],
           "two": ["Along the way you pass {a} and {b}, among other sights.",
                    "On the route, among others: {a} and {b}.",
                    "Worth a look en route: {a} and {b}."]},
    "lb": {
        "one": [
            "Ënnerwee ze gesinn: {a}.",
            "Op der Streck: {a}."
        ],
        "two": [
            "Ënnerwee ze gesinn: {a} an {b}.",
            "Op der Streck, ënner anerem: {a} an {b}.",
            "Op dësem Tour ze gesinn: {a} an {b}."
        ]
    },
}

MTB_LANDSCAPE_SENTENCES = {
    "de": ["Gefahren wird überwiegend auf naturbelassenen Wegen durch Wald und Flur.",
           "Wald- und Feldwege wechseln sich mit ruhigen Nebenstraßen ab.",
           "Auf kleinen Wegen verbindet die Tour die schönsten Ecken der Umgebung."],
    "fr": ["On roule surtout sur des chemins naturels, entre bois et campagne.",
           "Chemins forestiers et agricoles alternent avec de calmes routes secondaires.",
           "Par de petits chemins, le tour relie les plus beaux coins des alentours."],
    "en": ["Most of the riding is on natural-surface tracks through woods and open country.",
           "Forest and field tracks alternate with quiet back roads.",
           "On small tracks, the tour links the prettiest corners of the area."],
    "lb": [
        "Et geet virun allem iwwer Weeër ouni Asphalt duerch de Bësch an iwwer d’Felder.",
        "Bëschweeër a Feldweeër wiessele sech mat rouegen Niewestroossen of.",
        "Iwwer kleng Weeër entdeckt een op dësem Tour d’Géigend ronderëm d’Uertschaft."
    ],
}

MTB_PRACTICAL_SENTENCES = {
    "de": ["Die Tour ist als Rundkurs ausgeschildert und lässt sich an jedem Punkt beginnen — Helm auf und los.",
           "Als beschilderte Rundtour hat die Strecke keinen festen Startpunkt; gefahren wird in Pfeilrichtung."],
    "fr": ["Le circuit est balisé en boucle et peut se commencer n'importe où — casque obligatoire, évidemment.",
           "Boucle balisée, le parcours n'a pas de départ imposé ; on suit le sens des flèches."],
    "en": ["The tour is signposted as a loop and can be started anywhere — helmet on and off you go.",
           "As a waymarked loop the route has no fixed start; ride in the direction of the arrows."],
    "lb": [
        "Den Tour ass als Ronn markéiert. Dir kënnt op all Punkt ufänken. Vergiesst den Helm net.",
        "Dës markéiert Ronn huet kee feste Startpunkt. Fuert an d’Richtung vun de Feiler."
    ],
}

MTB_HIGHLIGHT_LABELS = {
    "de": {"gain": "{g} Höhenmeter", "flat": "Schnell rollende Strecke", "natural": "Überwiegend unbefestigte Wege",
           "bus": "Bushaltestelle direkt an der Strecke"},
    "fr": {"gain": "{g} m de dénivelé", "flat": "Parcours roulant", "natural": "Surtout chemins non revêtus",
           "bus": "Arrêt de bus sur le parcours"},
    "en": {"gain": "{g} m of climbing", "flat": "Fast-rolling route", "natural": "Mostly unpaved tracks",
           "bus": "Bus stop right on the route"},
    "lb": {
        "gain": "{g} Héichtemeter",
        "flat": "Wéineg Héichtemeter",
        "natural": "Virun allem Weeër ouni Asphalt",
        "bus": "Busarrêt direkt op der Streck"
    },
}

BANKS = {
    "hiking": {
        "openers": OPENERS, "length": LENGTH_SENTENCES, "nature": NATURE_CLAUSES,
        "terrain": TERRAIN_SENTENCES, "poi": POI_SENTENCES, "landscape": LANDSCAPE_SENTENCES,
        "practical": PRACTICAL_SENTENCES, "labels": HIGHLIGHT_LABELS,
        "flat_gain": FLAT_GAIN_M, "hilly_gain": HILLY_GAIN_M,
    },
    "mtb": {
        "openers": MTB_OPENERS, "length": MTB_LENGTH_SENTENCES, "nature": MTB_NATURE_CLAUSES,
        "terrain": MTB_TERRAIN_SENTENCES, "poi": MTB_POI_SENTENCES, "landscape": MTB_LANDSCAPE_SENTENCES,
        "practical": MTB_PRACTICAL_SENTENCES, "labels": MTB_HIGHLIGHT_LABELS,
        "flat_gain": 200, "hilly_gain": 500,
    },
}


HOUR_WORD = {"de": ("Stunde", "Stunden"), "fr": ("h", "h"), "en": ("hour", "hours"),
             "lb": ("Stonn", "Stonnen")}


def _hour_word(duration: str, lang: str) -> str:
    singular, plural = HOUR_WORD[lang]
    if lang == "lb" and duration.strip() == "½":
        return singular
    return singular if duration.strip() == "1" else plural


# OSM sometimes names a feature with the bare common noun for what it is. As a
# highlight that is worse than nothing — "Along the way you pass Schloss" — and
# it can duplicate a properly named POI on the same route.
GENERIC_POI_NAMES = frozenset({
    "schloss", "burg", "château", "chateau", "kierch", "kirche", "église", "eglise",
    "kapelle", "chapelle", "museum", "musée", "musee", "moulin", "millen",
    "aussichtspunkt", "viewpoint", "panorama", "belvédère", "belvedere",
})


def _fmt_len(length_km: float, lang: str) -> str:
    return f"{length_km:g}".replace(".", "," if lang != "en" else ".")


def _sorted_pois(entry: dict) -> list:
    pois = entry.get("pois") or []
    named = [p for p in pois if p["name"].strip().casefold() not in GENERIC_POI_NAMES]
    return sorted(named, key=lambda p: (KIND_PRIORITY.get(p["kind"], 9), p["dist_m"]))


def compose(trail: dict, entry: dict, region: str, lang: str, cat_key: str = "hiking",
            speed_kmh: float = 4.0, climb_m_per_h: int = 600) -> dict:
    """Return {"paragraphs": [p1, p2], "highlights": [...]} from facts."""
    bank = BANKS[cat_key]
    slug, place = trail["slug"], trail["place"]
    gain = entry.get("elev_gain") or 0
    natural = entry.get("natural_pct")
    band = "flat" if gain < bank["flat_gain"] else ("hilly" if gain >= bank["hilly_gain"] else "rolling")
    nat_clause = "" if natural is None else bank["nature"][lang][
        0 if natural >= 70 else (1 if natural >= 40 else 2)
    ]

    opener = _pick(slug, f"open-{lang}", bank["openers"][lang][region]).format(p=place)
    duration = duration_label(entry["length_km"], gain, speed_kmh, climb_m_per_h)
    length_s = _pick(slug, f"len-{lang}", bank["length"][lang]).format(
        l=_fmt_len(entry["length_km"], lang), d=duration, h=_hour_word(duration, lang))
    terrain_s = bank["terrain"][lang][band].format(g=gain, nat=nat_clause)
    paragraph1 = f"{opener} {length_s} {terrain_s}"

    pois = _sorted_pois(entry)
    if len(pois) >= 2:
        poi_s = _pick(slug, f"poi-{lang}", bank["poi"][lang]["two"]).format(a=pois[0]["name"], b=pois[1]["name"])
    elif len(pois) == 1:
        poi_s = _pick(slug, f"poi-{lang}", bank["poi"][lang]["one"]).format(a=pois[0]["name"])
    else:
        poi_s = _pick(slug, f"land-{lang}", bank["landscape"][lang])
    practical_s = _pick(slug, f"prak-{lang}", bank["practical"][lang])
    paragraph2 = f"{poi_s} {practical_s}"

    labels = bank["labels"][lang]
    highlights = [p["name"] for p in pois[:2]]
    if gain >= 250:
        highlights.append(labels["gain"].format(g=gain))
    elif gain and gain < 100:
        highlights.append(labels["flat"])
    if natural is not None and natural >= 70:
        highlights.append(labels["natural"])
    stops = entry.get("bus_stops") or []
    if stops and stops[0]["dist_m"] <= BUS_ON_ROUTE_M:
        highlights.append(labels["bus"])
    if len(highlights) < 3:
        highlights.append(REGION_HIGHLIGHT[lang][region])
    return {"paragraphs": [paragraph1, paragraph2], "highlights": highlights[:4]}
