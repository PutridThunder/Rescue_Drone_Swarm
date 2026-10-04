// Owns the running simulation: its config, the survivors/crowds the user placed and the crowds
// crowd intel predicts (all re-applied on restart), and stepping it in real time.

import type { CrowdPlacement } from "../intel/toCrowds";
import { DEFAULT_CONFIG } from "../sim/defaults";
import { Simulation } from "../sim/Simulation";
import type { SimConfig, World } from "../types";

const MAX_STEP = 0.5; // simulated seconds per Simulation.step call

interface Placement {
  kind: "survivor" | "crowd";
  x: number;
  y: number;
}

export class MissionRunner {
  sim: Simulation;
  config: SimConfig = structuredClone(DEFAULT_CONFIG);
  speed = 1;
  private placements: Placement[] = [];
  private predicted: CrowdPlacement[] = [];

  constructor(private readonly world: World) {
    this.sim = this.create();
  }

  /** Start a fresh mission with the current config and placements. */
  restart() {
    this.sim = this.create();
  }

  /** Settings the running mission picks up immediately (priority weights, intel switches). */
  applyLive(partial: Pick<Partial<SimConfig>, "weights" | "info">) {
    this.config = { ...this.config, ...partial };
    this.sim.updateConfig(partial);
  }

  /** Settings that take effect on the next restart (fleet size, scenario, altitude...). */
  configure(partial: Partial<SimConfig>) {
    this.config = { ...this.config, ...partial };
  }

  /** Crowds predicted by crowd intel; part of the scenario, applied on the next restart. */
  setPredictedCrowds(crowds: CrowdPlacement[]) {
    this.predicted = crowds;
  }

  place(kind: Placement["kind"], x: number, y: number): boolean {
    const ok = kind === "survivor" ? this.sim.addSurvivor(x, y) !== null : this.sim.addCrowd(x, y) !== null;
    if (ok) this.placements.push({ kind, x, y });
    return ok;
  }

  /** Remove placements within `radius` cells. Returns how many were removed. */
  erase(x: number, y: number, radius: number): number {
    this.placements = this.placements.filter((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > radius * radius);
    return this.sim.removeNear(x, y, radius);
  }

  togglePause() {
    if (this.sim.state.running) this.sim.pause();
    else this.sim.start();
  }

  /** Advance by `realDt` seconds of wall time at the chosen speed. */
  step(realDt: number) {
    if (!this.sim.state.running) return;
    let remaining = realDt * this.speed;
    while (remaining > 1e-6) {
      const dt = Math.min(remaining, MAX_STEP);
      this.sim.step(dt);
      remaining -= dt;
    }
  }

  private create(): Simulation {
    const sim = new Simulation(this.world, this.config);
    for (const c of this.predicted) sim.addCrowd(c.x, c.y, c.opts);
    for (const p of this.placements) {
      if (p.kind === "survivor") sim.addSurvivor(p.x, p.y);
      else sim.addCrowd(p.x, p.y);
    }
    sim.drainEvents(); // placement events belong to setup, not the mission feed
    return sim;
  }
}
