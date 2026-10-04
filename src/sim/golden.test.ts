// Golden trace: a fixed-seed mission must produce exactly the same events, metrics and positions.
// Guards refactors of the engine against unintended behaviour changes. If a change is
// intentional, update the snapshot with `npx vitest run -u` and review the diff.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SimConfig, SimEvent } from "../types";
import { worldFromJSON } from "../world/loadWorld";
import { DEFAULT_CONFIG } from "./defaults";
import { Simulation } from "./Simulation";
import { makeTestWorld } from "./testWorld";

function trace(sim: Simulation, seconds: number, act?: (t: number) => void) {
  const events: SimEvent[] = [];
  sim.start();
  for (let k = 0; k < seconds * 10 && sim.state.running; k++) {
    act?.(k / 10);
    sim.step(0.1);
    events.push(...sim.drainEvents());
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    events: events.map((e) => `${r(e.t)} ${e.type} ${e.message}`),
    metrics: Object.fromEntries(Object.entries(sim.state.metrics).map(([k, v]) => [k, typeof v === "number" ? r(v) : v])),
    drones: sim.state.drones.map((d) => `${d.id} ${d.status} ${r(d.x)},${r(d.y)} ${r(d.battery)} truck:${d.dockedTruck}`),
    trucks: sim.state.trucks.map((t) => `${t.id} ${t.status} ${r(t.x)},${r(t.y)}`),
  };
}

const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({ ...structuredClone(DEFAULT_CONFIG), ...over });

describe("golden trace", () => {
  it("synthetic world: placements, crowd intel, failure and recharge", () => {
    const sim = new Simulation(makeTestWorld(60, 50), cfg({ droneCount: 3, batteryCapacity: 200, info: { ...DEFAULT_CONFIG.info, crowds: true } }));
    sim.addSurvivor(20.5, 20.5);
    sim.addCrowd(30.5, 15.5);
    sim.addCrowd(40.5, 20.5, { people: 400, radius: 4, survivors: 2, source: "intel", label: "Test hub" });
    const result = trace(sim, 120, (t) => {
      if (t === 20) sim.disableDrone(2);
      if (t === 30) sim.updateConfig({ weights: { ...DEFAULT_CONFIG.weights, distance: 2 } });
    });
    expect(result).toMatchSnapshot();
  });

  it("Lonsdale tsunami with hazard intel", () => {
    const world = worldFromJSON(JSON.parse(readFileSync("public/areas/lonsdale/world.json", "utf8")));
    const sim = new Simulation(world, cfg({ scenario: "tsunami", info: { geography: true, population: true, elevation: true, disaster: true, crowds: false } }));
    expect(trace(sim, 90)).toMatchSnapshot();
  });
});
