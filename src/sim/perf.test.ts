import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./defaults";
import { Simulation } from "./Simulation";
import { makeTestWorld } from "./testWorld";

describe("performance (218x167 grid)", () => {
  const world = makeTestWorld(218, 167);

  it("12 drones: step() at 1x averages well under 2 ms, replans under 10 ms", () => {
    const sim = new Simulation(world, {
      ...structuredClone(DEFAULT_CONFIG),
      droneCount: 12,
    });
    let total = 0;
    let max = 0;
    let steps = 0;
    while (sim.state.time < 120 && !sim.state.metrics.complete) {
      const t0 = performance.now();
      sim.step(1 / 60);
      const dt = performance.now() - t0;
      total += dt;
      max = Math.max(max, dt);
      steps++;
      sim.drainEvents();
      sim.drainDirtyCells();
    }
    // A weights change triggers a full replan through the public API.
    const replan = (i: number) => sim.updateConfig({ weights: { ...DEFAULT_CONFIG.weights, distance: 0.8 + (i % 2) * 0.01 } });
    const r0 = performance.now();
    for (let i = 0; i < 50; i++) replan(i);
    const replanMs = (performance.now() - r0) / 50;
    const avg = total / steps;
    console.log(
      `perf: ${steps} steps, avg step ${avg.toFixed(3)} ms, max ${max.toFixed(2)} ms, replan ${replanMs.toFixed(2)} ms`,
    );
    expect(avg).toBeLessThan(2);
    expect(replanMs).toBeLessThan(10);
  });

  it("default config completes a full demo run in under 10 simulated minutes", () => {
    const sim = new Simulation(world, structuredClone(DEFAULT_CONFIG));
    const counts: Record<string, number> = {};
    const t0 = performance.now();
    while (!sim.state.metrics.complete && sim.state.time < 900) {
      sim.step(1 / 60);
      for (const e of sim.drainEvents())
        counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    const m = sim.state.metrics;
    console.log(
      `default run: ${m.time.toFixed(0)} s sim, ${(performance.now() - t0).toFixed(0)} ms wall, area ${(m.areaSearchedFrac * 100).toFixed(0)}%, ` +
        `survivors ${m.survivorsFound}/${m.survivorsTotal}, redundancy ${m.redundancyFrac.toFixed(2)}, util ${m.droneUtilization.toFixed(2)}, ` +
        `battery ${m.batteryConsumed.toFixed(1)} charges, events ${JSON.stringify(counts)}`,
    );
    expect(m.complete).toBe(true);
    expect(m.time).toBeGreaterThan(100);
    expect(m.time).toBeLessThan(600);
  });
});
