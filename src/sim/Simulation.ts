import type {
  CrowdView,
  FloodState,
  InfoModes,
  ISimulation,
  SimConfig,
  SimEvent,
  SimEventType,
  SimState,
  SurvivorView,
  World,
} from "../types";
import {
  allocate,
  DETOUR,
  nearestHome,
  type AllocDrone,
  type AllocTask,
} from "./allocation";
import { AStar, lineOfSight, smoothPath } from "./astar";
import { Drone } from "./drone";
import { updateFrontier } from "./frontier";
import { buildSensorDisc, Knowledge, type SensorDisc } from "./knowledge";
import { createMetrics, MetricsAccumulator } from "./metrics";
import {
  computeTerms,
  emptyAgg,
  normalizedPriorities,
  rescueWeight,
  type SectorAgg,
  type Terms,
} from "./priority";
import { Rng } from "./rng";
import {
  clamp01,
  computeFloodMask,
  computeHazardTruth,
  estimateHazard,
  sampleSurvivors,
} from "./scenario";
import {
  buildSectors,
  insideSector,
  SECTOR_DONE,
  sectorAt,
  type Sector,
} from "./tasks";
import { Truck } from "./truck";

const WATER = 0;
const ROAD = 2;
export const SEARCHED_THRESHOLD = 0.8;
const REPLAN_INTERVAL = 1.5; // s
const CHARGE_TIME = 4; // s, empty -> full
const HOVER_DRAIN = 0.15; // cells of battery per second aloft
const HYSTERESIS = 0.15;
const RELEASED_BONUS = 0.4; // a block abandoned by a failed drone should be picked up promptly
const DETECT_PROB = 0.97; // scales per-observation gain into detection probability
const REVISIT_GAP = 5; // s; re-observation after this long counts as a new visit
const MAX_SUBSTEP_CELLS = 0.5;
const HAZARD_PATH_COST = 0.5;
const TRUCK_SPEED_FRAC = 0.35; // truck speed relative to drones
const TRUCK_REPLAN = 6; // s between truck repositioning decisions
const TRUCK_MOVE_MIN = 15; // cells; don't bother relocating for less
const DOCK_DIST = 0.6; // cells
const FACADE_GAIN = 0.6; // looking at a high-rise from the street is less thorough than overflying
const CROWD_RADIUS = 3; // cells
const CROWD_PEOPLE = 60;
const CROWD_SURVIVORS = 3;

interface Change {
  drone: Drone;
  from: number | null;
  to: number | null;
  takeoverFrom?: number;
}

export class Simulation implements ISimulation {
  readonly state: SimState;
  /** Ground-truth flood zone (tsunami only), exposed for the renderer. */
  readonly floodMask: Uint8Array | null;
  /** Survivors found before the tsunami struck (tsunami only; null until impact). */
  foundBeforeImpact: number | null = null;

  private readonly world: World;
  /** Structural settings frozen at construction (updateConfig only changes weights/info live). */
  private readonly fixed: SimConfig;
  private readonly W: number;
  private readonly H: number;
  private readonly N: number;
  private readonly rng: Rng;
  private readonly k: Knowledge;
  private readonly disc: SensorDisc;
  private readonly astar: AStar;
  private readonly tall: Uint8Array;
  private readonly navBlocked: Uint8Array;
  private readonly unreachable: Uint8Array;
  private readonly navCostBuf: Float32Array;
  private navCost: Float32Array | null = null;
  private readonly hazardTruth: Float32Array | null;
  private readonly floodProne: Uint8Array;
  private readonly hasSurvivor: Uint8Array;
  private readonly survivorAt = new Map<number, SurvivorView[]>();
  private readonly sectors: Sector[];
  private readonly sectorCols: number;
  private readonly drones: Drone[];
  private readonly trucks: Truck[];
  private readonly acc = new MetricsAccumulator();
  /** Population prior (world copy; user-planted crowds add to it). */
  private readonly pop: Float32Array;
  /** Cells no sensor can see (inside high-rises): excluded from coverage like water. */
  private readonly hidden: Uint8Array;
  private readonly truckBlocked: Uint8Array;
  private readonly roadCells: number[] = [];
  private truckTimer = 0;
  private nextSurvivorId: number;
  private nextCrowdId = 1;
  private readonly baseX: number;
  private readonly baseY: number;
  private readonly margin: number;
  private readonly popFloor: number;
  private events: SimEvent[] = [];
  private replanTimer = 0;
  private replanReasons: string[] = [];
  private announceReplan = false;
  private readonly released = new Map<number, number>(); // sector id -> drone that released it
  private readonly releasedPriority = new Map<number, number>(); // priority it was assigned at
  private obstacleDiscovered = false;

  constructor(world: World, config: SimConfig) {
    this.world = world;
    const W = (this.W = world.meta.width);
    const H = (this.H = world.meta.height);
    const N = (this.N = W * H);
    const cfg = structuredClone(config);
    this.fixed = structuredClone(config);
    this.rng = new Rng(cfg.seed);

    const tsunami = cfg.scenario === "tsunami";
    this.hazardTruth = tsunami
      ? computeHazardTruth(world, cfg.tsunamiRunupM)
      : null;
    this.floodMask = tsunami
      ? computeFloodMask(world, cfg.tsunamiRunupM)
      : null;
    this.floodProne = new Uint8Array(N);

    this.pop = Float32Array.from(world.population);
    this.tall = new Uint8Array(N);
    for (let i = 0; i < N; i++)
      if (world.buildingHeight[i] > cfg.flightAltitudeM) this.tall[i] = 1;
    this.hidden = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!this.tall[i]) continue;
        const open = (j: number, ok: boolean) => ok && !this.tall[j];
        if (!(
          open(i - 1, x > 0) ||
          open(i + 1, x < W - 1) ||
          open(i - W, y > 0) ||
          open(i + W, y < H - 1)
        ))
          this.hidden[i] = 1;
      }
    }
    const allowed = new Uint8Array(N);
    for (let i = 0; i < N; i++) allowed[i] = this.hidden[i] ? 0 : 1;

    const survivors = sampleSurvivors(
      world,
      cfg.survivorCount,
      this.rng,
      this.hazardTruth,
      allowed,
    );
    this.nextSurvivorId = survivors.length + 1;
    this.hasSurvivor = new Uint8Array(N);
    for (const s of survivors) this.indexSurvivor(s);

    this.k = new Knowledge(N);
    this.disc = buildSensorDisc(cfg.sensorRange);
    this.astar = new AStar(W, H);
    this.navBlocked = new Uint8Array(N);
    this.unreachable = new Uint8Array(N);
    this.navCostBuf = new Float32Array(N);

    let popTotal = 0;
    for (let i = 0; i < N; i++) {
      if (world.terrain[i] !== WATER && !this.hidden[i]) {
        this.acc.searchableCells++;
        popTotal += this.pop[i];
      }
    }
    this.popFloor =
      this.acc.searchableCells > 0
        ? (0.1 * popTotal) / this.acc.searchableCells
        : 0;

    const { sectors, cols } = buildSectors(W, H);
    this.sectors = sectors;
    this.sectorCols = cols;
    for (const s of sectors)
      s.view.label = this.streetLabel(s) ?? `Block ${s.name}`;

    this.baseX = world.base.x + 0.5;
    this.baseY = world.base.y + 0.5;
    this.margin = 0.04 * cfg.batteryCapacity + 3;
    this.truckBlocked = new Uint8Array(N).fill(1);
    this.trucks = this.spawnTrucks(Math.max(1, cfg.truckCount));
    this.drones = [];
    for (let i = 0; i < cfg.droneCount; i++) {
      const t = this.trucks[i % this.trucks.length];
      const d = new Drone(
        i + 1,
        t.x,
        t.y,
        cfg.sensorRange,
        cfg.batteryCapacity,
      );
      d.dockedTruck = t.id;
      this.drones.push(d);
    }

    const flood: FloodState | null = tsunami
      ? {
          timeToImpact: cfg.tsunamiImpactTime,
          impacted: false,
          runupM: cfg.tsunamiRunupM,
        }
      : null;

    this.state = {
      time: 0,
      running: false,
      config: cfg,
      knowledge: this.k.view,
      drones: this.drones,
      trucks: this.trucks,
      crowds: [],
      tasks: [],
      survivors,
      flood,
      metrics: createMetrics(survivors.length, popTotal),
    };

    this.applyInfo(null);
    this.replanReasons.push("initial deployment");
    this.announceReplan = true;
    this.replan();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  start() {
    if (!this.state.metrics.complete) this.state.running = true;
  }

  pause() {
    this.state.running = false;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    const st = this.state;
    if (st.metrics.complete) {
      // Mission over: keep flying until every drone has landed on a truck.
      if (!this.drones.some((d) => d.airborne)) {
        st.running = false;
        return;
      }
    }
    const n = Math.max(
      1,
      Math.ceil((dt * this.fixed.speed) / MAX_SUBSTEP_CELLS),
    );
    const h = dt / n;
    for (let i = 0; i < n; i++) this.subStep(h);
    if (!st.metrics.complete) this.updateMetrics();
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  drainDirtyCells(): number[] {
    return this.k.drain();
  }

  disableDrone(id?: number): number | null {
    const active = this.drones.filter((d) => d.active);
    if (active.length === 0) return null;
    const pool = active.filter((x) => x.airborne);
    const d =
      id == null
        ? (pool.length ? pool : active)[
            this.rng.int((pool.length ? pool : active).length)
          ]
        : active.find((x) => x.id === id);
    if (!d) return null;
    const s = d.taskId != null ? this.sectors[d.taskId] : null;
    if (s) this.releaseTask(d);
    d.status = "DISABLED";
    d.path = [];
    d.charging = false;
    d.dockedTruck = null;
    this.state.metrics.droneFailures++;
    this.emit(
      "failure",
      `Drone ${d.id} went down${s ? ` — ${s.view.label} handed back to the fleet` : ""}`,
      d.id,
      s?.id,
    );
    if (!this.state.metrics.complete) {
      this.replanReasons.push(`Drone ${d.id} lost`);
      this.announceReplan = true;
      this.replan();
    }
    return d.id;
  }

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
        const diff = (Object.keys(cfg.info) as (keyof InfoModes)[]).filter(
          (m) => cfg.info[m] !== prev[m],
        );
        if (diff.length) {
          this.applyInfo(prev);
          reasons.push(
            `info ${diff.map((m) => `${m} ${cfg.info[m] ? "ON" : "OFF"}`).join(", ")}`,
          );
        }
      } else if (partial[key] !== undefined) {
        // Structural settings (fleet size, sensors, scenario, seed...) apply on the next Simulation.
        (cfg as unknown as Record<string, unknown>)[key] = structuredClone(
          partial[key],
        );
      }
    }
    if (reasons.length && !this.state.metrics.complete) {
      for (const d of this.drones) d.commitment = 0; // new information: let the fleet re-evaluate freely
      this.replanReasons.push(...reasons);
      this.announceReplan = true;
      this.replan();
    }
  }

  sectorName(taskId: number): string {
    return this.sectors[taskId]?.view.label ?? `#${taskId}`;
  }

  /** Plant a survivor (ground truth only — the fleet has to find them). */
  addSurvivor(x: number, y: number): SurvivorView | null {
    const i = this.cellIndex(x, y);
    if (i < 0 || this.world.terrain[i] === WATER || this.hidden[i]) return null;
    const s: SurvivorView = {
      id: this.nextSurvivorId++,
      x,
      y,
      found: false,
      foundBy: null,
      foundAt: null,
      lost: false,
      placed: true,
    };
    this.state.survivors.push(s);
    this.indexSurvivor(s);
    this.state.metrics.survivorsTotal++;
    return s;
  }

  /**
   * Plant a crowd: a reported gathering the fleet knows about (population prior, used when
   * population intel is on) with a few people actually there to be found.
   */
  addCrowd(x: number, y: number): CrowdView | null {
    const i = this.cellIndex(x, y);
    if (i < 0 || this.world.terrain[i] === WATER) return null;
    const cells = this.cellsAround(x, y, CROWD_RADIUS);
    if (cells.length === 0) return null;
    for (const j of cells) this.pop[j] += CROWD_PEOPLE / cells.length;
    const crowd: CrowdView = {
      id: this.nextCrowdId++,
      x,
      y,
      radius: CROWD_RADIUS,
      people: CROWD_PEOPLE,
    };
    this.state.crowds.push(crowd);
    this.state.metrics.populationTotal += CROWD_PEOPLE;
    for (let k = 0; k < CROWD_SURVIVORS; k++) {
      const j = cells[this.rng.int(cells.length)];
      this.addSurvivor(
        (j % this.W) + this.rng.range(0.2, 0.8),
        Math.floor(j / this.W) + this.rng.range(0.2, 0.8),
      );
    }
    const label = this.sectors[sectorAt(x, y, this.sectorCols)].view.label;
    if (!this.state.metrics.complete) {
      this.replanReasons.push(`crowd reported near ${label}`);
      this.announceReplan = true;
    }
    this.emit("placed", `Crowd of ~${CROWD_PEOPLE} reported near ${label}`);
    return crowd;
  }

  /** Remove user-planted survivors and crowds within `radius` cells. Returns how many were removed. */
  removeNear(x: number, y: number, radius: number): number {
    const st = this.state;
    let removed = 0;
    const r2 = radius * radius;
    for (let k = st.crowds.length - 1; k >= 0; k--) {
      const c = st.crowds[k];
      if ((c.x - x) ** 2 + (c.y - y) ** 2 > r2) continue;
      const cells = this.cellsAround(c.x, c.y, c.radius);
      for (const j of cells)
        this.pop[j] = Math.max(
          this.world.population[j],
          this.pop[j] - c.people / cells.length,
        );
      st.metrics.populationTotal -= c.people;
      st.crowds.splice(k, 1);
      removed++;
    }
    for (let k = st.survivors.length - 1; k >= 0; k--) {
      const s = st.survivors[k];
      if (
        !s.placed ||
        s.found ||
        s.lost ||
        (s.x - x) ** 2 + (s.y - y) ** 2 > r2
      )
        continue;
      const i = this.cellIndex(s.x, s.y);
      const list = this.survivorAt.get(i)!.filter((o) => o !== s);
      if (list.length) this.survivorAt.set(i, list);
      else {
        this.survivorAt.delete(i);
        this.hasSurvivor[i] = 0;
      }
      st.survivors.splice(k, 1);
      st.metrics.survivorsTotal--;
      removed++;
    }
    return removed;
  }

  private cellIndex(x: number, y: number): number {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    return cx < 0 || cy < 0 || cx >= this.W || cy >= this.H
      ? -1
      : cy * this.W + cx;
  }

  private cellsAround(x: number, y: number, r: number): number[] {
    const out: number[] = [];
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) continue;
        if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > r * r) continue;
        const i = cy * this.W + cx;
        if (this.world.terrain[i] !== WATER && !this.hidden[i]) out.push(i);
      }
    }
    return out;
  }

  private indexSurvivor(s: SurvivorView) {
    const i = Math.floor(s.y) * this.W + Math.floor(s.x);
    this.hasSurvivor[i] = 1;
    const list = this.survivorAt.get(i);
    if (list) list.push(s);
    else this.survivorAt.set(i, [s]);
  }

  /** "Lonsdale Ave & W 3rd St" from the two most common street names in and around the block. */
  private streetLabel(s: Sector): string | null {
    const { roadName, roadNames } = this.world;
    if (!roadNames.length) return null;
    const counts = new Map<number, number>();
    for (let y = Math.max(0, s.y0 - 2); y < Math.min(this.H, s.y1 + 2); y++) {
      for (let x = Math.max(0, s.x0 - 2); x < Math.min(this.W, s.x1 + 2); x++) {
        const n = roadName[y * this.W + x];
        if (n >= 0) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (top.length === 0) return null;
    if (top.length === 1) return roadNames[top[0][0]];
    return `${roadNames[top[0][0]]} & ${roadNames[top[1][0]]}`;
  }

  /** Trucks start near the staging area on the connected road network, spaced apart. */
  private spawnTrucks(count: number): Truck[] {
    const { terrain } = this.world;
    const W = this.W;
    const N = this.N;
    let start = -1;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      if (terrain[i] !== ROAD) continue;
      const d =
        ((i % W) + 0.5 - this.baseX) ** 2 +
        (Math.floor(i / W) + 0.5 - this.baseY) ** 2;
      if (d < bestD) {
        bestD = d;
        start = i;
      }
    }
    const trucks: Truck[] = [];
    if (start < 0) {
      // No roads (synthetic worlds): trucks can park anywhere on open land.
      for (let i = 0; i < N; i++) {
        if (terrain[i] !== WATER && !this.tall[i]) {
          this.truckBlocked[i] = 0;
          this.roadCells.push(i);
        }
      }
      for (let k = 0; k < count; k++)
        trucks.push(new Truck(k + 1, this.baseX, this.baseY));
      return trucks;
    }
    const order: number[] = [start];
    this.truckBlocked[start] = 0;
    for (let q = 0; q < order.length; q++) {
      const i = order[q];
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const j of nb) {
        if (j < 0 || j >= N || !this.truckBlocked[j] || terrain[j] !== ROAD)
          continue;
        this.truckBlocked[j] = 0;
        order.push(j);
      }
    }
    this.roadCells.push(...order);
    // BFS order is road distance from staging; space the trucks out along it.
    for (let k = 0; k < count; k++) {
      const i = order[Math.min(order.length - 1, k * 60)];
      trucks.push(new Truck(k + 1, (i % W) + 0.5, Math.floor(i / W) + 0.5));
    }
    return trucks;
  }

  /**
   * Move trucks toward where the work is: weighted k-means over the active and highest-priority
   * blocks, snapped to the road network, so drones spend less battery commuting.
   */
  private repositionTrucks() {
    this.truckTimer = TRUCK_REPLAN;
    const tasks = this.state.tasks;
    if (tasks.length === 0 || this.roadCells.length === 0) return;
    const pts: { x: number; y: number; w: number }[] = [];
    for (const t of tasks) {
      const w =
        t.assignedDrone != null ? 1.5 : t.priority > 0.5 ? t.priority : 0;
      if (w > 0) pts.push({ x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2, w });
    }
    if (pts.length === 0) return;
    const cs = this.trucks.map((t) => ({ x: t.x, y: t.y }));
    for (let iter = 0; iter < 6; iter++) {
      const sx = cs.map(() => 0);
      const sy = cs.map(() => 0);
      const sw = cs.map(() => 0);
      for (const p of pts) {
        let k = 0;
        let bd = Infinity;
        cs.forEach((c, ci) => {
          const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
          if (d < bd) {
            bd = d;
            k = ci;
          }
        });
        sx[k] += p.x * p.w;
        sy[k] += p.y * p.w;
        sw[k] += p.w;
      }
      cs.forEach((c, ci) => {
        if (sw[ci] > 0) {
          c.x = sx[ci] / sw[ci];
          c.y = sy[ci] / sw[ci];
        }
      });
    }
    this.trucks.forEach((t, k) => {
      const target = this.nearestRoadCell(cs[k].x, cs[k].y);
      const tx = target % this.W;
      const ty = Math.floor(target / this.W);
      const ref = t.goal ?? t;
      if (Math.hypot(tx + 0.5 - ref.x, ty + 0.5 - ref.y) < TRUCK_MOVE_MIN)
        return;
      const cells = this.astar.find(
        Math.floor(t.x),
        Math.floor(t.y),
        tx,
        ty,
        this.truckBlocked,
        null,
      );
      if (!cells || cells.length < 2) return;
      t.path = cells.map((c) => ({
        x: (c % this.W) + 0.5,
        y: Math.floor(c / this.W) + 0.5,
      }));
      t.goal = { x: tx + 0.5, y: ty + 0.5 };
      t.status = "DRIVING";
      const label = this.sectors[sectorAt(tx, ty, this.sectorCols)].view.label;
      const km = ((cells.length * this.world.meta.cellSizeM) / 1000).toFixed(1);
      this.emit(
        "truck",
        `Truck ${t.id} driving ${km} km to ${label} — closer to where the drones are working`,
      );
    });
  }

  private nearestRoadCell(x: number, y: number): number {
    let best = this.roadCells[0];
    let bd = Infinity;
    for (const i of this.roadCells) {
      const d =
        ((i % this.W) + 0.5 - x) ** 2 + (Math.floor(i / this.W) + 0.5 - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Core loop
  // ---------------------------------------------------------------------------

  private subStep(h: number) {
    const st = this.state;
    st.time += h;
    const flood = st.flood;
    if (flood && !flood.impacted) {
      flood.timeToImpact = this.fixed.tsunamiImpactTime - st.time;
      if (flood.timeToImpact <= 0) this.impact();
    } else if (flood) {
      flood.timeToImpact = this.fixed.tsunamiImpactTime - st.time;
    }

    const truckStep = this.fixed.speed * TRUCK_SPEED_FRAC * h;
    for (const t of this.trucks) t.advance(truckStep);
    for (const d of this.drones) this.updateDrone(d, h);
    if (this.obstacleDiscovered) {
      this.obstacleDiscovered = false;
      this.repathBlocked();
    }
    if (st.metrics.complete) return;

    this.replanTimer -= h;
    if (this.replanReasons.length > 0 || this.replanTimer <= 0) this.replan();
    this.truckTimer -= h;
    if (this.truckTimer <= 0 && !st.metrics.complete) this.repositionTrucks();
  }

  private updateDrone(d: Drone, h: number) {
    if (!d.active) return;
    this.acc.activeTime += h;
    if (d.status === "TRAVELLING" || d.status === "SEARCHING")
      this.acc.busyTime += h;

    if (
      d.dockedTruck !== null &&
      !d.charging &&
      (d.status === "TRAVELLING" || d.status === "SEARCHING")
    ) {
      d.dockedTruck = null; // take off for the assigned block
    }
    if (d.dockedTruck !== null) {
      // Landed: ride along with the truck, charge if needed.
      const t = this.trucks[d.dockedTruck - 1];
      d.x = t.x;
      d.y = t.y;
      d.heading = t.heading;
      if (d.charging) {
        d.batteryCells = Math.min(
          d.capacity,
          d.batteryCells + (d.capacity / CHARGE_TIME) * h,
        );
        d.battery = d.batteryCells / d.capacity;
        if (d.batteryCells >= d.capacity) {
          d.charging = false;
          d.status = "IDLE";
          if (d.chargeFrom < 0.8)
            this.emit(
              "recharged",
              `Drone ${d.id} recharged on Truck ${t.id} — ready to launch`,
              d.id,
            );
          this.replanTimer = 0;
        }
      }
      return;
    }

    if (
      d.status === "TRAVELLING" ||
      d.status === "SEARCHING" ||
      d.status === "IDLE"
    ) {
      if (d.batteryCells < this.distToTruck(d) * DETOUR + this.margin)
        this.lowBattery(d);
    }

    const moved = d.advance(this.fixed.speed * h);
    const used = moved + HOVER_DRAIN * h;
    d.drain(used);
    this.acc.batteryCells += used;

    const cell = Math.floor(d.y) * this.W + Math.floor(d.x);
    if (cell !== d.lastCell) {
      d.lastCell = cell;
      this.observe(d);
    }

    switch (d.status) {
      case "TRAVELLING": {
        const s = this.sectors[d.taskId!];
        if (insideSector(s, d.x, d.y)) {
          d.status = "SEARCHING";
          d.path = [];
        } else if (d.path.length === 0 && !this.pathToSector(d, s)) {
          this.completeTask(d, s, true);
        }
        break;
      }
      case "SEARCHING":
        if (d.path.length === 0) this.searchNext(d);
        break;
      case "RETURNING":
      case "LOW_BATTERY": {
        const t = this.nearestTruck(d.x, d.y);
        if (Math.hypot(t.x - d.x, t.y - d.y) < DOCK_DIST) this.dock(d, t);
        else if (d.path.length === 0 || this.goalDrifted(d, t))
          this.pathHome(d);
        break;
      }
      case "IDLE":
        // Airborne with nothing to do: go land.
        d.status = "RETURNING";
        this.pathHome(d);
        break;
    }
  }

  /** Sensor sweep: mark geography known, accumulate search confidence, roll for survivor detection. */
  private observe(d: Drone) {
    const { dx, dy, gain, rayStart, rayX, rayY } = this.disc;
    const { known, searched, lastObsT, lastObsDrone } = this.k;
    const terrain = this.world.terrain;
    const population = this.pop;
    const tall = this.tall;
    const W = this.W;
    const H = this.H;
    const t = this.state.time;
    const cx = Math.floor(d.x);
    const cy = Math.floor(d.y);
    for (let j = 0; j < dx.length; j++) {
      const x = cx + dx[j];
      const y = cy + dy[j];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (this.hidden[i]) continue;
      let blocked = false;
      for (let r = rayStart[j]; r < rayStart[j + 1]; r++) {
        const rx = cx + rayX[r];
        const ry = cy + rayY[r];
        if (rx >= 0 && ry >= 0 && rx < W && ry < H && tall[ry * W + rx]) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue; // high-rise in the way
      if (!known[i]) {
        known[i] = 1;
        this.k.markDirty(i);
        if (this.tall[i]) {
          this.navBlocked[i] = 1;
          this.obstacleDiscovered = true;
        }
      }
      const before = searched[i];
      const p = tall[i] ? gain[j] * FACADE_GAIN : gain[j];
      const after = before + (1 - before) * p;
      searched[i] = after;
      if (((before * 16) | 0) !== ((after * 16) | 0)) this.k.markDirty(i);
      if (terrain[i] === WATER) continue;

      if (lastObsDrone[i] !== d.id || t - lastObsT[i] > REVISIT_GAP) {
        this.acc.visits++;
        if (before > 0.9) this.acc.redundantVisits++;
      }
      lastObsDrone[i] = d.id;
      lastObsT[i] = t;
      if (before < SEARCHED_THRESHOLD && after >= SEARCHED_THRESHOLD) {
        this.acc.searchedCells++;
        this.acc.populationReached += population[i];
      }
      if (this.hasSurvivor[i]) this.detect(i, p, d);
    }
  }

  private detect(i: number, p: number, d: Drone) {
    for (const s of this.survivorAt.get(i)!) {
      if (s.found || s.lost) continue;
      if (this.rng.next() >= p * DETECT_PROB) continue;
      s.found = true;
      s.foundBy = d.id;
      s.foundAt = this.state.time;
      this.state.metrics.survivorsFound++;
      const si = sectorAt(s.x, s.y, this.sectorCols);
      const sec = this.sectors[si];
      for (const o of this.sectors) {
        const dc = Math.abs(o.col - sec.col);
        const dr = Math.abs(o.row - sec.row);
        if (dc <= 1 && dr <= 1)
          o.boost = Math.min(1, o.boost + (dc === 0 && dr === 0 ? 0.6 : 0.35));
      }
      this.emit(
        "survivor",
        `Survivor found by Drone ${d.id} near ${sec.view.label} — checking the surrounding blocks next`,
        d.id,
        sec.id,
      );
      this.replanReasons.push(`survivor found near ${sec.view.label}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Drone behaviours
  // ---------------------------------------------------------------------------

  /** Local sweep: fly to the nearest unsearched cell in the sector, preferring to keep heading. */
  private searchNext(d: Drone) {
    const s = this.sectors[d.taskId!];
    const { known, searched } = this.k;
    const terrain = this.world.terrain;
    const W = this.W;
    const hx = Math.cos(d.heading);
    const hy = Math.sin(d.heading);
    let believed = 0;
    let done = 0;
    let best = -1;
    let bestScore = Infinity;
    for (let y = s.y0; y < s.y1; y++) {
      for (let x = s.x0; x < s.x1; x++) {
        const i = y * W + x;
        if ((known[i] && terrain[i] === WATER) || this.hidden[i]) continue;
        believed++;
        if (searched[i] >= SEARCHED_THRESHOLD) {
          done++;
          continue;
        }
        if (this.navBlocked[i] || this.unreachable[i]) continue;
        const dx = x + 0.5 - d.x;
        const dy = y + 0.5 - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.7) continue;
        const cos = (dx * hx + dy * hy) / dist;
        const score = dist * (1.6 - 0.6 * cos);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }
    const frac = believed > 0 ? done / believed : 1;
    if (frac >= SECTOR_DONE || best < 0) {
      this.completeTask(d, s, frac < SECTOR_DONE && believed > 0);
      return;
    }
    if (!this.planPath(d, best % W, Math.floor(best / W)))
      this.unreachable[best] = 1;
  }

  private pathToSector(d: Drone, s: Sector): boolean {
    const { known, searched } = this.k;
    const terrain = this.world.terrain;
    const W = this.W;
    for (let attempt = 0; attempt < 4; attempt++) {
      let best = -1;
      let bestD = Infinity;
      for (let y = s.y0; y < s.y1; y++) {
        for (let x = s.x0; x < s.x1; x++) {
          const i = y * W + x;
          if (
            (known[i] && terrain[i] === WATER) ||
            this.navBlocked[i] ||
            this.unreachable[i] ||
            this.hidden[i]
          )
            continue;
          const dist =
            Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) +
            (searched[i] >= SEARCHED_THRESHOLD ? 1000 : 0);
          if (dist < bestD) {
            bestD = dist;
            best = i;
          }
        }
      }
      if (best < 0) return false;
      if (this.planPath(d, best % W, Math.floor(best / W))) return true;
      this.unreachable[best] = 1;
    }
    return true; // keep trying on later sub-steps
  }

  private planPath(d: Drone, tx: number, ty: number): boolean {
    const gx = tx + 0.5;
    const gy = ty + 0.5;
    const dist = Math.hypot(gx - d.x, gy - d.y);
    if (
      (!this.navCost || dist < 12) &&
      lineOfSight(d.x, d.y, gx, gy, this.navBlocked, this.W)
    ) {
      d.path = [{ x: gx, y: gy }];
      return true;
    }
    const cells = this.astar.find(
      Math.floor(d.x),
      Math.floor(d.y),
      tx,
      ty,
      this.navBlocked,
      this.navCost,
    );
    if (!cells) return false;
    d.path = smoothPath(cells, this.navBlocked, this.W);
    return true;
  }

  private pathHome(d: Drone) {
    const t = this.nearestTruck(d.x, d.y);
    if (!this.planPath(d, Math.floor(t.x), Math.floor(t.y))) d.path = [];
    d.path.push({ x: t.x, y: t.y });
  }

  /** Re-route when the truck we're flying to has moved away from our path's end. */
  private goalDrifted(d: Drone, t: Truck): boolean {
    const end = d.path[d.path.length - 1];
    return !end || Math.hypot(end.x - t.x, end.y - t.y) > 1.5;
  }

  private nearestTruck(x: number, y: number): Truck {
    let best = this.trucks[0];
    let bestD = Infinity;
    for (const t of this.trucks) {
      const dd = Math.hypot(t.x - x, t.y - y);
      if (dd < bestD) {
        bestD = dd;
        best = t;
      }
    }
    return best;
  }

  private distToTruck(d: Drone): number {
    return nearestHome(this.trucks, d.x, d.y);
  }

  private dock(d: Drone, t: Truck) {
    d.path = [];
    d.x = t.x;
    d.y = t.y;
    d.dockedTruck = t.id;
    if (d.battery < 0.98) {
      d.charging = true;
      d.chargeFrom = d.battery;
      d.status = "CHARGING";
    } else {
      d.status = "IDLE";
    }
    this.replanTimer = Math.min(this.replanTimer, 0.25);
  }

  private lowBattery(d: Drone) {
    const s = d.taskId != null ? this.sectors[d.taskId] : null;
    if (s) this.releaseTask(d);
    d.status = "LOW_BATTERY";
    this.pathHome(d);
    const t = this.nearestTruck(d.x, d.y);
    this.emit(
      "lowBattery",
      `Drone ${d.id} at ${Math.round(d.battery * 100)}% battery — flying to Truck ${t.id} to recharge${s ? `, ${s.view.label} handed back` : ""}`,
      d.id,
      s?.id,
    );
    if (s) this.replanReasons.push(`Drone ${d.id} recalled to recharge`);
  }

  private releaseTask(d: Drone) {
    if (d.taskId == null) return;
    this.sectors[d.taskId].view.assignedDrone = null;
    this.released.set(d.taskId, d.id);
    this.releasedPriority.set(d.taskId, d.commitment);
    d.taskId = null;
  }

  private completeTask(d: Drone, s: Sector, exhausted: boolean) {
    if (exhausted) s.exhausted = true;
    this.state.metrics.tasksCompleted++;
    const pct = Math.round(this.sectorSearchedFrac(s) * 100);
    this.emit(
      "taskComplete",
      exhausted
        ? `Drone ${d.id} finished ${s.view.label} (${pct}% searched, rest unreachable)`
        : `Drone ${d.id} finished ${s.view.label} (${pct}% searched)`,
      d.id,
      s.id,
    );
    s.view.assignedDrone = null;
    d.taskId = null;
    d.status = "IDLE";
    d.path = [];
    this.replanTimer = 0; // routine: replan now, but the assignment events speak for themselves
  }

  private repathBlocked() {
    for (const d of this.drones) {
      if (!d.active || d.path.length === 0) continue;
      let px = d.x;
      let py = d.y;
      let blocked = false;
      for (const wp of d.path) {
        if (!lineOfSight(px, py, wp.x, wp.y, this.navBlocked, this.W)) {
          blocked = true;
          break;
        }
        px = wp.x;
        py = wp.y;
      }
      if (!blocked) continue;
      const last = d.path[d.path.length - 1];
      if (!this.planPath(d, Math.floor(last.x), Math.floor(last.y)))
        d.path = [];
    }
  }

  private impact() {
    const st = this.state;
    const flood = st.flood!;
    flood.impacted = true;
    let lost = 0;
    for (const s of st.survivors) {
      if (
        !s.found &&
        !s.lost &&
        this.floodMask![Math.floor(s.y) * this.W + Math.floor(s.x)]
      ) {
        s.lost = true;
        lost++;
      }
    }
    let cells = 0;
    for (let i = 0; i < this.N; i++) cells += this.floodMask![i];
    st.metrics.survivorsLost += lost;
    this.foundBeforeImpact = st.metrics.survivorsFound;
    const area = ((cells * this.world.meta.cellSizeM ** 2) / 1e6).toFixed(1);
    this.emit(
      "impact",
      `TSUNAMI IMPACT — ${area} km² below ${flood.runupM} m flooded; ${lost} unfound survivor(s) lost, ${this.foundBeforeImpact} found in time`,
    );
    for (const d of this.drones) d.commitment = 0;
    this.replanReasons.push("tsunami impact");
    this.announceReplan = true;
  }

  // ---------------------------------------------------------------------------
  // Knowledge priors / info modes
  // ---------------------------------------------------------------------------

  private applyInfo(prev: InfoModes | null) {
    const info = this.state.config.info;
    const { known, searched } = this.k;
    if (!prev || prev.geography !== info.geography) {
      for (let i = 0; i < this.N; i++) {
        known[i] = info.geography || searched[i] > 0 ? 1 : 0;
        this.navBlocked[i] = known[i] & this.tall[i];
      }
      this.k.markAllDirty();
    }
    if (
      !prev ||
      prev.disaster !== info.disaster ||
      prev.elevation !== info.elevation
    ) {
      if (info.disaster && this.hazardTruth && this.floodMask) {
        estimateHazard(
          this.world,
          info,
          this.hazardTruth,
          this.floodMask,
          this.k.hazardBuf,
          this.floodProne,
        );
        for (let i = 0; i < this.N; i++)
          this.navCostBuf[i] = HAZARD_PATH_COST * this.k.hazardBuf[i];
        this.k.view.hazard = this.k.hazardBuf;
        this.navCost = this.navCostBuf;
      } else {
        this.k.view.hazard = null;
        this.navCost = null;
        this.floodProne.fill(0);
      }
      this.k.markAllDirty();
    }
  }

  // ---------------------------------------------------------------------------
  // Replanning: frontier -> candidate sectors -> priority -> allocation
  // ---------------------------------------------------------------------------

  private replan() {
    const st = this.state;
    const cfg = st.config;
    const reasons = [...new Set(this.replanReasons)];
    const announce = this.announceReplan;
    this.replanReasons = [];
    this.announceReplan = false;
    this.replanTimer = REPLAN_INTERVAL;
    this.updateMetrics();

    updateFrontier(this.k, this.world.terrain, this.W, this.H);

    const candidates: Sector[] = [];
    const aggs: SectorAgg[] = [];
    for (const s of this.sectors) {
      const agg = this.aggregate(s);
      s.view.searchedFrac = agg.searchedFrac;
      s.view.isFrontier = agg.frontier;
      s.view.assignedDrone = null;
      if (!s.exhausted && agg.believed > 0 && agg.searchedFrac < SECTOR_DONE) {
        candidates.push(s);
        aggs.push(agg);
      }
    }
    for (const id of this.released.keys()) {
      if (!candidates.some((c) => c.id === id)) {
        this.released.delete(id);
        this.releasedPriority.delete(id);
      }
    }

    const allResolved = st.survivors.every((s) => s.found || s.lost);
    if (
      candidates.length === 0 ||
      (allResolved && st.metrics.areaSearchedFrac >= 0.8)
    ) {
      st.tasks.length = 0;
      this.finish();
      return;
    }

    const flood = st.flood;
    const hazardOn = this.k.view.hazard !== null;
    const terms = computeTerms(aggs, {
      useHazard: hazardOn,
      useUrgency: hazardOn && !!flood && !flood.impacted,
      timePressure:
        flood && !flood.impacted
          ? 0.5 +
            0.5 * clamp01(1 - flood.timeToImpact / this.fixed.tsunamiImpactTime)
          : 0,
    });
    const priorities = normalizedPriorities(terms, cfg.weights);
    st.tasks.length = 0;
    candidates.forEach((s, i) => {
      s.view.priority = priorities[i];
      s.view.breakdown = { ...terms[i] };
      st.tasks.push(s.view);
    });

    const available = this.drones.filter(
      (d) =>
        d.active &&
        !d.charging &&
        (d.status === "IDLE" ||
          d.status === "TRAVELLING" ||
          d.status === "SEARCHING" ||
          d.status === "RETURNING"),
    );
    const allocDrones: AllocDrone[] = available.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      battery: d.batteryCells,
      task: d.taskId,
      commitment: d.commitment,
    }));
    const allocTasks: AllocTask[] = candidates.map((s, i) => ({
      id: s.id,
      cx: s.cx,
      cy: s.cy,
      // An abandoned block keeps the priority it was assigned at, so someone finishes it.
      priority: Math.max(priorities[i], this.releasedPriority.get(s.id) ?? 0),
      searchCost: aggs[i].unsearched / (1.4 * this.fixed.sensorRange),
      released: this.released.has(s.id),
    }));
    const result = allocate(allocDrones, allocTasks, {
      weights: cfg.weights,
      diag: Math.hypot(this.W, this.H),
      capacity: this.fixed.batteryCapacity,
      homes: this.trucks,
      hysteresis: HYSTERESIS,
      releasedBonus: RELEASED_BONUS,
      spread: 25,
      margin: this.margin,
    });

    const owner = new Map<number, number>();
    for (const d of this.drones)
      if (d.taskId != null) owner.set(d.taskId, d.id);
    const byDrone = new Map(result.map((a) => [a.droneId, a]));
    const changes: Change[] = [];
    const distance = new Map<number, number>();

    for (const d of available) {
      const a = byDrone.get(d.id);
      if (a) {
        const b = this.sectors[a.taskId].view.breakdown;
        b.distance = a.distCost;
        b.battery = a.battCost;
        b.redundancy = a.redundancy;
        distance.set(d.id, a.distance);
      }
      const to = a ? a.taskId : null;
      if (to === d.taskId) {
        if (to == null && d.status === "RETURNING") continue;
        if (to != null || d.dockedTruck !== null) continue;
      }
      d.commitment =
        to != null ? priorities[candidates.indexOf(this.sectors[to])] : 0;
      const change: Change = { drone: d, from: d.taskId, to };
      d.taskId = to;
      if (to == null) {
        if (d.dockedTruck !== null) {
          d.status = "IDLE";
          d.path = [];
        } else {
          d.status = "RETURNING";
          this.pathHome(d);
        }
      } else {
        const s = this.sectors[to];
        if (insideSector(s, d.x, d.y)) {
          d.status = "SEARCHING";
          d.path = [];
        } else {
          d.status = "TRAVELLING";
          this.pathToSector(d, s);
        }
        const rel = this.released.get(to);
        const prevOwner = owner.get(to);
        if (rel !== undefined) {
          this.released.delete(to);
          this.releasedPriority.delete(to);
          change.takeoverFrom = rel;
          st.metrics.tasksReassigned++;
        } else if (prevOwner !== undefined && prevOwner !== d.id) {
          change.takeoverFrom = prevOwner;
          st.metrics.tasksReassigned++;
        }
      }
      changes.push(change);
    }
    for (const d of this.drones)
      if (d.active && d.taskId != null)
        this.sectors[d.taskId].view.assignedDrone = d.id;

    if (reasons.length && (changes.length || announce)) {
      const what = changes.length
        ? `${changes.length} drone${changes.length === 1 ? "" : "s"} re-tasked`
        : `${candidates.length} blocks re-scored, plan unchanged`;
      this.emit("replan", `Replanned (${reasons.join("; ")}): ${what}`);
    }
    for (const c of changes)
      this.emitAssignment(
        c,
        terms,
        priorities,
        candidates,
        distance.get(c.drone.id) ?? 0,
      );
  }

  private aggregate(s: Sector): SectorAgg {
    const agg = emptyAgg();
    const { known, searched, frontier } = this.k;
    const hazard = this.k.view.hazard;
    const terrain = this.world.terrain;
    const population = this.pop;
    const info = this.state.config.info;
    const impacted = !!this.state.flood?.impacted;
    const flood = this.floodMask;
    const W = this.W;
    let done = 0;
    for (let y = s.y0; y < s.y1; y++) {
      for (let x = s.x0; x < s.x1; x++) {
        const i = y * W + x;
        if ((known[i] && terrain[i] === WATER) || this.hidden[i]) continue;
        agg.believed++;
        if (frontier[i]) agg.frontier = true;
        const sv = searched[i];
        if (sv >= SEARCHED_THRESHOLD) {
          done++;
          continue;
        }
        const u = 1 - sv;
        agg.unsearched += u;
        const live = impacted && flood![i] ? 0 : 1;
        const pop = info.population ? population[i] : 1;
        const hz = hazard ? hazard[i] : 0;
        agg.population += pop * u * live;
        agg.hazard += hz * u * live;
        if (!impacted && this.floodProne[i])
          agg.flood +=
            u * (info.population ? population[i] + this.popFloor : 1);
        agg.rescue += pop * (hazard ? 0.25 + hz : 1) * u * live;
      }
    }
    agg.searchedFrac = agg.believed > 0 ? done / agg.believed : 1;
    agg.boost = s.boost;
    return agg;
  }

  private sectorSearchedFrac(s: Sector): number {
    const { known, searched } = this.k;
    let believed = 0;
    let done = 0;
    for (let y = s.y0; y < s.y1; y++) {
      for (let x = s.x0; x < s.x1; x++) {
        const i = y * this.W + x;
        if ((known[i] && this.world.terrain[i] === WATER) || this.hidden[i])
          continue;
        believed++;
        if (searched[i] >= SEARCHED_THRESHOLD) done++;
      }
    }
    return believed > 0 ? done / believed : 1;
  }

  private emitAssignment(
    c: Change,
    terms: Terms[],
    priorities: number[],
    candidates: Sector[],
    dist: number,
  ) {
    const d = c.drone;
    if (c.to == null) {
      if (c.from != null)
        this.emit(
          "reassign",
          `Drone ${d.id} has nothing worthwhile in range — landing on the nearest truck`,
          d.id,
        );
      return;
    }
    const s = this.sectors[c.to];
    const idx = candidates.indexOf(s);
    const w = this.state.config.weights;
    const t = terms[idx];
    const contrib: [string, number, number][] = [
      ["urgency", w.urgency * t.urgency, t.urgency],
      ["hazard", w.hazard * t.hazard, t.hazard],
      ["population", w.population * t.population, t.population],
      ["rescue value", rescueWeight(w) * t.rescue, t.rescue],
      ["unsearched", w.information * t.information, t.information],
    ];
    const top = contrib
      .filter((x) => x[1] > 0.01)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name, , v]) => `${name} ${v.toFixed(2)}`);
    const km = ((dist * this.world.meta.cellSizeM) / 1000).toFixed(1);
    const why = `priority ${priorities[idx].toFixed(2)}: ${[...top, `${km} km`].join(", ")}`;
    let msg = `Drone ${d.id} → ${s.view.label} (${why})`;
    if (c.takeoverFrom !== undefined)
      msg += ` — taking over from Drone ${c.takeoverFrom}`;
    else if (c.from != null)
      msg += ` — switching from ${this.sectors[c.from].view.label}`;
    this.emit(
      c.from == null && c.takeoverFrom === undefined ? "assign" : "reassign",
      msg,
      d.id,
      s.id,
    );
  }

  private finish() {
    const st = this.state;
    if (st.metrics.complete) return;
    this.updateMetrics();
    st.metrics.complete = true;
    for (const d of this.drones) {
      if (!d.active) continue;
      if (d.taskId != null) this.sectors[d.taskId].view.assignedDrone = null;
      d.taskId = null;
      d.path = [];
      if (d.airborne) {
        d.status = "RETURNING";
        this.pathHome(d);
      } else if (d.status !== "DISABLED" && !d.charging) d.status = "IDLE";
    }
    for (const t of this.trucks) {
      t.path = [];
      t.status = "PARKED";
    }
    const m = st.metrics;
    const mins = Math.floor(st.time / 60);
    const secs = Math.round(st.time % 60);
    this.emit(
      "complete",
      `Search complete in ${mins}m${String(secs).padStart(2, "0")}s — ${Math.round(m.areaSearchedFrac * 100)}% of area covered, ` +
        `${m.survivorsFound}/${m.survivorsTotal} survivors found${m.survivorsLost ? `, ${m.survivorsLost} lost` : ""}`,
    );
  }

  private updateMetrics() {
    let dist = 0;
    for (const d of this.drones) dist += d.distanceTravelled;
    this.acc.apply(
      this.state.metrics,
      this.state.time,
      dist,
      this.fixed.batteryCapacity,
    );
  }

  private emit(
    type: SimEventType,
    message: string,
    droneId?: number,
    taskId?: number,
  ) {
    const e: SimEvent = { t: this.state.time, type, message };
    if (droneId !== undefined) e.droneId = droneId;
    if (taskId !== undefined) e.taskId = taskId;
    this.events.push(e);
  }
}
