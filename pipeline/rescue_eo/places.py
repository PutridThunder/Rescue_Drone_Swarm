"""Gathering places (schools, transit hubs, hospitals, markets, venues, restaurants) from
OpenStreetMap, with an estimated full capacity. Written to places.json for crowd intel.

The Overpass response is cached for a day in .cache/eo/.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass

from .area import CACHE_DIR, Area

SOURCE = {"name": "OpenStreetMap (Overpass API)", "url": "https://www.openstreetmap.org/copyright", "license": "ODbL"}

MIRRORS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"]
USER_AGENT = "rescue-drone-swarm/0.1 (hackathon simulation)"
CACHE_SECONDS = 86_400

# OSM tag value -> (hotspot kind, default capacity in people).
TYPES: dict[str, tuple[str, int]] = {
    "school": ("school", 500),
    "kindergarten": ("school", 60),
    "college": ("school", 1500),
    "university": ("school", 2000),
    "hospital": ("health", 900),
    "clinic": ("health", 30),
    "place_of_worship": ("worship", 200),
    "community_centre": ("community", 250),
    "library": ("community", 120),
    "marketplace": ("market", 600),
    "ferry_terminal": ("transit", 600),
    "bus_station": ("transit", 300),
    "station": ("transit", 300),
    "restaurant": ("dining", 50),
    "cafe": ("dining", 25),
    "pub": ("dining", 80),
    "bar": ("dining", 70),
    "fast_food": ("dining", 20),
    "food_court": ("dining", 150),
    "nightclub": ("venue", 200),
    "cinema": ("venue", 300),
    "theatre": ("venue", 400),
    "arts_centre": ("venue", 150),
    "events_venue": ("venue", 300),
    "mall": ("market", 800),
    "supermarket": ("market", 150),
    "department_store": ("market", 200),
    "park": ("park", 300),
    "stadium": ("venue", 2000),
    "sports_centre": ("venue", 200),
    "fitness_centre": ("venue", 60),
    "pitch": ("park", 40),
    "playground": ("park", 25),
    "hotel": ("hotel", 250),
    "museum": ("venue", 150),
    "attraction": ("venue", 150),
}

# Big venues whose OSM entry has no capacity tag.
KNOWN_CAPACITY = [
    (re.compile(r"^rogers arena$", re.I), 18_900),
    (re.compile(r"^pacific coliseum$", re.I), 16_000),
    (re.compile(r"^queen elizabeth theatre$", re.I), 2_800),
    (re.compile(r"^orpheum$", re.I), 2_700),
]


@dataclass
class Place:
    id: str
    name: str
    kind: str
    type: str
    lat: float
    lon: float
    capacity: int
    capacitySource: str  # "osm" or "estimate" (camelCase to match the app's JSON)


def query(area: Area) -> str:
    bbox = f"{area.south},{area.west},{area.north},{area.east}"
    return f"""[out:json][timeout:60][bbox:{bbox}];
(
  nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|place_of_worship|community_centre|library|marketplace|ferry_terminal|bus_station|restaurant|cafe|pub|bar|fast_food|food_court|nightclub|cinema|theatre|arts_centre|events_venue)$"];
  nwr["shop"~"^(mall|supermarket|department_store)$"];
  nwr["public_transport"="station"];
  nwr["leisure"~"^(park|stadium|sports_centre|fitness_centre|pitch|playground)$"]["name"];
  nwr["tourism"~"^(hotel|museum|attraction)$"];
);
out center tags;"""


def overpass(q: str) -> list[dict]:
    body = urllib.parse.urlencode({"data": q}).encode()
    last_error: Exception | None = None
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=90) as res:
                return json.loads(res.read())["elements"]
        except Exception as err:  # try the next mirror
            last_error = err
    raise RuntimeError(f"OpenStreetMap unavailable ({last_error})")


def classify(tags: dict[str, str]) -> str | None:
    for key in ("amenity", "shop", "leisure", "tourism"):
        value = tags.get(key)
        if value in TYPES:
            return value
    return "station" if tags.get("public_transport") == "station" else None


def capacity_for(place_type: str, tags: dict[str, str]) -> tuple[int, str]:
    tagged = tags.get("capacity", "")
    if tagged.isdigit() and int(tagged) > 0:
        return int(tagged), "osm"
    name = tags.get("name", "")
    for pattern, capacity in KNOWN_CAPACITY:
        if pattern.match(name):
            return capacity, "estimate"
    capacity = TYPES[place_type][1]
    if place_type == "school":
        lowered = name.lower()
        if re.search(r"secondary|high school", lowered):
            capacity = 1_100
        elif re.search(r"elementary|primary", lowered):
            capacity = 350
    return capacity, "estimate"


def parse(elements: list[dict]) -> list[Place]:
    places = []
    for el in elements:
        tags = el.get("tags", {})
        place_type = classify(tags)
        lat = el.get("lat", el.get("center", {}).get("lat"))
        lon = el.get("lon", el.get("center", {}).get("lon"))
        if place_type is None or lat is None or lon is None:
            continue
        capacity, source = capacity_for(place_type, tags)
        places.append(Place(f"{el['type']}/{el['id']}", tags.get("name", ""), TYPES[place_type][0], place_type, lat, lon, capacity, source))
    return places


def fetch(area: Area) -> list[Place]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"places-{area.south}_{area.west}_{area.north}_{area.east}.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < CACHE_SECONDS:
        elements = json.loads(cache.read_text())
    else:
        elements = overpass(query(area))
        cache.write_text(json.dumps(elements))
    return parse(elements)


def to_json(places: list[Place]) -> list[dict]:
    return [asdict(p) for p in places]
