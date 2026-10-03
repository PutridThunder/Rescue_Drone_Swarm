import { describe, expect, it } from "vitest";
import { buildReport } from "./buildReport";
import { occupancy, vancouverTime } from "./occupancy";
import type { Place } from "./types";

const place = (over: Partial<Place>): Place => ({
  id: "node/1",
  name: "Test Place",
  kind: "school",
  type: "school",
  lat: 49.31,
  lon: -123.08,
  capacity: 500,
  capacitySource: "estimate",
  ...over,
});

const TUESDAY_1030 = new Date("2026-10-06T10:30:00-07:00");
const SATURDAY_1030 = new Date("2026-10-03T10:30:00-07:00");

describe("occupancy", () => {
  it("reads Vancouver local time", () => {
    const t = vancouverTime(TUESDAY_1030);
    expect(t.dayOfWeek).toBe(2);
    expect(t.hour).toBeCloseTo(10.5);
  });

  it("schools are full on a school morning and empty on weekends and in summer", () => {
    expect(occupancy("school", "school", vancouverTime(TUESDAY_1030)).level).toBeGreaterThan(0.9);
    expect(occupancy("school", "school", vancouverTime(SATURDAY_1030)).level).toBeLessThan(0.1);
    expect(occupancy("school", "school", vancouverTime(new Date("2026-07-14T10:30:00-07:00"))).reason).toBe("summer break");
  });
});

describe("buildReport", () => {
  const school = place({ id: "node/1", name: "Queen Mary Elementary School", capacity: 350 });
  const quay = place({ id: "node/2", name: "Lonsdale Quay", kind: "transit", type: "ferry_terminal", capacity: 600, lat: 49.31 });

  it("ranks places by people expected at the disaster time", () => {
    const r = buildReport({ places: [school, quay], at: TUESDAY_1030 });
    expect(r.hotspots[0].name).toBe("Queen Mary Elementary School");
    expect(r.hotspots[0].sources[0].url).toContain("openstreetmap.org/node/1");
  });

});

describe("regional events", () => {
  const quay: Place = { id: "node/2", name: "Lonsdale Quay", kind: "transit", type: "ferry_terminal", lat: 49.31, lon: -123.08, capacity: 600, capacitySource: "estimate" };
  const pub: Place = { id: "node/3", name: "Local Pub", kind: "dining", type: "pub", lat: 49.311, lon: -123.081, capacity: 200, capacitySource: "estimate" };
  const match = {
    name: "FIFA World Cup: Canada vs Qatar",
    venue: "BC Place",
    lat: 49.2768,
    lon: -123.1119,
    start: "2026-06-18T15:00:00-07:00",
    durationH: 2,
    attendance: 54000,
    sport: true,
    source: { title: "BC Place", url: "https://www.bcplace.com/" },
  };

  it("fans heading to BC Place crowd the SeaBus terminal before kickoff", () => {
    const at = new Date("2026-06-18T13:45:00-07:00");
    const normal = buildReport({ places: [quay], at }).hotspots[0];
    const fifa = buildReport({ places: [quay], at, regional: [match] }).hotspots[0];
    expect(fifa.people).toBeGreaterThan(normal.people + 500);
    expect(fifa.why).toContain("heading to FIFA World Cup: Canada vs Qatar");
  });

  it("local pubs fill up during a Canada match", () => {
    const at = new Date("2026-06-18T16:00:00-07:00");
    expect(buildReport({ places: [pub], at }).hotspots).toHaveLength(0); // quiet weekday afternoon
    const fifa = buildReport({ places: [pub], at, regional: [match] }).hotspots[0];
    expect(fifa.people).toBeGreaterThanOrEqual(150);
  });
});

describe("transit hubs", () => {
  it("a hub mapped as two nearby points gets the fan surge once", () => {
    const a: Place = { id: "node/10", name: "Lonsdale Quay", kind: "transit", type: "ferry_terminal", lat: 49.3095, lon: -123.0828, capacity: 600, capacitySource: "estimate" };
    const b: Place = { ...a, id: "node/11", name: "", type: "station", capacity: 300, lat: 49.3098 };
    const match = { name: "FIFA World Cup: Canada vs Qatar", venue: "BC Place", lat: 49.2768, lon: -123.1119, start: "2026-06-18T15:00:00-07:00", durationH: 2, attendance: 54000, sport: true, source: { title: "BC Place", url: "https://www.bcplace.com/" } };
    const r = buildReport({ places: [a, b], at: new Date("2026-06-18T13:45:00-07:00"), regional: [match] });
    expect(r.hotspots.filter((h) => h.why.includes("heading to"))).toHaveLength(1);
  });
});

describe("stadiums", () => {
  it("an empty stadium is not a hotspot without an event", () => {
    const bcPlace: Place = { id: "way/1", name: "BC Place", kind: "venue", type: "stadium", lat: 49.2768, lon: -123.1119, capacity: 54500, capacitySource: "osm" };
    expect(buildReport({ places: [bcPlace], at: SATURDAY_1030 }).hotspots).toHaveLength(0);
  });
});

describe("events inside the map", () => {
  it("a scheduled game fills the stadium", () => {
    const bcPlace: Place = { id: "way/1", name: "BC Place", kind: "venue", type: "stadium", lat: 49.2768, lon: -123.1119, capacity: 54500, capacitySource: "osm" };
    const game = { name: "BC Lions vs Calgary", venue: "BC Place", lat: 49.2767, lon: -123.112, start: "2026-10-03T19:00:00-07:00", durationH: 3, attendance: 30000, sport: true, source: { title: "Schedule", url: "https://example.org" } };
    const r = buildReport({ places: [bcPlace], at: new Date("2026-10-03T20:00:00-07:00"), regional: [game] });
    expect(r.hotspots[0]).toMatchObject({ name: "BC Place", people: 30000 });
  });
});
