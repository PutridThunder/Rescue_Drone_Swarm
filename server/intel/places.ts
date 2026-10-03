// Places where people gather, from OpenStreetMap (free, no key), with an estimated full capacity.
import fs from "node:fs";
import path from "node:path";
import type { HotspotKind, Place } from "../../src/intel/types";

const MIRRORS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"];
const UA = "rescue-drone-swarm/0.1 (hackathon simulation)";
const CACHE_DIR = path.resolve(".cache/intel");

// [kind, default capacity] by OSM tag value.
const TYPES: Record<string, [HotspotKind, number]> = {
  school: ["school", 500],
  kindergarten: ["school", 60],
  college: ["school", 1500],
  university: ["school", 2000],
  hospital: ["health", 900],
  clinic: ["health", 30],
  place_of_worship: ["worship", 200],
  community_centre: ["community", 250],
  library: ["community", 120],
  marketplace: ["market", 600],
  ferry_terminal: ["transit", 600],
  bus_station: ["transit", 300],
  station: ["transit", 300],
  restaurant: ["dining", 50],
  cafe: ["dining", 25],
  pub: ["dining", 80],
  bar: ["dining", 70],
  fast_food: ["dining", 20],
  food_court: ["dining", 150],
  nightclub: ["venue", 200],
  cinema: ["venue", 300],
  theatre: ["venue", 400],
  arts_centre: ["venue", 150],
  events_venue: ["venue", 300],
  mall: ["market", 800],
  supermarket: ["market", 150],
  department_store: ["market", 200],
  park: ["park", 300],
  stadium: ["venue", 2000],
  sports_centre: ["venue", 200],
  fitness_centre: ["venue", 60],
  pitch: ["park", 40],
  playground: ["park", 25],
  hotel: ["hotel", 250],
  museum: ["venue", 150],
  attraction: ["venue", 150],
};

function query(bbox: [number, number, number, number]): string {
  const b = bbox.join(",");
  return `[out:json][timeout:60][bbox:${b}];
(
  nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|place_of_worship|community_centre|library|marketplace|ferry_terminal|bus_station|restaurant|cafe|pub|bar|fast_food|food_court|nightclub|cinema|theatre|arts_centre|events_venue)$"];
  nwr["shop"~"^(mall|supermarket|department_store)$"];
  nwr["public_transport"="station"];
  nwr["leisure"~"^(park|stadium|sports_centre|fitness_centre|pitch|playground)$"]["name"];
  nwr["tourism"~"^(hotel|museum|attraction)$"];
);
out center tags;`;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpass(q: string): Promise<OsmElement[]> {
  let last: unknown;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith("{")) throw new Error(`HTTP ${res.status}`);
      return (JSON.parse(text) as { elements: OsmElement[] }).elements;
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`OpenStreetMap unavailable (${(last as Error)?.message ?? "unknown"})`);
}

function classify(tags: Record<string, string>): string | null {
  for (const key of ["amenity", "shop", "leisure", "tourism"]) {
    const v = tags[key];
    if (v && TYPES[v]) return v;
  }
  if (tags.public_transport === "station") return "station";
  return null;
}

function capacityFor(type: string, tags: Record<string, string>): [number, Place["capacitySource"]] {
  const tagged = parseInt(tags.capacity ?? "", 10);
  if (tagged > 0) return [tagged, "osm"];
  let cap = TYPES[type][1];
  const name = (tags.name ?? "").toLowerCase();
  if (type === "school") {
    if (/secondary|high school/.test(name)) cap = 1100;
    else if (/elementary|primary/.test(name)) cap = 350;
  }
  return [cap, "estimate"];
}

/** Fetch (and cache for a day) every gathering place in the bounding box. */
export async function loadPlaces(bbox: [number, number, number, number]): Promise<{ places: Place[]; cached: boolean }> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `places-${bbox.join("_")}.json`);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 86_400_000) {
    return { places: JSON.parse(fs.readFileSync(file, "utf8")) as Place[], cached: true };
  }
  const elements = await overpass(query(bbox));
  const places: Place[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const type = classify(tags);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!type || lat == null || lon == null) continue;
    const [capacity, capacitySource] = capacityFor(type, tags);
    places.push({
      id: `${el.type}/${el.id}`,
      name: tags.name ?? "",
      kind: TYPES[type][0],
      type,
      lat,
      lon,
      capacity,
      capacitySource,
    });
  }
  fs.writeFileSync(file, JSON.stringify(places));
  return { places, cached: false };
}
