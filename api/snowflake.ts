// Snowflake storage: /api/snowflake
//
//   POST  {kind: "mission" | "game", ...}  adds a row (a finished mission or challenge game)
//   GET                                    summary for the History panel: totals, per-area
//                                          averages, algorithm-vs-human record, recent rows
//   GET   ?areas                           the areas stored in Snowflake (id, name, bbox, version)
//   GET   ?search=<city>                   places matching a (partial) name (Photon, OSM-based),
//                                          each with the grid of map parts covering it
//   POST  {kind: "build", part: "<id>"}    builds that map part from OpenStreetMap if it isn't
//                                          stored yet, stores it, and returns its id
//   GET   ?area=<id>&file=<name>           one of an area's map files (world.json, map.json,
//                                          places.json, eo.json, satellite.jpg)
//
// Map files are uploaded by the Python pipeline (npm run maps:upload) and served with long
// CDN caching, so Snowflake is queried about once per file per day, not on every visit.
//
// Runs on the server only (a Vercel function, and the Vite dev server via
// server/snowflake/vitePlugin.ts), so the Snowflake token never reaches the browser. It talks to
// Snowflake's SQL API (plain HTTPS), with an access token for a user that can only read and add
// rows to two tables (see snowflake/setup.sql).
//
// Environment: SNOWFLAKE_ACCOUNT (e.g. MYORG-MYACCOUNT), SNOWFLAKE_TOKEN (required);
// SNOWFLAKE_WAREHOUSE / _DATABASE / _SCHEMA / _ROLE (optional, defaults match setup.sql).
// SNOWFLAKE_API_URL (optional) overrides the SQL API address, e.g. for a local test stub.
//
// TypeScript-wise self-contained (Vercel bundles it as is); the map builder and the world grid
// are plain JavaScript modules shared with the command line and the browser.

import { buildWorld, formatWorldJson } from "../scripts/lib/buildWorld.mjs";
import { partFromId, partsCovering, type Part } from "../scripts/lib/worldGrid.mjs";

const TIMEOUT_MS = 25_000;
const RECORD_GAP_MS = 3_000; // per visitor, between writes
const HISTORY_CACHE_MS = 30_000;
const MAX_TIMELINE = 150;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status; // (no parameter properties: Node runs this file directly in scripts)
  }
}

/** Server environment, read without needing Node's type definitions (see api/tsconfig.json). */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

export async function GET(request?: Request): Promise<Response> {
  try {
    const params = new URL(request?.url ?? "http://x/").searchParams;
    if (params.has("areas")) return json(200, { areas: await listAreas() }, AREA_LIST_CACHE);
    const search = params.get("search");
    if (search !== null) return json(200, { places: await searchPlaces(search) }, SEARCH_CACHE);
    const area = params.get("area");
    if (area !== null) return await areaFile(area, params.get("file") ?? "");
    return json(200, await history());
  } catch (err) {
    return fail(err);
  }
}

// --- Maps ------------------------------------------------------------------------------------

const AREA_ID = /^[a-z0-9-]{1,40}$/;
const FILE_TYPES: Record<string, string> = {
  "world.json": "application/json",
  "map.json": "application/json",
  "places.json": "application/json",
  "eo.json": "application/json",
  "satellite.jpg": "image/jpeg",
};
// Browsers keep a file 5 min; Vercel's CDN a day (refreshed in the background). Uploads change
// the area's version, which is part of the file URL, so new maps show up at once.
const AREA_FILE_CACHE = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";
const AREA_LIST_CACHE = "public, max-age=60, s-maxage=60, stale-while-revalidate=600";

export interface StoredArea {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  version: number;
}

let cachedAreas: { at: number; areas: StoredArea[] } | null = null;

async function listAreas(): Promise<StoredArea[]> {
  if (cachedAreas && Date.now() - cachedAreas.at < 60_000) return cachedAreas.areas;
  // One row per area even if two uploads raced (the newest wins).
  const rows = await query(
    `SELECT AREA_ID, NAME, SOUTH, WEST, NORTH, EAST, VERSION FROM AREAS QUALIFY ROW_NUMBER() OVER (PARTITION BY AREA_ID ORDER BY VERSION DESC) = 1 ORDER BY NAME`,
  );
  const areas: StoredArea[] = rows.map((r) => ({ id: String(r.AREA_ID), name: String(r.NAME), bbox: [n(r.SOUTH), n(r.WEST), n(r.NORTH), n(r.EAST)], version: n(r.VERSION) }));
  cachedAreas = { at: Date.now(), areas };
  return areas;
}

async function areaFile(area: string, file: string): Promise<Response> {
  const type = FILE_TYPES[file];
  if (!AREA_ID.test(area) || !type) throw new HttpError(400, "unknown area or file");
  const [row] = await query(`SELECT ENCODING, CONTENT FROM AREA_FILES WHERE AREA_ID = ? AND FILE = ? LIMIT 1`, [area, file]);
  if (!row?.CONTENT) throw new HttpError(404, `${area}/${file} is not in Snowflake`);
  let bytes = base64ToBytes(String(row.CONTENT));
  if (row.ENCODING === "gzip") bytes = await gunzip(bytes);
  return new Response(bytes, { status: 200, headers: { "Content-Type": type, "Cache-Control": AREA_FILE_CACHE } });
}

// --- City search and building parts on demand ------------------------------------------------

const NOMINATIM = "https://nominatim.openstreetmap.org"; // naming a part when it's built
const PHOTON = "https://photon.komoot.io/api/"; // search as you type
const UA = "rescue-drone-swarm/1.0 (hackathon search-and-rescue simulation)";
const SEARCH_CACHE = "public, max-age=3600, s-maxage=86400";
const BUILD_GAP_MS = 20_000; // per visitor: OpenStreetMap's servers are shared and free
let building = false; // one build at a time per server instance
const lastBuild = new Map<string, number>();
let lastNominatim = 0; // Nominatim asks for at most one request per second

export interface PlaceResult {
  name: string; // e.g. "Tokyo"
  label: string; // e.g. "Tokyo, Japan"
  type: string; // e.g. "city"
  lat: number;
  lon: number;
  parts: Part[][]; // rows north to south; one part = one playable map
}

async function nominatim(path: string): Promise<unknown> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(`${NOMINATIM}${path}`, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new HttpError(502, `Place search failed (HTTP ${res.status}); try again in a moment.`);
  return res.json();
}

/**
 * Places matching a (possibly partial) name, for search-as-you-type. Uses Photon (free,
 * OpenStreetMap-based, made for autocomplete; Nominatim's rules forbid that), limited to
 * cities, districts, neighbourhoods and counties so "shibu" doesn't suggest bus stops.
 */
export async function searchPlaces(q: string): Promise<PlaceResult[]> {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 100);
  if (query.length < 2) throw new HttpError(400, "type a place name");
  const layers = ["city", "district", "locality", "county"].map((l) => `&layer=${l}`).join("");
  const res = await fetch(`${PHOTON}?q=${encodeURIComponent(query)}&limit=8&lang=en${layers}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) throw new HttpError(502, "Place search is unavailable right now; try again in a moment.");
  const body = (await res.json()) as {
    features: {
      geometry: { coordinates: [number, number] };
      properties: { name?: string; city?: string; county?: string; state?: string; country?: string; type?: string; extent?: [number, number, number, number] };
    }[];
  };
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const f of body.features) {
    const p = f.properties;
    if (!p.name) continue;
    const [lon, lat] = f.geometry.coordinates;
    const label = [p.name, p.city, p.state, p.country].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");
    if (seen.has(label)) continue;
    seen.add(label);
    // extent = [minLon, maxLat, maxLon, minLat]; a point (no extent) is one map part.
    const [w, nn, e, s] = p.extent ?? [lon, lat, lon, lat];
    out.push({ name: p.name, label, type: p.type ?? "place", lat, lon, parts: partsCovering([s, w, nn, e], [lat, lon]) });
    if (out.length === 6) break;
  }
  return out;
}

/** A readable name for a part: the neighbourhood and city at its centre. */
async function partName(p: Part): Promise<string> {
  try {
    const r = (await nominatim(`/reverse?format=jsonv2&zoom=14&lat=${p.center[0]}&lon=${p.center[1]}`)) as { address?: Record<string, string> };
    const a = r.address ?? {};
    const local = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.town || a.village;
    const city = a.city || a.town || a.municipality || a.county || a.state;
    const name = [local, city].filter((v, i, arr) => v && arr.indexOf(v) === i).join(", ");
    if (name) return name.slice(0, 80);
  } catch {
    // fall through to a coordinate name
  }
  return `Area ${p.center[0].toFixed(3)}, ${p.center[1].toFixed(3)}`;
}

export async function buildPart(id: string, visitor: string): Promise<{ id: string; name: string; built: boolean }> {
  const p = partFromId(id);
  if (!p) throw new HttpError(400, "unknown map part");
  const [existing] = await query(`SELECT NAME FROM AREAS WHERE AREA_ID = ? LIMIT 1`, [p.id]);
  if (existing) return { id: p.id, name: String(existing.NAME), built: false };

  const now = Date.now();
  if ((lastBuild.get(visitor) ?? 0) + BUILD_GAP_MS > now) throw new HttpError(429, "One new map at a time: wait a few seconds and try again.");
  if (building) throw new HttpError(429, "Another map is being built right now; try again in a moment.");
  lastBuild.set(visitor, now);
  building = true;
  try {
    const name = await partName(p);
    let built;
    try {
      built = await buildWorld({ name, bbox: p.bbox, log: () => {}, overpassTimeoutMs: 22_000, attempts: 1 });
    } catch {
      throw new HttpError(502, "OpenStreetMap is busy right now; try again in a minute.");
    }
    await storeArea(p, name, built.world, built.map, built.buildingCount);
    return { id: p.id, name, built: true };
  } finally {
    building = false;
  }
}

export async function storeArea(p: Part, name: string, world: Record<string, unknown> & { meta: { width: number; height: number; cellSizeM: number } }, map: unknown, buildings: number) {
  const files: [string, string][] = [
    ["world.json", formatWorldJson(world)],
    ["map.json", JSON.stringify(map)],
  ];
  const population = (world.population as number[]).reduce((a, b) => a + b, 0);
  await run(`DELETE FROM AREA_FILES WHERE AREA_ID = ?`, textBindings([p.id]));
  for (const [file, text] of files) {
    const bytes = new TextEncoder().encode(text);
    await run(`INSERT INTO AREA_FILES (AREA_ID, FILE, ENCODING, BYTES, CONTENT) SELECT ?, ?, 'gzip', ?, ?`, {
      ...textBindings([p.id, file]),
      "3": { type: "FIXED", value: String(bytes.length) },
      "4": { type: "TEXT", value: bytesToBase64(await gzip(bytes)) },
    });
  }
  await run(`DELETE FROM AREAS WHERE AREA_ID = ?`, textBindings([p.id]));
  const [S, W, N, E] = p.bbox;
  const values: [string, string][] = [
    ["TEXT", p.id], ["TEXT", name], ["REAL", String(S)], ["REAL", String(W)], ["REAL", String(N)], ["REAL", String(E)],
    ["FIXED", String(world.meta.width)], ["FIXED", String(world.meta.height)], ["REAL", String(world.meta.cellSizeM)],
    ["FIXED", String(buildings)], ["REAL", String(Math.round(population))], ["FIXED", String(Date.now())],
  ];
  await run(
    `INSERT INTO AREAS (AREA_ID, NAME, SOUTH, WEST, NORTH, EAST, WIDTH, HEIGHT, CELL_SIZE_M, BUILDINGS, POPULATION, VERSION) SELECT ${values.map(() => "?").join(", ")}`,
    Object.fromEntries(values.map(([type, value], i) => [String(i + 1), { type, value }])),
  );
  cachedAreas = null;
}

export const textBindings = (values: string[]): Bindings => Object.fromEntries(values.map((v, i) => [String(i + 1), { type: "TEXT", value: v }]));

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function POST(request: Request): Promise<Response> {
  try {
    config(); // fail early, and cheaply, when Snowflake isn't set up
    const visitor = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const body = await request.json().catch(() => null);
    if ((body as { kind?: string } | null)?.kind === "build") return json(200, await buildPart(String((body as { part?: unknown }).part ?? ""), visitor));
    throttle(visitor);
    const table = (body as { kind?: string } | null)?.kind === "game" ? "GAMES" : "MISSIONS";
    const row = table === "GAMES" ? parseGame(body) : parseMission(body);
    await insert(table, row);
    cached = null; // the next History read includes this row
    return json(200, { ok: true });
  } catch (err) {
    return fail(err);
  }
}

// --- Rows ------------------------------------------------------------------------------------

type Column = { value: Value; type: "TEXT" | "FIXED" | "REAL" | "BOOLEAN" | "JSON" };
type NewRow = Record<string, Column>;

export function parseMission(body: unknown): NewRow {
  const b = (body ?? {}) as Record<string, unknown>;
  const timeline = Array.isArray(b.timeline) ? b.timeline.slice(0, MAX_TIMELINE) : [];
  return {
    AREA: text(b.area, 80),
    SCENARIO: text(b.scenario === "tsunami" ? "tsunami" : "none", 20),
    DRONES: int(b.drones, 1, 50),
    TRUCKS: int(b.trucks, 1, 20),
    STREET_MAP: bool(b.streetMap),
    SEARCH_RADIUS_M: b.searchRadiusM == null ? nul("REAL") : num(b.searchRadiusM, 0, 100_000),
    SEED: int(b.seed, 0, 2_000_000_000),
    SURVIVORS_TOTAL: int(b.survivorsTotal, 0, 10_000),
    SURVIVORS_FOUND: int(b.survivorsFound, 0, 10_000),
    SURVIVORS_LOST: int(b.survivorsLost, 0, 10_000),
    DURATION_S: num(b.durationS, 0, 100_000),
    AREA_SEARCHED: num(b.areaSearched, 0, 1),
    REDUNDANCY: num(b.redundancy, 0, 1),
    DISTANCE_KM: num(b.distanceKm, 0, 100_000),
    BATTERY_USED: num(b.batteryUsed, 0, 100_000),
    FAILURES: int(b.failures, 0, 1000),
    TIMELINE: { type: "JSON", value: JSON.stringify(timeline.map((p) => (Array.isArray(p) ? p.slice(0, 3).map((n) => Math.round(Number(n) * 1000) / 1000 || 0) : []))) },
  };
}

export function parseGame(body: unknown): NewRow {
  const b = (body ?? {}) as Record<string, unknown>;
  const winner = b.winner === "human" || b.winner === "algorithm" ? b.winner : "tie";
  return {
    AREA: text(b.area, 80),
    SURVIVORS_TOTAL: int(b.survivorsTotal, 0, 10_000),
    HUMAN_FOUND: int(b.humanFound, 0, 10_000),
    HUMAN_HECTARES: num(b.humanHectares, 0, 100_000),
    AI_FOUND: int(b.aiFound, 0, 10_000),
    AI_HECTARES: num(b.aiHectares, 0, 100_000),
    WINNER: text(winner, 20),
    DURATION_S: num(b.durationS, 0, 100_000),
  };
}

const text = (v: unknown, max: number): Column => ({ type: "TEXT", value: typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "" });
const bool = (v: unknown): Column => ({ type: "BOOLEAN", value: v === true });
const nul = (type: Column["type"]): Column => ({ type, value: null });
function int(v: unknown, min: number, max: number): Column {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, "invalid number");
  return { type: "FIXED", value: Math.round(Math.min(max, Math.max(min, n))) };
}
function num(v: unknown, min: number, max: number): Column {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, "invalid number");
  return { type: "REAL", value: Math.round(Math.min(max, Math.max(min, n)) * 10_000) / 10_000 };
}

// --- History ---------------------------------------------------------------------------------

export interface History {
  missions: { count: number; avgDurationS: number; avgAreaSearched: number; survivorsFound: number; survivorsTotal: number };
  byArea: { area: string; count: number; avgDurationS: number; avgFoundShare: number }[];
  games: { count: number; algorithmWins: number; humanWins: number; ties: number; humanFound: number; aiFound: number };
  recent: { kind: "mission" | "game"; at: string; area: string; summary: string }[];
}

let cached: { at: number; data: History } | null = null;

export async function history(): Promise<History> {
  if (cached && Date.now() - cached.at < HISTORY_CACHE_MS) return cached.data;
  const [totals, byArea, games, missions, recentGames] = await Promise.all([
    query(`SELECT COUNT(*) N, AVG(DURATION_S) T, AVG(AREA_SEARCHED) A, SUM(SURVIVORS_FOUND) F, SUM(SURVIVORS_TOTAL) S FROM MISSIONS`),
    query(`SELECT AREA, COUNT(*) N, AVG(DURATION_S) T, AVG(IFF(SURVIVORS_TOTAL > 0, SURVIVORS_FOUND / SURVIVORS_TOTAL, NULL)) F FROM MISSIONS GROUP BY AREA ORDER BY N DESC LIMIT 6`),
    query(`SELECT COUNT(*) N, COUNT_IF(WINNER = 'algorithm') AI, COUNT_IF(WINNER = 'human') H, COUNT_IF(WINNER = 'tie') T, SUM(HUMAN_FOUND) HF, SUM(AI_FOUND) AF FROM GAMES`),
    query(`SELECT TO_VARCHAR(CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AT, AREA, SURVIVORS_FOUND F, SURVIVORS_TOTAL S, DURATION_S T FROM MISSIONS ORDER BY CREATED_AT DESC LIMIT 5`),
    query(`SELECT TO_VARCHAR(CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AT, AREA, WINNER W, HUMAN_FOUND HF, AI_FOUND AF FROM GAMES ORDER BY CREATED_AT DESC LIMIT 5`),
  ]);
  const t = totals[0] ?? {};
  const g = games[0] ?? {};
  const recent = [
    ...missions.map((r) => ({ kind: "mission" as const, at: String(r.AT), area: String(r.AREA), summary: `${r.F}/${r.S} survivors in ${Math.round(Number(r.T))} s` })),
    ...recentGames.map((r) => ({ kind: "game" as const, at: String(r.AT), area: String(r.AREA), summary: `${r.W === "tie" ? "tie" : r.W === "human" ? "you won" : "algorithm won"} (${r.HF} vs ${r.AF})` })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  const data: History = {
    missions: { count: n(t.N), avgDurationS: n(t.T), avgAreaSearched: n(t.A), survivorsFound: n(t.F), survivorsTotal: n(t.S) },
    byArea: byArea.map((r) => ({ area: String(r.AREA), count: n(r.N), avgDurationS: n(r.T), avgFoundShare: n(r.F) })),
    games: { count: n(g.N), algorithmWins: n(g.AI), humanWins: n(g.H), ties: n(g.T), humanFound: n(g.HF), aiFound: n(g.AF) },
    recent,
  };
  cached = { at: Date.now(), data };
  return data;
}

const n = (v: Value | undefined) => (v == null ? 0 : Number(v) || 0);

// --- Snowflake SQL API -----------------------------------------------------------------------

function config() {
  const account = env.SNOWFLAKE_ACCOUNT?.trim();
  const token = env.SNOWFLAKE_TOKEN?.trim();
  if (!account || !token) throw new HttpError(503, "Snowflake is not configured: set SNOWFLAKE_ACCOUNT and SNOWFLAKE_TOKEN on the server.");
  if (!/^[A-Za-z0-9._-]+$/.test(account)) throw new HttpError(503, "SNOWFLAKE_ACCOUNT looks wrong (use ORGNAME-ACCOUNTNAME, e.g. MYORG-MYACCOUNT).");
  return {
    // Hostnames can't contain "_": Snowflake uses "-" in place of underscores in account URLs.
    url: env.SNOWFLAKE_API_URL || `https://${account.toLowerCase().replace(/_/g, "-").replace(/\.snowflakecomputing\.com$/, "")}.snowflakecomputing.com/api/v2/statements`,
    token,
    warehouse: env.SNOWFLAKE_WAREHOUSE || "RESCUE_WH",
    database: env.SNOWFLAKE_DATABASE || "RESCUE_DRONES",
    schema: env.SNOWFLAKE_SCHEMA || "APP",
    role: env.SNOWFLAKE_ROLE || "RESCUE_APP",
  };
}

export type Bindings = Record<string, { type: string; value: string | null }>;

export async function run(statement: string, bindings?: Bindings): Promise<{ columns: string[]; rows: Value[][] }> {
  const c = config();
  let res: Response;
  try {
    res = await fetch(c.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${c.token}`,
        "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
        "User-Agent": "rescue-drone-swarm/1.0",
      },
      body: JSON.stringify({ statement, timeout: 30, database: c.database, schema: c.schema, warehouse: c.warehouse, role: c.role, ...(bindings ? { bindings } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, "Could not reach Snowflake (check SNOWFLAKE_ACCOUNT).");
  }
  const body = (await res.json().catch(() => null)) as { message?: string; data?: Value[][]; resultSetMetaData?: { rowType?: { name: string }[] } } | null;
  if (!res.ok) {
    console.error("Snowflake error", res.status, body?.message);
    if (res.status === 401 || res.status === 403) throw new HttpError(502, `Snowflake refused the token (${res.status}): ${body?.message ?? "check SNOWFLAKE_TOKEN and its expiry"}`);
    throw new HttpError(502, `Snowflake error ${res.status}: ${body?.message ?? res.statusText}`);
  }
  return { columns: (body?.resultSetMetaData?.rowType ?? []).map((r) => r.name), rows: body?.data ?? [] };
}

async function query(statement: string, params: string[] = []): Promise<Row[]> {
  const bindings: Bindings = Object.fromEntries(params.map((v, i) => [String(i + 1), { type: "TEXT", value: v }]));
  const { columns, rows } = await run(statement, params.length ? bindings : undefined);
  return rows.map((r) => Object.fromEntries(columns.map((name, i) => [name, r[i] ?? null])));
}

async function insert(table: "MISSIONS" | "GAMES", row: NewRow) {
  const names = Object.keys(row);
  const bindings: Bindings = {};
  const marks = names.map((name, i) => {
    const col = row[name];
    bindings[String(i + 1)] = { type: col.type === "JSON" ? "TEXT" : col.type, value: col.value == null ? null : String(col.value) };
    return col.type === "JSON" ? "PARSE_JSON(?)" : "?";
  });
  await run(`INSERT INTO ${table} (${names.join(", ")}) SELECT ${marks.join(", ")}`, bindings);
}

// --- Plumbing --------------------------------------------------------------------------------

const lastWrite = new Map<string, number>();

function throttle(visitor: string) {
  const now = Date.now();
  const wait = (lastWrite.get(visitor) ?? 0) + RECORD_GAP_MS - now;
  if (wait > 0) throw new HttpError(429, "Too many results at once; slow down.");
  lastWrite.set(visitor, now);
  if (lastWrite.size > 1000) lastWrite.clear();
}

function fail(err: unknown): Response {
  const status = err instanceof HttpError ? err.status : 502;
  return json(status, { error: (err as Error).message });
}

function json(status: number, body: unknown, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}
