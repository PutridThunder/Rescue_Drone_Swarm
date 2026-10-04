import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./defaults";
import { Simulation } from "./Simulation";
import { makeTestWorld } from "./testWorld";

describe("search area", () => {
  it("only searches inside the drawn circle", () => {
    const area = { x: 60, y: 50, r: 25 };
    const sim = new Simulation(makeTestWorld(200, 150), { ...structuredClone(DEFAULT_CONFIG), searchArea: area });
    const inside = (x: number, y: number, slack = 0) => Math.hypot(x - area.x, y - area.y) <= area.r + slack;

    expect(sim.state.survivors.length).toBeGreaterThan(0);
    for (const s of sim.state.survivors) expect(inside(s.x + 0.5, s.y + 0.5, 1)).toBe(true);

    sim.start();
    while (!sim.state.metrics.complete && sim.state.time < 600) {
      sim.step(1 / 10);
      sim.drainEvents();
      sim.drainDirtyCells();
      // Every block on offer overlaps the circle (block corners within radius + half a diagonal).
      for (const t of sim.state.tasks) expect(inside((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, 8)).toBe(true);
    }
    expect(sim.state.metrics.complete).toBe(true);
    expect(sim.state.metrics.areaSearchedFrac).toBeGreaterThan(0.8);
  });
});
