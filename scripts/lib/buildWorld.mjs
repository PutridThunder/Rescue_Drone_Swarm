// Builds one playable area from OpenStreetMap (Overpass) + AWS Terrarium elevation tiles: the
// 10 m simulation grid (world.json) and vector footprints/roads for rendering (map.json).
// Shared by the command line (scripts/fetch-world.mjs), the dev server and the Vercel function
// that builds areas on demand (api/areas.ts). Returns the data; writing it is up to the caller.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const T = { Water: 0, Ground: 1, Road: 2, Park: 3, Building: 4 };
const UA = "sar-swarm-hackathon/0.1 (educational simulation)";
const MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const hash = (s) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

// What we take from OpenStreetMap, as Overpass statements, and the same selection as filters
// (to split one combined response back into the four kinds).
const ROAD_CLASSES = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/;
const OSM_QUERIES = {
  buildings: 'way["building"];relation["building"]["type"="multipolygon"];',
  roads: `way["highway"~"${ROAD_CLASSES.source}"];`,
  water: 'way["natural"="water"];relation["natural"="water"];way["natural"="coastline"];way["waterway"="riverbank"];relation["waterway"="riverbank"];way["waterway"="river"];',
  land:
    'way["leisure"~"^(park|garden|nature_reserve|golf_course|pitch|playground|recreation_ground)$"];relation["leisure"~"^(park|nature_reserve|golf_course)$"];' +
    'way["landuse"~"^(forest|grass|meadow|cemetery|recreation_ground|village_green|residential|commercial|industrial|retail)$"];relation["landuse"~"^(forest|grass|residential|commercial|industrial|retail)$"];' +
    'way["natural"~"^(wood|scrub|grassland|heath)$"];relation["natural"~"^(wood|scrub)$"];',
};
const isWay = (el) => el.type === "way";
const isRel = (el) => el.type === "relation";
const OSM_KINDS = {
  buildings: (el) => !!el.tags.building && (isWay(el) || (isRel(el) && el.tags.type === "multipolygon")),
  roads: (el) => isWay(el) && ROAD_CLASSES.test(el.tags.highway ?? ""),
  water: (el) =>
    (el.tags.natural === "water" && (isWay(el) || isRel(el))) ||
    (isWay(el) && el.tags.natural === "coastline") ||
    (el.tags.waterway === "riverbank" && (isWay(el) || isRel(el))) ||
    (isWay(el) && el.tags.waterway === "river"),
  land: (el) =>
    (isWay(el) && /^(park|garden|nature_reserve|golf_course|pitch|playground|recreation_ground)$/.test(el.tags.leisure ?? "")) ||
    (isRel(el) && /^(park|nature_reserve|golf_course)$/.test(el.tags.leisure ?? "")) ||
    (isWay(el) && /^(forest|grass|meadow|cemetery|recreation_ground|village_green|residential|commercial|industrial|retail)$/.test(el.tags.landuse ?? "")) ||
    (isRel(el) && /^(forest|grass|residential|commercial|industrial|retail)$/.test(el.tags.landuse ?? "")) ||
    (isWay(el) && /^(wood|scrub|grassland|heath)$/.test(el.tags.natural ?? "")) ||
    (isRel(el) && /^(wood|scrub)$/.test(el.tags.natural ?? "")),
};

/** A --size-km rectangle (default 2.5 x 2.1 km) centred on lat/lon, as [S, W, N, E]. */
export function bboxAround(lat, lon, sizeKm = "2.5x2.1") {
  const [wKm, hKm] = sizeKm.split("x").map(Number);
  const dLat = hKm / 2 / 111.2;
  const dLon = wKm / 2 / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => Math.round(v * 1e5) / 1e5);
}

export function formatWorldJson(json) {
  const { width, height } = json.meta;
  const formatGrid = (values) => {
    const rows = [];
    for (let y = 0; y < height; y++) {
      const row = values.slice(y * width, (y + 1) * width);
      rows.push(
        `    ${JSON.stringify(row).slice(1, -1)}${y < height - 1 ? "," : ""}`,
      );
    }
    return `[\n${rows.join("\n")}\n  ]`;
  };
  const indent = (value) =>
    JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");

  return (
    `{\n` +
    `  "meta": ${indent(json.meta)},\n` +
    `  "terrain": ${formatGrid(json.terrain)},\n` +
    `  "elevation": ${formatGrid(json.elevation)},\n` +
    `  "buildingHeight": ${formatGrid(json.buildingHeight)},\n` +
    `  "obstacleHeight": ${formatGrid(json.obstacleHeight)},\n` +
    `  "population": ${formatGrid(json.population)},\n` +
    `  "base": ${indent(json.base)},\n` +
    `  "roadName": ${formatGrid(json.roadName)},\n` +
    `  "roadNames": ${indent(json.roadNames)}\n` +
    `}\n`
  );
}

/**
 * @param {object} opts
 * @param {string} opts.name           display name, e.g. "Metrotown, Burnaby"
 * @param {number[]} opts.bbox         [S, W, N, E]
 * @param {number[]} [opts.staging]    [lat, lon] for truck staging (default: area centre)
 * @param {string} [opts.cacheDir]     cache raw downloads here (none if omitted)
 * @param {(msg: string) => void} [opts.log]
 * @param {number} [opts.overpassTimeoutMs]
 * @param {number} [opts.attempts]     tries per Overpass mirror
 * @param {number} [opts.deadlineMs]   stop trying further Overpass mirrors after this long
 * @param {Function} [opts.source]     async ({bbox, log}) => {buildings, roads, water, land}, each
 *                                     {elements} in Overpass "out geom" form; default: Overpass
 * @returns {Promise<{world: object, map: object, buildingCount: number}>}
 */
export async function buildWorld({ name, bbox, staging = null, cacheDir = null, log = console.log, overpassTimeoutMs = 240_000, attempts = 2, source = null, deadlineMs = 0 }) {
  const deadline = deadlineMs ? Date.now() + deadlineMs : Infinity;
  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  const [S, W, N, E] = bbox;
  const CELL = 10;
  const LAT0 = ((S + N) / 2) * (Math.PI / 180);
  const M_PER_DEG_LAT =
    111132.954 - 559.822 * Math.cos(2 * LAT0) + 1.175 * Math.cos(4 * LAT0);
  const M_PER_DEG_LON = 111412.84 * Math.cos(LAT0) - 93.5 * Math.cos(3 * LAT0);
  const WIDTH = Math.round(((E - W) * M_PER_DEG_LON) / CELL);
  const HEIGHT = Math.round(((N - S) * M_PER_DEG_LAT) / CELL);
  const NCELLS = WIDTH * HEIGHT;

  async function overpass(name, body) {
    const bbox = `${S},${W},${N},${E}`;
    const q = `[out:json][timeout:180][bbox:${bbox}];(${body});out geom;`;
    const file = cacheDir && path.join(cacheDir, `overpass-${name}-${hash(q)}.json`);
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    for (const url of MIRRORS) {
      if (Date.now() > deadline) break; // out of time: don't start another mirror
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          log(`  overpass ${name}: ${url} (try ${attempt + 1})`);
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "User-Agent": UA,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "data=" + encodeURIComponent(q),
            signal: AbortSignal.timeout(overpassTimeoutMs),
          });
          const text = await res.text();
          if (!res.ok || !text.trimStart().startsWith("{"))
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 80)}`);
          const json = JSON.parse(text);
          if (json.remark && /error|timed out/i.test(json.remark))
            throw new Error(json.remark);
          if (file) fs.writeFileSync(file, text);
          return json;
        } catch (err) {
          log(`    failed: ${err.message}`);
        }
      }
    }
    throw new Error(`All Overpass mirrors failed for ${name}`);
  }

  async function fetchOsm() {
    const all = await overpass("all", Object.values(OSM_QUERIES).join(""));
    const pick = (test) => ({ elements: all.elements.filter((el) => el.tags && test(el)) });
    return { buildings: pick(OSM_KINDS.buildings), roads: pick(OSM_KINDS.roads), water: pick(OSM_KINDS.water), land: pick(OSM_KINDS.land) };
  }

  async function tile(z, x, y) {
    const file = cacheDir && path.join(cacheDir, `terrarium-${z}-${x}-${y}.png`);
    let buf;
    if (file && fs.existsSync(file)) buf = fs.readFileSync(file);
    else {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`tile ${url}: HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      if (file) fs.writeFileSync(file, buf);
    }
    return PNG.sync.read(buf);
  }


  const toX = (lon) => ((lon - W) / (E - W)) * WIDTH;
  const toY = (lat) => ((N - lat) / (N - S)) * HEIGHT;
  const r2 = (v) => Math.round(v * 100) / 100;

  /** Collect polygon edges (in grid coords scaled by `sub`) from a way or multipolygon relation. */
  function polygonEdges(el, sub = 1) {
    const rings = [];
    if (el.type === "way" && el.geometry) rings.push(el.geometry);
    if (el.type === "relation" && el.members) {
      for (const m of el.members)
        if (
          m.type === "way" &&
          m.geometry &&
          (m.role === "outer" || m.role === "inner" || m.role === "")
        )
          rings.push(m.geometry);
    }
    const edges = [];
    for (const g of rings) {
      for (let i = 0; i < g.length; i++) {
        const a = g[i];
        const b = g[(i + 1) % g.length]; // closes open member ways too; even-odd over all edges
        if (!a || !b) continue;
        edges.push([
          toX(a.lon) * sub,
          toY(a.lat) * sub,
          toX(b.lon) * sub,
          toY(b.lat) * sub,
        ]);
      }
    }
    return edges;
  }

  /** Approximate footprint area (m^2) of a way's outer ring via the shoelace formula. */
  function ringAreaM2(el) {
    const g =
      el.type === "way"
        ? el.geometry
        : el.members?.find((m) => m.role === "outer")?.geometry;
    if (!g || g.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < g.length; i++) {
      const p = g[i],
        q = g[(i + 1) % g.length];
      a +=
        p.lon * M_PER_DEG_LON * q.lat * M_PER_DEG_LAT -
        q.lon * M_PER_DEG_LON * p.lat * M_PER_DEG_LAT;
    }
    return Math.abs(a) / 2;
  }

  /** Even-odd scanline fill at cell centres of a (w*h) grid. Calls fn(x, y) for each filled sample. */
  function scanFill(edges, w, h, fn) {
    if (!edges.length) return;
    let minY = Infinity,
      maxY = -Infinity;
    for (const e of edges) {
      minY = Math.min(minY, e[1], e[3]);
      maxY = Math.max(maxY, e[1], e[3]);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(h - 1, Math.ceil(maxY));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      xs.length = 0;
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy))
          xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
        for (let x = xa; x <= xb; x++) fn(x, y);
      }
    }
  }

  /** Rasterize a polyline (DDA, supercover-ish) with a given half-width in cells. */
  function rasterLine(geom, halfWidth, fn) {
    for (let i = 0; i + 1 < geom.length; i++) {
      const ax = toX(geom[i].lon),
        ay = toY(geom[i].lat);
      const bx = toX(geom[i + 1].lon),
        by = toY(geom[i + 1].lat);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 8));
      for (let s = 0; s <= steps; s++) {
        const px = ax + ((bx - ax) * s) / steps;
        const py = ay + ((by - ay) * s) / steps;
        const r = Math.ceil(halfWidth);
        if (r === 0) {
          const x = Math.floor(px),
            y = Math.floor(py);
          if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) fn(x, y);
          continue;
        }
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > halfWidth * halfWidth + 0.01) continue;
            const x = Math.floor(px) + dx,
              y = Math.floor(py) + dy;
            if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) fn(x, y);
          }
      }
    }
  }


  log(`Grid ${WIDTH} x ${HEIGHT} (${NCELLS} cells, ${CELL} m)`);

  log("Fetching OSM...");
  // Map data: from `source` when given (another map provider), else one combined
  // Overpass request (one slot on the shared server instead of four), split by kind here.
  const { buildings, roads, water, land } = source ? await source({ bbox: [S, W, N, E], log }) : await fetchOsm();

  log("Fetching elevation tiles...");
  const Z = 15;
  const n = 2 ** Z;
  const lonToTX = (lon) => ((lon + 180) / 360) * n;
  const latToTY = (lat) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  };
  const tiles = new Map();
  for (let tx = Math.floor(lonToTX(W)); tx <= Math.floor(lonToTX(E)); tx++)
    for (let ty = Math.floor(latToTY(N)); ty <= Math.floor(latToTY(S)); ty++)
      tiles.set(`${tx},${ty}`, tile(Z, tx, ty)); // fetched in parallel, awaited below
  for (const [key, pending] of tiles) tiles.set(key, await pending);
  const heightAtPixel = (gx, gy) => {
    const tx = Math.floor(gx / 256),
      ty = Math.floor(gy / 256);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return 0;
    const px = Math.min(255, Math.max(0, gx - tx * 256)),
      py = Math.min(255, Math.max(0, gy - ty * 256));
    const i = (py * 256 + px) * 4;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const sampleElevation = (lat, lon) => {
    const fx = lonToTX(lon) * 256 - 0.5,
      fy = latToTY(lat) * 256 - 0.5;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      ux = fx - x0,
      uy = fy - y0;
    return (
      heightAtPixel(x0, y0) * (1 - ux) * (1 - uy) +
      heightAtPixel(x0 + 1, y0) * ux * (1 - uy) +
      heightAtPixel(x0, y0 + 1) * (1 - ux) * uy +
      heightAtPixel(x0 + 1, y0 + 1) * ux * uy
    );
  };

  const rawElev = new Float32Array(NCELLS);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const lat = N - ((y + 0.5) / HEIGHT) * (N - S);
      const lon = W + ((x + 0.5) / WIDTH) * (E - W);
      rawElev[y * WIDTH + x] = sampleElevation(lat, lon);
    }

  const terrain = new Uint8Array(NCELLS).fill(T.Ground);
  const waterMask = new Uint8Array(NCELLS);
  const coastBarrier = new Uint8Array(NCELLS);

  // Inland water polygons + rivers
  for (const el of water.elements) {
    const tags = el.tags || {};
    if (tags.natural === "coastline") {
      if (el.geometry)
        rasterLine(
          el.geometry,
          0.5,
          (x, y) => (coastBarrier[y * WIDTH + x] = 1),
        );
    } else if (tags.waterway === "river" && el.geometry) {
      rasterLine(el.geometry, 0.5, (x, y) => (waterMask[y * WIDTH + x] = 1));
    } else {
      scanFill(
        polygonEdges(el),
        WIDTH,
        HEIGHT,
        (x, y) => (waterMask[y * WIDTH + x] = 1),
      );
    }
  }

  // Sea: flood fill from the south edge over low cells, stopped by the coastline barrier.
  const sea = new Uint8Array(NCELLS);
  const queue = [];
  const seaOk = (i) => rawElev[i] <= 1.0 && !coastBarrier[i];
  for (let x = 0; x < WIDTH; x++) {
    const i = (HEIGHT - 1) * WIDTH + x;
    if (seaOk(i)) {
      sea[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q],
      x = i % WIDTH,
      y = (i - x) / WIDTH;
    const nb = [
      x > 0 ? i - 1 : -1,
      x < WIDTH - 1 ? i + 1 : -1,
      y > 0 ? i - WIDTH : -1,
      y < HEIGHT - 1 ? i + WIDTH : -1,
    ];
    for (const j of nb)
      if (j >= 0 && !sea[j] && seaOk(j)) {
        sea[j] = 1;
        queue.push(j);
      }
  }
  // Coastline cells themselves: water if they're low and adjacent to sea.
  for (let i = 0; i < NCELLS; i++) {
    if (!coastBarrier[i] || rawElev[i] > 1.5) continue;
    const x = i % WIDTH;
    if (
      (x > 0 && sea[i - 1]) ||
      (x < WIDTH - 1 && sea[i + 1]) ||
      sea[i - WIDTH] ||
      sea[i + WIDTH]
    )
      sea[i] = 2;
  }
  for (let i = 0; i < NCELLS; i++)
    if (sea[i] || waterMask[i]) terrain[i] = T.Water;

  // Parks / green space and landuse zoning
  const residentialZone = new Uint8Array(NCELLS);
  const commercialZone = new Uint8Array(NCELLS);
  for (const el of land.elements) {
    const tags = el.tags || {};
    const lu = tags.landuse;
    const edges = polygonEdges(el);
    if (lu === "residential")
      scanFill(
        edges,
        WIDTH,
        HEIGHT,
        (x, y) => (residentialZone[y * WIDTH + x] = 1),
      );
    else if (lu === "commercial" || lu === "industrial" || lu === "retail")
      scanFill(
        edges,
        WIDTH,
        HEIGHT,
        (x, y) => (commercialZone[y * WIDTH + x] = 1),
      );
    else
      scanFill(edges, WIDTH, HEIGHT, (x, y) => {
        const i = y * WIDTH + x;
        if (terrain[i] !== T.Water) terrain[i] = T.Park;
      });
  }

  // Roads: dense-sampled lines (4-connected, ~10 m) for minor streets, wider for major roads. Track street names.
  const MAJOR = /^(motorway|trunk|primary|secondary)$/;
  const roadNames = [];
  const nameIndex = new Map();
  const roadName = new Int16Array(NCELLS).fill(-1);
  const roadRank = new Uint8Array(NCELLS);
  const vecRoads = [];
  for (const el of roads.elements) {
    if (!el.geometry) continue;
    if (el.tags?.bridge && el.tags?.layer && Number(el.tags.layer) > 1)
      continue;
    const major = MAJOR.test(el.tags?.highway);
    const nm = el.tags?.name;
    let ni = -1;
    if (nm) {
      if (!nameIndex.has(nm)) {
        nameIndex.set(nm, roadNames.length);
        roadNames.push(nm);
      }
      ni = nameIndex.get(nm);
    }
    const rank = major ? 2 : 1;
    rasterLine(el.geometry, major ? 1 : 0, (x, y) => {
      const i = y * WIDTH + x;
      terrain[i] = T.Road;
      if (ni >= 0 && rank >= roadRank[i]) {
        roadName[i] = ni;
        roadRank[i] = rank;
      }
    });
    vecRoads.push({
      p: el.geometry.flatMap((g) => [r2(toX(g.lon)), r2(toY(g.lat))]),
      w: major ? 16 : 10,
      n: ni,
    });
  }

  // Buildings: supersample 2x2 per cell (5 m subcells) for coverage, height and floor area.
  const SUB = 2;
  const subArea = (CELL / SUB) ** 2;
  const coverage = new Float32Array(NCELLS);
  const bHeight = new Float32Array(NCELLS);
  const resFloor = new Float32Array(NCELLS);
  const RES_TYPES = new Set([
    "house",
    "residential",
    "apartments",
    "detached",
    "semidetached_house",
    "terrace",
    "dormitory",
    "bungalow",
    "duplex",
  ]);
  const NONRES = new Set([
    "commercial",
    "industrial",
    "retail",
    "office",
    "warehouse",
    "garage",
    "garages",
    "shed",
    "school",
    "church",
    "hospital",
    "roof",
    "service",
    "parking",
    "university",
    "public",
    "civic",
    "hotel",
    "construction",
    "carport",
    "kiosk",
    "train_station",
    "transportation",
  ]);
  const DEFAULT_H = {
    house: 7,
    detached: 7,
    bungalow: 5,
    semidetached_house: 7,
    duplex: 7,
    terrace: 8,
    residential: 10,
    apartments: 15,
    commercial: 10,
    retail: 7,
    office: 18,
    industrial: 9,
    warehouse: 9,
    garage: 3,
    garages: 3,
    shed: 3,
    school: 9,
    church: 12,
    hospital: 18,
    hotel: 25,
    roof: 4,
    yes: 7,
  };
  let buildingCount = 0;
  const vecBuildings = [];
  // Flight obstacles: tallest building touching each cell at all (interior samples + outline).
  const obstacle = new Float32Array(NCELLS);
  for (const el of buildings.elements) {
    const tags = el.tags || {};
    const type = tags.building;
    let h = parseFloat(tags.height);
    const levels = parseFloat(tags["building:levels"]);
    if (!(h > 0)) h = levels > 0 ? levels * 3.2 : (DEFAULT_H[type] ?? 8);
    const floors = levels > 0 ? levels : Math.max(1, Math.round(h / 3.2));
    const footprint = ringAreaM2(el);
    const countsForPop = footprint >= 45; // skip sheds / garages
    buildingCount++;
    const outer =
      el.type === "way"
        ? el.geometry
        : el.members?.find((m) => m.role === "outer")?.geometry;
    if (outer && outer.length >= 3)
      vecBuildings.push({
        p: outer.flatMap((g) => [r2(toX(g.lon)), r2(toY(g.lat))]),
        h: Math.round(h * 10) / 10,
      });
    if (outer && outer.length >= 3) {
      rasterLine(outer, 0, (x, y) => {
        const i = y * WIDTH + x;
        obstacle[i] = Math.max(obstacle[i], h);
      });
    }
    scanFill(polygonEdges(el, SUB), WIDTH * SUB, HEIGHT * SUB, (sx, sy) => {
      const i = Math.floor(sy / SUB) * WIDTH + Math.floor(sx / SUB);
      coverage[i] += 1 / (SUB * SUB);
      bHeight[i] = Math.max(bHeight[i], h);
      obstacle[i] = Math.max(obstacle[i], h);
      const residential =
        RES_TYPES.has(type) ||
        (type === "yes" && residentialZone[i] && !commercialZone[i]);
      if (residential && countsForPop && !NONRES.has(type))
        resFloor[i] += subArea * floors;
    });
  }
  const buildingHeight = new Float32Array(NCELLS);
  for (let i = 0; i < NCELLS; i++) {
    if (coverage[i] >= (terrain[i] === T.Road ? 0.75 : 0.5)) {
      terrain[i] = T.Building;
      buildingHeight[i] = bHeight[i];
    }
  }

  // Elevation clamp
  const elevation = new Float32Array(NCELLS);
  for (let i = 0; i < NCELLS; i++)
    elevation[i] = terrain[i] === T.Water ? 0 : Math.max(0.5, rawElev[i]);

  // Population prior
  const population = new Float32Array(NCELLS);
  for (let i = 0; i < NCELLS; i++) {
    population[i] = resFloor[i] / 60; // ~60 m2 gross floor area per resident (calibrated vs census density)
    if (terrain[i] === T.Park) population[i] += 0.003;
  }

  // Truck staging: nearest Ground/Park cell to --base (or the area centre when --center is given).
  const [baseLat, baseLon] = staging ?? [(S + N) / 2, (W + E) / 2];
  const tx = Math.floor(toX(baseLon)),
    ty = Math.floor(toY(baseLat));
  let base = { x: tx, y: ty },
    best = Infinity;
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const t = terrain[y * WIDTH + x];
      if (t !== T.Park && t !== T.Ground) continue;
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d < best) {
        best = d;
        base = { x, y };
      }
    }

  const round = (a, p) => Array.from(a, (v) => Math.round(v * p) / p);
  const json = {
    meta: {
      name,
      bbox: [S, W, N, E],
      cellSizeM: CELL,
      width: WIDTH,
      height: HEIGHT,
      source: "osm",
    },
    terrain: Array.from(terrain),
    elevation: round(elevation, 10),
    buildingHeight: round(buildingHeight, 10),
    // Tallest building touching each cell at all (even a corner): what drones must fly around.
    obstacleHeight: round(obstacle, 10),
    population: round(population, 100),
    base,
    roadName: Array.from(roadName),
    roadNames,
  };

  return { world: json, map: { buildings: vecBuildings, roads: vecRoads, roadNames }, buildingCount };
}
