import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, history, overtureSource, parseGame, parseMission, POST, toOsm } from "../../api/snowflake";
import { MissionRecorder } from "./MissionRecorder";

const MISSION = {
  kind: "mission", area: "Lonsdale, North Vancouver", scenario: "tsunami", drones: 6, trucks: 2, streetMap: true, searchRadiusM: null, seed: 42,
  survivorsTotal: 25, survivorsFound: 24, survivorsLost: 1, durationS: 450.5, areaSearched: 0.93, redundancy: 0.3, distanceKm: 12.3, batteryUsed: 4.1, failures: 0,
  timeline: [[0, 0, 0], [10, 0.05, 1]],
};
let clock = Date.parse("2026-10-03T12:00:00Z");
const post = (body: unknown, ip = "9.9.9.9") => new Request("http://x/api/snowflake", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": ip } });
const sql = (rows: Record<string, string | null>[]) =>
  Response.json({ resultSetMetaData: { rowType: rows[0] ? Object.keys(rows[0]).map((name) => ({ name })) : [] }, data: rows.map((r) => Object.values(r)) });

describe("Snowflake storage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    clock += 3600_000; // clear of the history cache and write throttle from earlier tests
    vi.setSystemTime(clock);
    process.env.SNOWFLAKE_ACCOUNT = "myorg-myaccount";
    process.env.SNOWFLAKE_TOKEN = "secret-token";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const k of ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_TOKEN"]) delete process.env[k];
  });

  it("clamps and validates what the browser sends", () => {
    const row = parseMission({ ...MISSION, drones: 9999, areaSearched: 7, area: "x".repeat(500) });
    expect(row.DRONES.value).toBe(50);
    expect(row.AREA_SEARCHED.value).toBe(1);
    expect(String(row.AREA.value).length).toBe(80);
    expect(row.SEARCH_RADIUS_M.value).toBeNull();
    expect(() => parseMission({ ...MISSION, seed: "abc" })).toThrow();
    expect(parseGame({ winner: "cheater", survivorsTotal: 5, humanFound: 1, humanHectares: 1, aiFound: 2, aiHectares: 2, durationS: 150 }).WINNER.value).toBe("tie");
  });

  it("says so when Snowflake isn't configured", async () => {
    delete process.env.SNOWFLAKE_TOKEN;
    const res = await POST(post(MISSION));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SNOWFLAKE_TOKEN/);
    expect((await GET()).status).toBe(503);
  });

  it("inserts a mission with bound values and the token in headers only", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(post(MISSION));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://myorg-myaccount.snowflakecomputing.com/api/v2/statements");
    expect(url).not.toContain("secret-token");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
    expect(headers["X-Snowflake-Authorization-Token-Type"]).toBe("PROGRAMMATIC_ACCESS_TOKEN");
    const sent = JSON.parse(init.body as string);
    expect(sent.statement).toMatch(/^INSERT INTO MISSIONS \(AREA, SCENARIO.*\) SELECT \?, \?.*PARSE_JSON\(\?\)$/);
    expect(sent.statement).not.toContain("Lonsdale"); // values are bound, never pasted into SQL
    expect(sent.role).toBe("RESCUE_APP");
    expect(sent.bindings["1"]).toEqual({ type: "TEXT", value: "Lonsdale, North Vancouver" });
    expect(sent.bindings["5"]).toEqual({ type: "BOOLEAN", value: "true" });
    expect(sent.bindings["6"]).toEqual({ type: "REAL", value: null }); // no search circle
    expect(JSON.parse(sent.bindings["17"].value)).toEqual([[0, 0, 0], [10, 0.05, 1]]);
  });

  it("turns underscores in the account name into hyphens for the URL", async () => {
    process.env.SNOWFLAKE_ACCOUNT = "MYORG-MY_ACCOUNT";
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await POST(post(MISSION, "8.8.8.8"));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://myorg-my-account.snowflakecomputing.com/api/v2/statements");
  });

  it("slows down rapid writes from one visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    expect((await POST(post(MISSION, "5.5.5.5"))).status).toBe(200);
    expect((await POST(post(MISSION, "5.5.5.5"))).status).toBe(429);
    expect((await POST(post(MISSION, "6.6.6.6"))).status).toBe(200);
  });

  it("builds the history summary and caches it briefly", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const s = JSON.parse(init.body as string).statement as string;
      if (s.includes("FROM GAMES") && s.includes("COUNT_IF")) return sql([{ N: "10", AI: "7", H: "2", T: "1", HF: "30", AF: "60" }]);
      if (s.includes("GROUP BY AREA")) return sql([{ AREA: "Lonsdale", N: "4", T: "420.5", F: "0.9" }]);
      if (s.includes("FROM MISSIONS") && s.includes("COUNT(*) N, AVG")) return sql([{ N: "4", T: "420.5", A: "0.92", F: "90", S: "100" }]);
      if (s.includes("FROM MISSIONS")) return sql([{ AT: "2026-10-03T12:00:00-07:00", AREA: "Lonsdale", F: "24", S: "25", T: "450" }]);
      return sql([{ AT: "2026-10-03T13:00:00-07:00", AREA: "Lonsdale", W: "algorithm", HF: "3", AF: "7" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const h = await history();
    expect(h.games).toEqual({ count: 10, algorithmWins: 7, humanWins: 2, ties: 1, humanFound: 30, aiFound: 60 });
    expect(h.missions.avgDurationS).toBe(420.5);
    expect(h.byArea[0]).toEqual({ area: "Lonsdale", count: 4, avgDurationS: 420.5, avgFoundShare: 0.9 });
    expect(h.recent[0].summary).toBe("algorithm won (3 vs 7)"); // newest first
    const calls = fetchMock.mock.calls.length;
    await history();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("explains a refused token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Programmatic access token is invalid." }, { status: 401 })));
    const res = await POST(post(MISSION, "7.7.7.7"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/refused the token/);
  });

  it("turns Overture GeoJSON into Overpass-style elements", () => {
    const square = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
    const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]];
    expect(toOsm(JSON.stringify({ type: "Polygon", coordinates: square }), { building: "yes" }, true)[0]).toMatchObject({ type: "way", geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: 0 }] });
    const withHole = toOsm(JSON.stringify({ type: "Polygon", coordinates: [square[0], hole] }), { natural: "water" }, false)[0];
    expect(withHole.type).toBe("relation");
    expect(withHole.members!.map((m) => m.role)).toEqual(["outer", "inner"]);
    expect(toOsm(JSON.stringify({ type: "MultiPolygon", coordinates: [square, square] }), { building: "yes" }, true)).toHaveLength(2);
    expect(toOsm(JSON.stringify({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]] }), { highway: "primary" }, true)).toHaveLength(2);
    expect(toOsm("not json", {}, true)).toEqual([]);
  });

  it("reads Overture views across result partitions and after a 202", async () => {
    const building = JSON.stringify({ type: "Polygon", coordinates: [[[-123.08, 49.31], [-123.079, 49.31], [-123.079, 49.311], [-123.08, 49.31]]] });
    const rows = (n: number) => Array.from({ length: n }, () => [building, "12", null, "house"]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("?partition=1")) return Response.json({ data: rows(3) });
      if (url.includes("/statements/h1")) return Response.json({ statementHandle: "h1", resultSetMetaData: { rowType: [{ name: "G" }, { name: "HEIGHT" }, { name: "LEVELS" }, { name: "KIND" }], partitionInfo: [{}, {}] }, data: rows(2) });
      const s = JSON.parse(init!.body as string).statement as string;
      if (s.includes("OV_BUILDINGS")) return Response.json({ statementHandle: "h1" }, { status: 202 });
      return Response.json({ resultSetMetaData: { rowType: [{ name: "G" }] }, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await overtureSource({ bbox: [49.3, -123.1, 49.32, -123.06] });
    expect(out.buildings.elements).toHaveLength(5); // 2 in the first partition + 3 in the second
    expect((out.buildings.elements[0] as { tags: Record<string, string> }).tags).toEqual({ building: "house", height: "12" });
  });

  it("records a mission timeline every 10 simulated seconds", () => {
    const rec = new MissionRecorder();
    const state = (time: number) => ({ time, running: true, config: { scenario: "none", droneCount: 6, truckCount: 2, seed: 1, info: { geography: true }, searchArea: { x: 1, y: 1, r: 20 } }, metrics: { areaSearchedFrac: time / 100, survivorsFound: Math.floor(time / 20), survivorsTotal: 5, survivorsLost: 0, time, redundancyFrac: 0.2, distanceTravelled: 100, batteryConsumed: 2, droneFailures: 0 } }) as never;
    for (const t of [0, 3, 10, 14, 20, 27]) rec.sample(state(t));
    const r = rec.finish(state(30), "Test", 10);
    expect(r.timeline.map((p) => p[0])).toEqual([0, 10, 20, 30]);
    expect(r.searchRadiusM).toBe(200);
    expect(r.distanceKm).toBe(1);
  });
});
