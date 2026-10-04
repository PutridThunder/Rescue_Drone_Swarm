// Shared state handed to every simulation subsystem. The Simulation facade creates one context,
// then the subsystems, and registers each subsystem here so they can collaborate.

import { searchAreaMask } from "../shared/searchArea";
import { Terrain } from "../shared/terrain";
import type { SimConfig, SimState, World } from "../types";
import type { Drone } from "./drone";
import type { DroneController } from "./droneController";
import { EventLog } from "./events";
import { buildObstacleMasks, cellIndex, type ObstacleMasks } from "./grid";
import { Knowledge } from "./knowledge";
import { MetricsAccumulator } from "./metrics";
import type { Mission } from "./mission";
import type { Navigator } from "./navigator";
import type { Planner } from "./planner";
import type { PopulationPriors } from "./populationPriors";
import { ReplanScheduler } from "./replanScheduler";
import type { Rng } from "./rng";
import type { SectorBoard } from "./sectorBoard";
import type { Sensor } from "./sensor";
import type { SurvivorRegistry } from "./survivors";
import type { TruckDepot } from "./truckDepot";
import type { Tsunami } from "./tsunami";

export class SimContext {
  readonly W: number;
  readonly H: number;
  readonly N: number;
  readonly masks: ObstacleMasks;
  /** Known obstacles: what path planning avoids (tall cells the fleet has seen or was told about). */
  readonly navBlocked: Uint8Array;
  /** Cells that path planning failed to reach; skipped as sweep targets. */
  readonly unreachable: Uint8Array;
  /** Cells inside the user's search circle, or null when the whole area is searched. */
  readonly area: Uint8Array | null;
  readonly knowledge: Knowledge;
  readonly log: EventLog;
  readonly replan = new ReplanScheduler();
  readonly stats = new MetricsAccumulator();
  /** Live state read by the renderer. Assigned once survivors and fleet exist. */
  state!: SimState;
  /** The drones (same objects as state.drones, with their internal fields). */
  fleet: Drone[] = [];

  // Subsystems, registered by the Simulation constructor.
  survivors!: SurvivorRegistry;
  priors!: PopulationPriors;
  sectors!: SectorBoard;
  tsunami!: Tsunami;
  depot!: TruckDepot;
  nav!: Navigator;
  sensor!: Sensor;
  pilot!: DroneController;
  planner!: Planner;
  mission!: Mission;

  constructor(
    readonly world: World,
    /** Structural settings frozen at construction; weights and info modes live in state.config. */
    readonly cfg: SimConfig,
    readonly rng: Rng,
  ) {
    this.W = world.meta.width;
    this.H = world.meta.height;
    this.N = this.W * this.H;
    this.masks = buildObstacleMasks(world, cfg.flightAltitudeM);
    this.navBlocked = new Uint8Array(this.N);
    this.unreachable = new Uint8Array(this.N);
    this.area = searchAreaMask(cfg.searchArea ?? null, this.W, this.H);
    this.knowledge = new Knowledge(this.N);
    this.log = new EventLog(() => this.state.time);
  }

  cellIndex(x: number, y: number): number {
    return cellIndex(x, y, this.W, this.H);
  }

  /** Cells the fleet can search at all: land that a sensor can see. */
  isSearchable(i: number): boolean {
    return this.world.terrain[i] !== Terrain.Water && !this.masks.hidden[i] && this.inArea(i);
  }

  /** Inside the search circle (always true without one). */
  inArea(i: number): boolean {
    return !this.area || this.area[i] === 1;
  }

  /** Cells counted toward a block's coverage, given what the fleet currently knows. */
  countsForCoverage(i: number): boolean {
    return this.inArea(i) && !((this.knowledge.known[i] && this.world.terrain[i] === Terrain.Water) || this.masks.hidden[i]);
  }

  /** Searchable cells whose centres are within `r` of (x, y). */
  searchableCellsAround(x: number, y: number, r: number): number[] {
    const out: number[] = [];
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) continue;
        if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > r * r) continue;
        const i = cy * this.W + cx;
        if (this.isSearchable(i)) out.push(i);
      }
    }
    return out;
  }
}
