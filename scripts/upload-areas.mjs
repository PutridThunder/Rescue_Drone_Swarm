// Uploads areas from public/areas/<id>/ to Snowflake, so the website loads them from there:
// their files (AREA_FILES + AREAS) plus buildings, roads and places as tables for SQL analysis.
// Re-running replaces an area's rows. Credentials: SNOWFLAKE_ACCOUNT / SNOWFLAKE_TOKEN from the
// environment or .env.local (see README, "Results storage and maps").
// Usage: npm run maps:upload                (every area in public/areas/index.json)
//        npm run maps:upload -- lonsdale     (just these)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.SNOWFLAKE_ACCOUNT || !process.env.SNOWFLAKE_TOKEN) {
  console.error("Set SNOWFLAKE_ACCOUNT and SNOWFLAKE_TOKEN (in .env.local or the environment) first.");
  process.exit(1);
}
// Imported after the environment is set: the client reads it when it loads.
const { run, textBindings } = await import("../api/snowflake.ts");

const FILES = ["world.json", "map.json", "places.json", "eo.json", "satellite.jpg"];
const ROWS_PER_INSERT = 200;
const index = JSON.parse(fs.readFileSync(path.join(root, "public/areas/index.json"), "utf8")).areas;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : index.map((a) => a.id);

for (const id of ids) {
  const dir = path.join(root, "public/areas", id);
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !fs.existsSync(path.join(dir, "world.json"))) {
    console.error(`skip ${id}: no public/areas/${id}/world.json`);
    continue;
  }
  const started = Date.now();
  const world = JSON.parse(fs.readFileSync(path.join(dir, "world.json"), "utf8"));
  const map = JSON.parse(fs.readFileSync(path.join(dir, "map.json"), "utf8"));
  const places = fs.existsSync(path.join(dir, "places.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "places.json"), "utf8")).places : [];
  const { name, bbox, width, height, cellSizeM } = world.meta;
  const [S, W, N, E] = bbox;
  const lon = (x) => W + (x / width) * (E - W);
  const lat = (y) => N - (y / height) * (N - S);
  console.log(`${name} (${id})`);

  // Files the app loads.
  await run(`DELETE FROM AREA_FILES WHERE AREA_ID = ?`, textBindings([id]));
  for (const file of FILES) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p);
    const isJson = file.endsWith(".json");
    const content = (isJson ? zlib.gzipSync(raw, { level: 9 }) : raw).toString("base64");
    await run(`INSERT INTO AREA_FILES (AREA_ID, FILE, ENCODING, BYTES, CONTENT) SELECT ?, ?, ?, ?, ?`, {
      ...textBindings([id, file, isJson ? "gzip" : "identity"]),
      4: { type: "FIXED", value: String(raw.length) },
      5: { type: "TEXT", value: content },
    });
    console.log(`  ${file}: ${(raw.length / 1e6).toFixed(2)} MB -> ${(content.length / 1e6).toFixed(2)} MB stored`);
  }

  // Analysis tables.
  const ring = (p) => {
    const pts = [];
    for (let i = 0; i < p.length; i += 2) pts.push([lon(p[i]), lat(p[i + 1])]);
    if (pts.length && (pts[0][0] !== pts.at(-1)[0] || pts[0][1] !== pts.at(-1)[1])) pts.push(pts[0]);
    return pts;
  };
  const wkt = (pts) => pts.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join(", ");
  const shoelace = (p) => {
    let a = 0;
    for (let i = 0; i + 3 < p.length; i += 2) a += p[i] * p[i + 3] - p[i + 2] * p[i + 1];
    return Math.abs(a / 2) * cellSizeM * cellSizeM;
  };
  const buildings = map.buildings.map((b, i) => {
    const pts = ring(b.p);
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    return [["TEXT", id], ["FIXED", i], ["REAL", b.h], ["REAL", Math.round(shoelace(b.p))], ["REAL", cy], ["REAL", cx], ["TEXT", `POLYGON((${wkt(pts)}))`]];
  });
  const roads = map.roads.map((r, i) => {
    const pts = [];
    let len = 0;
    for (let k = 0; k < r.p.length; k += 2) {
      pts.push([lon(r.p[k]), lat(r.p[k + 1])]);
      if (k >= 2) len += Math.hypot(r.p[k] - r.p[k - 2], r.p[k + 1] - r.p[k - 1]) * cellSizeM;
    }
    return [["TEXT", id], ["FIXED", i], ["TEXT", map.roadNames[r.n] ?? null], ["REAL", r.w], ["REAL", Math.round(len)], ["TEXT", `LINESTRING(${wkt(pts)})`]];
  });
  const placeRows = places.map((p) => [["TEXT", id], ["TEXT", p.id], ["TEXT", p.name], ["TEXT", p.kind], ["TEXT", p.type], ["REAL", p.lat], ["REAL", p.lon], ["FIXED", p.capacity], ["TEXT", p.capacitySource]]);
  await replaceRows(id, "BUILDINGS", ["AREA_ID", "BUILDING_ID", "HEIGHT_M", "AREA_M2", "CENTER_LAT", "CENTER_LON", "FOOTPRINT_WKT"], buildings);
  await replaceRows(id, "ROADS", ["AREA_ID", "ROAD_ID", "NAME", "WIDTH_M", "LENGTH_M", "PATH_WKT"], roads);
  await replaceRows(id, "PLACES", ["AREA_ID", "PLACE_ID", "NAME", "KIND", "TYPE", "LAT", "LON", "CAPACITY", "CAPACITY_SOURCE"], placeRows);

  // Listed last, so the website only offers the area once its files are all there.
  const population = world.population.reduce((a, b) => a + b, 0);
  await run(`DELETE FROM AREAS WHERE AREA_ID = ?`, textBindings([id]));
  const row = [["TEXT", id], ["TEXT", name], ["REAL", S], ["REAL", W], ["REAL", N], ["REAL", E], ["FIXED", width], ["FIXED", height], ["REAL", cellSizeM], ["FIXED", map.buildings.length], ["REAL", Math.round(population)], ["FIXED", Date.now()]];
  await run(
    `INSERT INTO AREAS (AREA_ID, NAME, SOUTH, WEST, NORTH, EAST, WIDTH, HEIGHT, CELL_SIZE_M, BUILDINGS, POPULATION, VERSION) SELECT ${row.map(() => "?").join(", ")}`,
    bind(row),
  );
  console.log(`  ${buildings.length} buildings, ${roads.length} roads, ${placeRows.length} places · done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

function bind(values) {
  return Object.fromEntries(values.map(([type, v], i) => [String(i + 1), { type, value: v == null ? null : String(v) }]));
}

async function replaceRows(id, table, columns, rows) {
  await run(`DELETE FROM ${table} WHERE AREA_ID = ?`, textBindings([id]));
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + ROWS_PER_INSERT);
    const group = `(${columns.map(() => "?").join(", ")})`;
    await run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => group).join(", ")}`, bind(chunk.flat()));
  }
}
