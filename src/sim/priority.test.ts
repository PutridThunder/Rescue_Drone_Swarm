import { describe, expect, it } from "vitest";
import type { World } from "../types";
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS } from "./defaults";
import { computeTerms, emptyAgg, normalizedPriorities } from "./priority";
import { Simulation } from "./Simulation";
import { coastDistance } from "./testWorld";

/** 40x40: sea along the south; area A (west, low-lying, coastal) and B (north-east, high) with equal population. */
function twoAreaWorld(): World {
  const w = 40;
  const h = 40;
  const n = w * h;
  const terrain = new Uint8Array(n);
  const elevation = new Float32Array(n);
  const population = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (y >= 32) continue;
      terrain[i] = 1;
      elevation[i] = x < 10 && y >= 20 ? 3 : 30;
      if (y >= 20 && y < 30 && x < 10) population[i] = 10; // A
      if (y < 10 && x >= 20 && x < 30) population[i] = 10; // B
      if (y < 10 && x >= 20 && x < 30) elevation[i] = 60;
    }
  }
  const world: World = {
    meta: {
      name: "two-area",
      bbox: [0, 0, 1, 1],
      cellSizeM: 30,
      width: w,
      height: h,
      source: "procedural",
    },
    terrain,
    elevation,
    buildingHeight: new Float32Array(n),
    obstacleHeight: new Float32Array(n),
    population,
    coastDistance: new Float32Array(n),
    base: { x: 15, y: 15 },
    roadName: new Int16Array(n).fill(-1),
    roadNames: [],
  };
  world.coastDistance = coastDistance(world);
  return world;
}

const findTask = (sim: Simulation, x0: number, y0: number) =>
  sim.state.tasks.find((t) => t.x0 === x0 && t.y0 === y0)!;

describe("priority", () => {
  it("pure terms: equal population, higher hazard wins when disaster info is used", () => {
    const safe = {
      ...emptyAgg(),
      believed: 100,
      unsearched: 100,
      population: 500,
      hazard: 10,
      flood: 0,
      rescue: 500 * 0.35,
    };
    const risky = {
      ...emptyAgg(),
      believed: 100,
      unsearched: 100,
      population: 500,
      hazard: 90,
      flood: 100,
      rescue: 500 * 1.15,
    };
    const on = computeTerms([safe, risky], {
      useHazard: true,
      useUrgency: true,
      timePressure: 0.6,
    });
    const [pSafe, pRisky] = normalizedPriorities(on, DEFAULT_WEIGHTS);
    expect(on[1].hazard).toBe(1);
    expect(pRisky).toBeGreaterThan(pSafe);

    const off = computeTerms([safe, risky], {
      useHazard: false,
      useUrgency: false,
      timePressure: 0,
    });
    expect(off[0].hazard).toBe(0);
    expect(off[1].urgency).toBe(0);
  });

  it("worked example: low-elevation/high-hazard area outranks high-elevation/low-hazard area", () => {
    const world = twoAreaWorld();
    const info = {
      geography: true,
      population: true,
      elevation: true,
      disaster: true,
      crowds: false,
    };
    const sim = new Simulation(world, {
      ...structuredClone(DEFAULT_CONFIG),
      droneCount: 0,
      scenario: "tsunami",
      info,
    });
    const a = findTask(sim, 0, 20);
    const b = findTask(sim, 20, 0);
    expect(a.breakdown.population).toBeCloseTo(b.breakdown.population!, 5);
    expect(a.breakdown.hazard!).toBeGreaterThan(0.8);
    expect(b.breakdown.hazard!).toBeLessThan(0.1);
    expect(a.breakdown.urgency!).toBeGreaterThan(0);
    expect(a.priority).toBeGreaterThan(b.priority + 0.2);
    expect(state(sim).knowledge.hazard).not.toBeNull();

    // Without disaster info the two areas are indistinguishable.
    sim.updateConfig({ info: { ...info, disaster: false } });
    const a2 = findTask(sim, 0, 20);
    const b2 = findTask(sim, 20, 0);
    expect(Math.abs(a2.priority - b2.priority)).toBeLessThan(1e-6);
    expect(state(sim).knowledge.hazard).toBeNull();
  });

  it("weights apply live: zeroing the hazard/urgency/population weights flattens the difference", () => {
    const sim = new Simulation(twoAreaWorld(), {
      ...structuredClone(DEFAULT_CONFIG),
      droneCount: 0,
      scenario: "tsunami",
      info: {
        geography: true,
        population: true,
        elevation: true,
        disaster: true,
        crowds: false,
      },
    });
    sim.updateConfig({
      weights: { ...DEFAULT_WEIGHTS, hazard: 0, urgency: 0, population: 0 },
    });
    expect(findTask(sim, 0, 20).priority).toBeCloseTo(
      findTask(sim, 20, 0).priority,
      5,
    );
  });
});

const state = (s: Simulation) => s.state;
