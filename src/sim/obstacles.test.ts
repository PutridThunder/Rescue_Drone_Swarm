// Regression: drones must never fly through buildings taller than their flight altitude.
// Uses the real Downtown Vancouver map (408 towers) and checks every drone position against
// the actual building footprints, not just the 10 m grid.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MapJSON } from "../types";
import { worldFromJSON } from "../world/loadWorld";
import { DEFAULT_CONFIG } from "./defaults";
import { Simulation } from "./Simulation";

function pointInPolygon(px: number, py: number, ring: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe("obstacle avoidance", () => {
  it("no drone enters a tall building footprint in Downtown Vancouver", () => {
    const world = worldFromJSON(JSON.parse(readFileSync("public/areas/downtown/world.json", "utf8")));
    const map = JSON.parse(readFileSync("public/areas/downtown/map.json", "utf8")) as MapJSON;
    const towers = map.buildings
      .filter((b) => b.h > DEFAULT_CONFIG.flightAltitudeM)
      .map((b) => {
        const xs = b.p.filter((_, k) => k % 2 === 0);
        const ys = b.p.filter((_, k) => k % 2 === 1);
        return { ring: b.p, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      });
    expect(towers.length).toBeGreaterThan(100);

    const sim = new Simulation(world, structuredClone(DEFAULT_CONFIG));
    sim.start();
    let violations = 0;
    for (let k = 0; k < 2000; k++) {
      sim.step(1 / 20);
      for (const d of sim.state.drones) {
        if (d.dockedTruck !== null || d.status === "DISABLED") continue;
        const hit = towers.some((t) => d.x >= t.x0 && d.x <= t.x1 && d.y >= t.y0 && d.y <= t.y1 && pointInPolygon(d.x, d.y, t.ring));
        if (hit) violations++;
      }
    }
    expect(violations).toBe(0);
  }, 60_000);
});
