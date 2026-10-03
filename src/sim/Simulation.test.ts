import { describe, expect, it } from "vitest";
import type { SimConfig, SimEvent } from "../types";
import { DEFAULT_CONFIG } from "./defaults";
import { Simulation } from "./Simulation";
import { makeTestWorld } from "./testWorld";

const small = makeTestWorld(60, 50);
const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  ...structuredClone(DEFAULT_CONFIG),
  ...over,
});

function runFor(
  sim: Simulation,
  seconds: number,
  dt = 0.1,
  events: SimEvent[] = [],
) {
  const end = sim.state.time + seconds;
  while (sim.state.time < end - 1e-9 && !sim.state.metrics.complete) {
    sim.step(dt);
    events.push(...sim.drainEvents());
  }
  return events;
}

describe("Simulation", () => {
  it("starts paused; start/pause toggle running", () => {
    const sim = new Simulation(small, cfg());
    expect(sim.state.running).toBe(false);
    sim.start();
    expect(sim.state.running).toBe(true);
    sim.pause();
    expect(sim.state.running).toBe(false);
  });

  it("sensing raises search confidence, marks dirty cells and accrues coverage", () => {
    const sim = new Simulation(small, cfg({ droneCount: 3 }));
    sim.drainDirtyCells();
    runFor(sim, 5);
    const dirty = sim.drainDirtyCells();
    expect(dirty.length).toBeGreaterThan(50);
    expect(new Set(dirty).size).toBe(dirty.length);
    expect(sim.state.metrics.areaSearchedFrac).toBeGreaterThan(0.05);
    expect(sim.state.metrics.distanceTravelled).toBeGreaterThan(0);
    for (const d of sim.state.drones)
      expect(["TRAVELLING", "SEARCHING"]).toContain(d.status);
    const f = sim.state.knowledge.frontier.reduce((a, b) => a + b, 0);
    expect(f).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    const run = (seed: number) => {
      const sim = new Simulation(small, cfg({ seed, droneCount: 4 }));
      runFor(sim, 40, 1 / 30);
      return JSON.stringify({
        m: sim.state.metrics,
        d: sim.state.drones.map((d) => [d.x, d.y, d.taskId, d.battery]),
      });
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it("disabling a drone releases its sector and another drone takes it over", () => {
    const sim = new Simulation(small, cfg({ droneCount: 4 }));
    const events = runFor(sim, 6);
    const victim = sim.state.drones.find(
      (d) => d.taskId !== null && d.status === "SEARCHING",
    )!;
    expect(victim).toBeDefined();
    const sector = victim.taskId!;
    expect(sim.disableDrone(victim.id)).toBe(victim.id);
    expect(victim.status).toBe("DISABLED");
    expect(victim.taskId).toBeNull();
    events.push(...sim.drainEvents());
    expect(
      events.some(
        (e) =>
          e.type === "failure" &&
          e.message.includes(`Drone ${victim.id} went down`),
      ),
    ).toBe(true);
    runFor(sim, 20, 0.1, events);
    const takeover = events.find(
      (e) =>
        e.taskId === sector &&
        e.message.includes(`taking over from Drone ${victim.id}`),
    );
    expect(takeover?.type).toBe("reassign");
    expect(sim.state.metrics.tasksReassigned).toBeGreaterThanOrEqual(1);
    expect(sim.state.metrics.droneFailures).toBe(1);
    const { x, y } = victim;
    runFor(sim, 5);
    expect([victim.x, victim.y]).toEqual([x, y]);
    expect(sim.disableDrone(victim.id)).toBeNull();
    expect(sim.disableDrone()).not.toBeNull(); // random active drone
  });

  it("drones launch from trucks and land on them when the mission ends", () => {
    const sim = new Simulation(small, cfg({ droneCount: 3, truckCount: 2 }));
    expect(sim.state.drones.every((d) => d.dockedTruck !== null)).toBe(true);
    runFor(sim, 3);
    expect(sim.state.drones.some((d) => d.dockedTruck === null)).toBe(true);
    sim.start();
    runFor(sim, 3000, 0.5);
    expect(sim.state.metrics.complete).toBe(true);
    for (let k = 0; k < 2000 && sim.state.running; k++) sim.step(0.5); // fly home after the mission
    expect(sim.state.drones.every((d) => d.dockedTruck !== null)).toBe(true);
    expect(sim.state.running).toBe(false);
  });

  it("planted survivors and crowds are tracked and removable", () => {
    const sim = new Simulation(small, cfg({ survivorCount: 0 }));
    expect(sim.addSurvivor(20.5, 20.5)?.placed).toBe(true);
    const crowd = sim.addCrowd(30.5, 20.5)!;
    expect(crowd.people).toBeGreaterThan(0);
    expect(sim.state.metrics.survivorsTotal).toBe(4); // 1 planted + 3 in the crowd
    expect(sim.removeNear(30.5, 20.5, 4)).toBeGreaterThanOrEqual(1);
    expect(sim.state.crowds).toHaveLength(0);
  });

  it("runs to completion and reports metrics", () => {
    const sim = new Simulation(
      small,
      cfg({ droneCount: 4, survivorCount: 15 }),
    );
    const events = runFor(sim, 2000, 0.5);
    const m = sim.state.metrics;
    expect(m.complete).toBe(true);
    expect(sim.state.running).toBe(false);
    expect(events.at(-1)!.type).toBe("complete");
    expect(m.areaSearchedFrac).toBeGreaterThan(0.85);
    expect(m.survivorsFound).toBeGreaterThan(10);
    expect(m.tasksCompleted).toBeGreaterThan(5);
    expect(m.droneUtilization).toBeGreaterThan(0.3);
    expect(m.redundancyFrac).toBeGreaterThan(0);
    expect(m.redundancyFrac).toBeLessThan(0.8);
    expect(m.populationReached / m.populationTotal).toBeGreaterThan(0.85);
    expect(
      sim.state.survivors
        .filter((s) => s.found)
        .every((s) => s.foundBy !== null && s.foundAt !== null),
    ).toBe(true);
    expect(events.some((e) => e.type === "survivor")).toBe(true);
    const t = m.time;
    sim.step(1);
    expect(sim.state.metrics.time).toBe(t);
  });

  it("drones recharge: low battery forces a return and they rejoin afterwards", () => {
    const sim = new Simulation(
      small,
      cfg({ droneCount: 2, batteryCapacity: 120 }),
    );
    const events = runFor(sim, 150, 0.25);
    // Drones head back to a truck before running dry (allocator feasibility or the low-battery trigger).
    expect(
      events.some((e) => e.type === "lowBattery" || e.type === "reassign"),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "recharged" && /on Truck \d/.test(e.message),
      ),
    ).toBe(true);
    expect(sim.state.metrics.batteryConsumed).toBeGreaterThan(1);
  });

  it("without geography the fleet discovers terrain and obstacles as it flies", () => {
    const info = {
      geography: false,
      population: false,
      elevation: false,
      disaster: false,
      crowds: false,
    };
    const sim = new Simulation(small, cfg({ info, droneCount: 4 }));
    const known0 = sim.state.knowledge.known.reduce((a, b) => a + b, 0);
    expect(known0).toBeLessThan(200);
    runFor(sim, 8);
    expect(sim.state.metrics.complete).toBe(false);
    const known1 = sim.state.knowledge.known.reduce((a, b) => a + b, 0);
    expect(known1).toBeGreaterThan(known0 + 300);
    // Toggling geography on reveals the whole map and recolours every cell.
    sim.drainDirtyCells();
    sim.updateConfig({ info: { ...info, geography: true } });
    expect(sim.state.knowledge.known.every((v) => v === 1)).toBe(true);
    expect(sim.drainDirtyCells()).toHaveLength(small.terrain.length);
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === "replan" && e.message.includes("geography ON")),
    ).toBe(true);
  });

  it("tsunami: impact floods low coastal cells and loses unfound survivors there", () => {
    const sim = new Simulation(
      small,
      cfg({ scenario: "tsunami", tsunamiImpactTime: 10, droneCount: 2 }),
    );
    expect(sim.state.flood).toEqual({
      timeToImpact: 10,
      impacted: false,
      runupM: 12,
    });
    const events = runFor(sim, 12);
    expect(sim.state.flood!.impacted).toBe(true);
    expect(sim.state.flood!.timeToImpact).toBeLessThanOrEqual(0);
    expect(events.some((e) => e.type === "impact")).toBe(true);
    const lost = sim.state.survivors.filter((s) => s.lost);
    expect(lost.length).toBe(sim.state.metrics.survivorsLost);
    for (const s of lost)
      expect(sim.floodMask![Math.floor(s.y) * 60 + Math.floor(s.x)]).toBe(1);
    expect(sim.state.tasks.every((t) => (t.breakdown.urgency ?? 0) === 0)).toBe(
      true,
    );
    expect(new Simulation(small, cfg()).state.flood).toBeNull();
  });

  it("tsunami: disaster info saves more survivors before impact (same seeds)", () => {
    const world = makeTestWorld(218, 167);
    let foundOff = 0;
    let foundOn = 0;
    let lostOff = 0;
    let lostOn = 0;
    const rows: string[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const run = (on: boolean) => {
        const sim = new Simulation(
          world,
          cfg({
            seed,
            scenario: "tsunami",
            tsunamiImpactTime: 60,
            info: {
              geography: true,
              population: on,
              elevation: on,
              disaster: on,
              crowds: false,
            },
          }),
        );
        while (!sim.state.flood!.impacted && !sim.state.metrics.complete)
          sim.step(0.25);
        return {
          found: sim.foundBeforeImpact!,
          lost: sim.state.metrics.survivorsLost,
        };
      };
      const off = run(false);
      const on = run(true);
      foundOff += off.found;
      foundOn += on.found;
      lostOff += off.lost;
      lostOn += on.lost;
      rows.push(
        `seed ${seed}: off found ${off.found} lost ${off.lost} | on found ${on.found} lost ${on.lost}`,
      );
    }
    console.log(
      `tsunami info comparison (impact 60 s, 218x167)\n${rows.join("\n")}\ntotal off ${foundOff}/${lostOff} on ${foundOn}/${lostOn}`,
    );
    expect(foundOn).toBeGreaterThan(foundOff);
    expect(lostOn).toBeLessThan(lostOff);
  });
});
