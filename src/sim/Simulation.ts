// The simulation engine's public face. It wires the subsystems together and runs the loop:
//
//   OBSERVE -> UPDATE SHARED KNOWLEDGE -> FIND FRONTIERS -> SCORE BLOCKS -> ALLOCATE DRONES
//   -> PATHFIND -> MOVE -> OBSERVE AGAIN ... (replanning on a cadence and on events)
//
// Subsystems (each in its own file, sharing a SimContext):
//   SurvivorRegistry  ground-truth survivors        PopulationPriors  population + crowd intel
//   SectorBoard       search blocks and scoring     Tsunami           flood zone and impact
//   TruckDepot        charging trucks               Navigator         flight paths (A*)
//   Sensor            camera and detection          DroneController   per-drone state machine
//   Planner           scoring + allocation          Mission           metrics and completion

import type { CrowdOptions, CrowdView, InfoModes, ISimulation, SimConfig, SimEvent, SimState, SurvivorView, World } from "../types";
import { MAX_SUBSTEP_CELLS } from "./constants";
import { SimContext } from "./context";
import { Drone } from "./drone";
import { DroneController } from "./droneController";
import { applyInfoModes } from "./infoModes";
import { createMetrics } from "./metrics";
import { Mission } from "./mission";
import { Navigator } from "./navigator";
import { Planner } from "./planner";
import { PopulationPriors } from "./populationPriors";
import { Rng } from "./rng";
import { sampleSurvivors } from "./scenario";
import { SectorBoard } from "./sectorBoard";
import { Sensor } from "./sensor";
import { SurvivorRegistry } from "./survivors";
import { TruckDepot } from "./truckDepot";
import { Tsunami } from "./tsunami";

export class Simulation implements ISimulation {
  readonly state: SimState;
  private readonly ctx: SimContext;

  constructor(world: World, config: SimConfig) {
    const cfg = structuredClone(config);
    const ctx = (this.ctx = new SimContext(world, structuredClone(config), new Rng(cfg.seed)));

    ctx.tsunami = new Tsunami(ctx);
    const searchable = Uint8Array.from(ctx.masks.hidden, (h) => (h ? 0 : 1));
    const survivors = sampleSurvivors(world, cfg.survivorCount, ctx.rng, ctx.tsunami.hazardTruth, searchable);
    ctx.survivors = new SurvivorRegistry(ctx, survivors);
    ctx.priors = new PopulationPriors(ctx);
    ctx.sectors = new SectorBoard(ctx);
    ctx.nav = new Navigator(ctx);
    ctx.depot = new TruckDepot(ctx);
    ctx.sensor = new Sensor(ctx);
    ctx.pilot = new DroneController(ctx);
    ctx.planner = new Planner(ctx);
    ctx.mission = new Mission(ctx);

    // Drones start landed on the trucks, shared round-robin.
    const { trucks } = ctx.depot;
    ctx.fleet = Array.from({ length: cfg.droneCount }, (_, i) => {
      const t = trucks[i % trucks.length];
      const d = new Drone(i + 1, t.x, t.y, cfg.sensorRange, cfg.batteryCapacity);
      d.dockedTruck = t.id;
      return d;
    });

    this.state = ctx.state = {
      time: 0,
      running: false,
      config: cfg,
      knowledge: ctx.knowledge.view,
      drones: ctx.fleet,
      trucks,
      crowds: [],
      tasks: [],
      survivors: ctx.survivors.list,
      flood: ctx.tsunami.initialFloodState(),
      metrics: createMetrics(survivors.length, ctx.priors.initialTotal),
    };

    applyInfoModes(ctx, null);
    ctx.replan.request("initial deployment", true);
    ctx.planner.replan();
  }

  /** Ground-truth flood zone (tsunami only), for the renderer. */
  get floodMask(): Uint8Array | null {
    return this.ctx.tsunami.floodMask;
  }

  /** Survivors found before the tsunami struck (tsunami only; null until impact). */
  get foundBeforeImpact(): number | null {
    return this.ctx.tsunami.foundBeforeImpact;
  }

  start() {
    if (!this.state.metrics.complete) this.state.running = true;
  }

  pause() {
    this.state.running = false;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    const st = this.state;
    // Mission over: keep flying until every drone has landed on a truck.
    if (st.metrics.complete && !this.ctx.fleet.some((d) => d.airborne)) {
      st.running = false;
      return;
    }
    // Sub-steps keep drones from skipping cells between observations.
    const n = Math.max(1, Math.ceil((dt * this.ctx.cfg.speed) / MAX_SUBSTEP_CELLS));
    for (let i = 0; i < n; i++) this.subStep(dt / n);
    if (!st.metrics.complete) this.ctx.mission.updateMetrics();
  }

  drainEvents(): SimEvent[] {
    return this.ctx.log.drain();
  }

  drainDirtyCells(): number[] {
    return this.ctx.knowledge.drain();
  }

  /** Knock a drone out (a random airborne one if no id). Its block is handed back to the fleet. */
  disableDrone(id?: number): number | null {
    const { ctx } = this;
    const active = ctx.fleet.filter((d) => d.active);
    if (active.length === 0) return null;
    const airborne = active.filter((d) => d.airborne);
    const pool = airborne.length ? airborne : active;
    const d = id == null ? pool[ctx.rng.int(pool.length)] : active.find((x) => x.id === id);
    if (!d) return null;
    const block = d.taskId != null ? ctx.sectors.get(d.taskId) : null;
    if (block) ctx.pilot.releaseTask(d);
    d.status = "DISABLED";
    d.path = [];
    d.charging = false;
    d.dockedTruck = null;
    this.state.metrics.droneFailures++;
    ctx.log.emit("failure", `Drone ${d.id} went down${block ? ` — ${block.view.label} handed back to the fleet` : ""}`, d.id, block?.id);
    if (!this.state.metrics.complete) {
      ctx.replan.request(`Drone ${d.id} lost`, true);
      ctx.planner.replan();
    }
    return d.id;
  }

  /** Weights and info modes apply live; other settings take effect in a new Simulation. */
  updateConfig(partial: Partial<SimConfig>): void {
    const cfg = this.state.config;
    const reasons: string[] = [];
    for (const key of Object.keys(partial) as (keyof SimConfig)[]) {
      if (key === "weights" && partial.weights) {
        cfg.weights = { ...cfg.weights, ...partial.weights };
        reasons.push("priority weights changed");
      } else if (key === "info" && partial.info) {
        const prev = { ...cfg.info };
        cfg.info = { ...cfg.info, ...partial.info };
        const changed = (Object.keys(cfg.info) as (keyof InfoModes)[]).filter((m) => cfg.info[m] !== prev[m]);
        if (changed.length) {
          applyInfoModes(this.ctx, prev);
          reasons.push(`info ${changed.map((m) => `${m} ${cfg.info[m] ? "ON" : "OFF"}`).join(", ")}`);
        }
      } else if (partial[key] !== undefined) {
        (cfg as unknown as Record<string, unknown>)[key] = structuredClone(partial[key]);
      }
    }
    if (reasons.length && !this.state.metrics.complete) {
      for (const d of this.ctx.fleet) d.commitment = 0; // new information: let the fleet re-evaluate freely
      for (const r of reasons) this.ctx.replan.request(r, true);
      this.ctx.planner.replan();
    }
  }

  /** Street-name label of a block (task id). */
  sectorName(taskId: number): string {
    return this.ctx.sectors.get(taskId)?.view.label ?? `#${taskId}`;
  }

  /** Plant a survivor (ground truth only — the fleet has to find them). */
  addSurvivor(x: number, y: number): SurvivorView | null {
    return this.ctx.survivors.add(x, y);
  }

  addCrowd(x: number, y: number, opts?: CrowdOptions): CrowdView | null {
    return this.ctx.priors.addCrowd(x, y, opts);
  }

  /** Remove user-placed survivors and crowds within `radius` cells. Returns how many were removed. */
  removeNear(x: number, y: number, radius: number): number {
    const r2 = radius * radius;
    return this.ctx.priors.removeUserCrowdsNear(x, y, r2) + this.ctx.survivors.removePlacedNear(x, y, r2);
  }

  private subStep(dt: number) {
    const { ctx } = this;
    ctx.state.time += dt;
    ctx.tsunami.tick();
    ctx.depot.drive(dt);
    for (const d of ctx.fleet) ctx.pilot.update(d, dt);
    if (ctx.sensor.obstacleDiscovered) {
      ctx.sensor.obstacleDiscovered = false;
      ctx.nav.repathBlocked(ctx.fleet);
    }
    if (ctx.state.metrics.complete) return;
    if (ctx.replan.tick(dt)) ctx.planner.replan();
    ctx.depot.tick(dt);
  }
}
