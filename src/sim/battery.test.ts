import { describe, expect, it } from "vitest";
import { RECALL_BATTERY } from "./constants";
import { DEFAULT_CONFIG } from "./defaults";
import { Simulation } from "./Simulation";
import { makeTestWorld } from "./testWorld";

describe("battery", () => {
  it("drones head to a truck when low and never run empty", () => {
    const sim = new Simulation(makeTestWorld(160, 120), { ...structuredClone(DEFAULT_CONFIG), batteryCapacity: 500, droneCount: 8 });
    let lowAndSearching = 0;
    let empty = 0;
    while (!sim.state.metrics.complete && sim.state.time < 400) {
      sim.step(1 / 10);
      sim.drainEvents();
      sim.drainDirtyCells();
      for (const d of sim.state.drones) {
        if (d.status === "DISABLED" || d.status === "CHARGING" || d.status === "IDLE") continue;
        if (d.battery < RECALL_BATTERY - 0.01 && (d.status === "SEARCHING" || d.status === "TRAVELLING")) lowAndSearching++;
        if (d.battery <= 0.001) empty++;
      }
    }
    expect(lowAndSearching).toBe(0);
    expect(empty).toBe(0);
  });
});
