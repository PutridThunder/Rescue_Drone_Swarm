// Snowflake storage: /api/snowflake
//
//   POST  {kind: "mission" | "game", ...}  adds a row (a finished mission or challenge game)
//   GET                                    summary for the History panel: totals, per-area
//                                          averages, algorithm-vs-human record, recent rows
//
// Runs on the server only (a Vercel function, and the Vite dev server via
// server/snowflake/vitePlugin.ts), so the Snowflake token never reaches the browser. It talks to
// Snowflake's SQL API (plain HTTPS), with an access token for a user that can only read and add
// rows to two tables (see snowflake/setup.sql). Maps are not stored: they ship with the website.
//
// Environment: SNOWFLAKE_ACCOUNT (e.g. MYORG-MYACCOUNT), SNOWFLAKE_TOKEN (required);
// SNOWFLAKE_WAREHOUSE / _DATABASE / _SCHEMA / _ROLE (optional, defaults match setup.sql).
// SNOWFLAKE_API_URL (optional) overrides the SQL API address, e.g. for a local test stub.
//
// Self-contained on purpose (no local imports) so Vercel can bundle it as is.

const TIMEOUT_MS = 25_000;
const RECORD_GAP_MS = 3_000; // per visitor, between writes
const HISTORY_CACHE_MS = 30_000;
const MAX_TIMELINE = 150;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status; // (no parameter properties: Node runs this file directly in tests and scripts)
  }
}

/** Server environment, read without needing Node's type definitions (see api/tsconfig.json). */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

export async function GET(): Promise<Response> {
  try {
    return json(200, await history());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    config(); // fail early, and cheaply, when Snowflake isn't set up
    const visitor = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const body = await request.json().catch(() => null);
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

type Bindings = Record<string, { type: string; value: string | null }>;

async function run(statement: string, bindings?: Bindings): Promise<{ columns: string[]; rows: Value[][] }> {
  const c = config();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${c.token}`,
    "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
    "User-Agent": "rescue-drone-swarm/1.0",
  };
  let body = await call(c.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ statement, timeout: 45, database: c.database, schema: c.schema, warehouse: c.warehouse, role: c.role, ...(bindings ? { bindings } : {}) }),
  });
  // 202: still running (e.g. the warehouse is waking up): poll until it's done.
  for (let tries = 0; body.status === 202 && tries < 20; tries++) {
    await new Promise((r) => setTimeout(r, 1000));
    body = await call(`${c.url}/${body.json.statementHandle}`, { headers });
  }
  const meta = body.json.resultSetMetaData;
  const rows = body.json.data ?? [];
  // Large results come in partitions; the first is in the response, fetch the rest.
  const partitions = meta?.partitionInfo?.length ?? 1;
  for (let p = 1; p < partitions; p++) {
    const part = await call(`${c.url}/${body.json.statementHandle}?partition=${p}`, { headers });
    rows.push(...(part.json.data ?? []));
  }
  return { columns: (meta?.rowType ?? []).map((r) => r.name), rows };
}

interface SqlApiBody {
  message?: string;
  statementHandle?: string;
  data?: Value[][];
  resultSetMetaData?: { rowType?: { name: string }[]; partitionInfo?: unknown[] };
}

async function call(url: string, init: RequestInit): Promise<{ status: number; json: SqlApiBody }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, "Could not reach Snowflake (check SNOWFLAKE_ACCOUNT).");
  }
  const json = ((await res.json().catch(() => null)) ?? {}) as SqlApiBody;
  if (!res.ok) {
    console.error("Snowflake error", res.status, json.message);
    // A table or view the app needs isn't there yet: say which setup file creates it.
    const missing = /Object '([A-Z_.]+)' does not exist or not authorized/i.exec(json.message ?? "")?.[1]?.split(".").pop()?.toUpperCase();
    if (missing) throw new HttpError(503, `Snowflake's ${missing} does not exist yet: run the latest snowflake/setup.sql (safe to run again).`);
    if (res.status === 401 || res.status === 403) throw new HttpError(502, `Snowflake refused the token (${res.status}): ${json.message ?? "check SNOWFLAKE_TOKEN and its expiry"}`);
    throw new HttpError(502, `Snowflake error ${res.status}: ${json.message ?? res.statusText}`);
  }
  return { status: res.status, json };
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
