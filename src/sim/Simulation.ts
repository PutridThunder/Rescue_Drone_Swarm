import type {
  FloodState,
  InfoModes,
  ISimulation,
  SimConfig,
  SimEvent,
  SimEventType,
  SimState,
  SurvivorView,
  World,
} from '../types';
import { allocate, DETOUR, type AllocDrone, type AllocTask } from './allocation';
import { AStar, lineOfSight, smoothPath } from './astar';
import { Drone } from './drone';
import { updateFrontier } from './frontier';
import { buildSensorDisc, Knowledge, type SensorDisc } from './knowledge';
import { createMetrics, MetricsAccumulator } from './metrics';
import { computeTerms, emptyAgg, normalizedPriorities, rescueWeight, type SectorAgg, type Terms } from './priority';
import { Rng } from './rng';
import { clamp01, computeFloodMask, computeHazardTruth, estimateHazard, sampleSurvivors } from './scenario';
import { buildSectors, insideSector, SECTOR_DONE, sectorAt, type Sector } from './tasks';

const WATER = 0;
export const SEARCHED_THRESHOLD = 0.6;
const REPLAN_INTERVAL = 1.5; // s
const CRUISE_ALT_M = 45; // buildings taller than this are obstacles
const CHARGE_TIME = 4; // s, empty -> full
const HOVER_DRAIN = 0.15; // cells of battery per second aloft
const HYSTERESIS = 0.15;
const RELEASED_BONUS = 0.1;
const DETECT_PROB = 0.9; // scales per-observation gain into detection probability
const REVISIT_GAP = 5; // s; re-observation after this long counts as a new visit
const MAX_SUBSTEP_CELLS = 0.5;
const HAZARD_PATH_COST = 0.5;

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
  private readonly acc = new MetricsAccumulator();
  private readonly baseX: number;
  private readonly baseY: number;
  private readonly margin: number;
  private readonly popFloor: number;
  private events: SimEvent[] = [];
  private replanTimer = 0;
  private replanReasons: string[] = [];
  private announceReplan = false;
  private readonly released = new Map<number, number>(); // sector id -> drone that released it
  private obstacleDiscovered = false;

  constructor(world: World, config: SimConfig) {
    this.world = world;
    const W = (this.W = world.meta.width);
    const H = (this.H = world.meta.height);
    const N = (this.N = W * H);
    const cfg = structuredClone(config);
    this.fixed = structuredClone(config);
    this.rng = new Rng(cfg.seed);

    const tsunami = cfg.scenario === 'tsunami';
    this.hazardTruth = tsunami ? computeHazardTruth(world, cfg.tsunamiRunupM) : null;
    this.floodMask = tsunami ? computeFloodMask(world, cfg.tsunamiRunupM) : null;
    this.floodProne = new Uint8Array(N);

    const survivors = sampleSurvivors(world, cfg.survivorCount, this.rng, this.hazardTruth);
    this.hasSurvivor = new Uint8Array(N);
    for (const s of survivors) {
      const i = Math.floor(s.y) * W + Math.floor(s.x);
      this.hasSurvivor[i] = 1;
      const list = this.survivorAt.get(i);
      if (list) list.push(s);
      else this.survivorAt.set(i, [s]);
    }

    this.k = new Knowledge(N);
    this.disc = buildSensorDisc(cfg.sensorRange);
    this.astar = new AStar(W, H);
    this.tall = new Uint8Array(N);
    this.navBlocked = new Uint8Array(N);
    this.unreachable = new Uint8Array(N);
    this.navCostBuf = new Float32Array(N);

    let popTotal = 0;
    for (let i = 0; i < N; i++) {
      if (world.buildingHeight[i] > CRUISE_ALT_M) this.tall[i] = 1;
      if (world.terrain[i] !== WATER) {
        this.acc.searchableCells++;
        popTotal += world.population[i];
      }
    }
    this.popFloor = this.acc.searchableCells > 0 ? (0.1 * popTotal) / this.acc.searchableCells : 0;

    const { sectors, cols } = buildSectors(W, H);
    this.sectors = sectors;
    this.sectorCols = cols;

    this.baseX = world.base.x + 0.5;
    this.baseY = world.base.y + 0.5;
    this.margin = 0.04 * cfg.batteryCapacity + 3;
    this.drones = [];
    for (let i = 0; i < cfg.droneCount; i++) {
      this.drones.push(new Drone(i + 1, this.baseX, this.baseY, cfg.sensorRange, cfg.batteryCapacity));
    }

    const flood: FloodState | null = tsunami
      ? { timeToImpact: cfg.tsunamiImpactTime, impacted: false, runupM: cfg.tsunamiRunupM }
      : null;

    this.state = {
      time: 0,
      running: false,
      config: cfg,
      knowledge: this.k.view,
      drones: this.drones,
      tasks: [],
      survivors,
      flood,
      metrics: createMetrics(survivors.length, popTotal),
    };

    this.applyInfo(null);
    this.replanReasons.push('initial deployment');
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
    if (this.state.metrics.complete || dt <= 0) return;
    const n = Math.max(1, Math.ceil((dt * this.fixed.speed) / MAX_SUBSTEP_CELLS));
    const h = dt / n;
    for (let i = 0; i < n && !this.state.metrics.complete; i++) this.subStep(h);
    this.updateMetrics();
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
    const d = id == null ? active[this.rng.int(active.length)] : active.find((x) => x.id === id);
    if (!d) return null;
    const s = d.taskId != null ? this.sectors[d.taskId] : null;
    if (s) this.releaseTask(d);
    d.status = 'DISABLED';
    d.path = [];
    d.charging = false;
    this.state.metrics.droneFailures++;
    this.emit('failure', `Drone ${d.id} DISABLED — ${s ? `Sector ${s.name} released, ` : ''}fleet replanning`, d.id, s?.id);
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
      if (key === 'weights' && partial.weights) {
        cfg.weights = { ...cfg.weights, ...partial.weights };
        reasons.push('priority weights changed');
      } else if (key === 'info' && partial.info) {
        const prev = { ...cfg.info };
        cfg.info = { ...cfg.info, ...partial.info };
        const diff = (Object.keys(cfg.info) as (keyof InfoModes)[]).filter((m) => cfg.info[m] !== prev[m]);
        if (diff.length) {
          this.applyInfo(prev);
          reasons.push(`info ${diff.map((m) => `${m} ${cfg.info[m] ? 'ON' : 'OFF'}`).join(', ')}`);
        }
      } else if (partial[key] !== undefined) {
        // Structural settings (fleet size, sensors, scenario, seed...) apply on the next Simulation.
        (cfg as unknown as Record<string, unknown>)[key] = structuredClone(partial[key]);
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
    return this.sectors[taskId]?.name ?? `#${taskId}`;
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

    for (const d of this.drones) this.updateDrone(d, h);
    if (this.obstacleDiscovered) {
      this.obstacleDiscovered = false;
      this.repathBlocked();
    }

    this.replanTimer -= h;
    if (this.replanReasons.length > 0 || this.replanTimer <= 0) this.replan();
  }

  private updateDrone(d: Drone, h: number) {
    if (!d.active) return;
    this.acc.activeTime += h;
    if (d.status === 'TRAVELLING' || d.status === 'SEARCHING') this.acc.busyTime += h;

    if (d.charging) {
      d.batteryCells = Math.min(d.capacity, d.batteryCells + (d.capacity / CHARGE_TIME) * h);
      d.battery = d.batteryCells / d.capacity;
      if (d.batteryCells >= d.capacity) {
        d.charging = false;
        if (d.chargeFrom < 0.8) this.emit('recharged', `Drone ${d.id} recharged — rejoining the search pool`, d.id);
        this.replanTimer = 0;
      }
      return;
    }

    const atBase = this.atBase(d);
    if (d.status === 'TRAVELLING' || d.status === 'SEARCHING' || (d.status === 'IDLE' && !atBase)) {
      if (d.batteryCells < this.distToBase(d) * DETOUR + this.margin) this.lowBattery(d);
    }

    const moved = d.advance(this.fixed.speed * h);
    const used = moved + (d.status === 'IDLE' && atBase ? 0 : HOVER_DRAIN * h);
    d.drain(used);
    this.acc.batteryCells += used;

    const cell = Math.floor(d.y) * this.W + Math.floor(d.x);
    if (cell !== d.lastCell) {
      d.lastCell = cell;
      this.observe(d);
    }

    switch (d.status) {
      case 'TRAVELLING': {
        const s = this.sectors[d.taskId!];
        if (insideSector(s, d.x, d.y)) {
          d.status = 'SEARCHING';
          d.path = [];
        } else if (d.path.length === 0 && !this.pathToSector(d, s)) {
          this.completeTask(d, s, true);
        }
        break;
      }
      case 'SEARCHING':
        if (d.path.length === 0) this.searchNext(d);
        break;
      case 'RETURNING':
      case 'LOW_BATTERY':
        if (d.path.length === 0) {
          if (this.atBase(d)) this.arriveBase(d);
          else this.pathHome(d);
        }
        break;
    }
  }

  /** Sensor sweep: mark geography known, accumulate search confidence, roll for survivor detection. */
  private observe(d: Drone) {
    const { dx, dy, gain } = this.disc;
    const { known, searched, lastObsT, lastObsDrone } = this.k;
    const { terrain, population } = this.world;
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
      if (!known[i]) {
        known[i] = 1;
        this.k.markDirty(i);
        if (this.tall[i]) {
          this.navBlocked[i] = 1;
          this.obstacleDiscovered = true;
        }
      }
      const before = searched[i];
      const p = gain[j];
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
        if (dc <= 1 && dr <= 1) o.boost = Math.min(1, o.boost + (dc === 0 && dr === 0 ? 0.6 : 0.35));
      }
      this.emit(
        'survivor',
        `Survivor #${s.id} found by Drone ${d.id} in Sector ${sec.name} — boosting nearby sectors (survivors cluster)`,
        d.id,
        sec.id,
      );
      this.replanReasons.push(`survivor found in ${sec.name}`);
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
        if (known[i] && terrain[i] === WATER) continue;
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
    if (!this.planPath(d, best % W, Math.floor(best / W))) this.unreachable[best] = 1;
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
          if ((known[i] && terrain[i] === WATER) || this.navBlocked[i] || this.unreachable[i]) continue;
          const dist = Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) + (searched[i] >= SEARCHED_THRESHOLD ? 1000 : 0);
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
    if ((!this.navCost || dist < 12) && lineOfSight(d.x, d.y, gx, gy, this.navBlocked, this.W)) {
      d.path = [{ x: gx, y: gy }];
      return true;
    }
    const cells = this.astar.find(Math.floor(d.x), Math.floor(d.y), tx, ty, this.navBlocked, this.navCost);
    if (!cells) return false;
    d.path = smoothPath(cells, this.navBlocked, this.W);
    return true;
  }

  private pathHome(d: Drone) {
    if (!this.planPath(d, this.world.base.x, this.world.base.y)) d.path = [{ x: this.baseX, y: this.baseY }];
  }

  private atBase(d: Drone): boolean {
    return this.distToBase(d) < 0.3;
  }

  private distToBase(d: Drone): number {
    return Math.hypot(d.x - this.baseX, d.y - this.baseY);
  }

  private arriveBase(d: Drone) {
    d.path = [];
    d.status = 'IDLE';
    if (d.battery < 0.98) {
      d.charging = true;
      d.chargeFrom = d.battery;
    }
    this.replanTimer = Math.min(this.replanTimer, 0.25);
  }

  private lowBattery(d: Drone) {
    const s = d.taskId != null ? this.sectors[d.taskId] : null;
    if (s) this.releaseTask(d);
    d.status = 'LOW_BATTERY';
    this.pathHome(d);
    this.emit(
      'lowBattery',
      `Drone ${d.id} low battery (${Math.round(d.battery * 100)}%) — ${s ? `releasing Sector ${s.name}, ` : ''}returning to base`,
      d.id,
      s?.id,
    );
    if (s) this.replanReasons.push(`Drone ${d.id} recalled to recharge`);
  }

  private releaseTask(d: Drone) {
    if (d.taskId == null) return;
    this.sectors[d.taskId].view.assignedDrone = null;
    this.released.set(d.taskId, d.id);
    d.taskId = null;
  }

  private completeTask(d: Drone, s: Sector, exhausted: boolean) {
    if (exhausted) s.exhausted = true;
    this.state.metrics.tasksCompleted++;
    const pct = Math.round(this.sectorSearchedFrac(s) * 100);
    this.emit(
      'taskComplete',
      exhausted
        ? `Drone ${d.id} closed Sector ${s.name} (${pct}% searched, rest unreachable)`
        : `Drone ${d.id} completed Sector ${s.name} (${pct}% searched)`,
      d.id,
      s.id,
    );
    s.view.assignedDrone = null;
    d.taskId = null;
    d.status = 'IDLE';
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
      if (!this.planPath(d, Math.floor(last.x), Math.floor(last.y))) d.path = [];
    }
  }

  private impact() {
    const st = this.state;
    const flood = st.flood!;
    flood.impacted = true;
    let lost = 0;
    for (const s of st.survivors) {
      if (!s.found && !s.lost && this.floodMask![Math.floor(s.y) * this.W + Math.floor(s.x)]) {
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
      'impact',
      `TSUNAMI IMPACT — ${area} km² below ${flood.runupM} m flooded; ${lost} unfound survivor(s) lost, ${this.foundBeforeImpact} found in time`,
    );
    for (const d of this.drones) d.commitment = 0;
    this.replanReasons.push('tsunami impact');
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
    if (!prev || prev.disaster !== info.disaster || prev.elevation !== info.elevation) {
      if (info.disaster && this.hazardTruth && this.floodMask) {
        estimateHazard(this.world, info, this.hazardTruth, this.floodMask, this.k.hazardBuf, this.floodProne);
        for (let i = 0; i < this.N; i++) this.navCostBuf[i] = HAZARD_PATH_COST * this.k.hazardBuf[i];
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
    for (const id of this.released.keys()) if (!candidates.some((c) => c.id === id)) this.released.delete(id);

    const allResolved = st.survivors.every((s) => s.found || s.lost);
    if (candidates.length === 0 || (allResolved && st.metrics.areaSearchedFrac >= 0.8)) {
      st.tasks.length = 0;
      this.finish();
      return;
    }

    const flood = st.flood;
    const hazardOn = this.k.view.hazard !== null;
    const terms = computeTerms(aggs, {
      useHazard: hazardOn,
      useUrgency: hazardOn && !!flood && !flood.impacted,
      timePressure: flood && !flood.impacted ? 0.5 + 0.5 * clamp01(1 - flood.timeToImpact / this.fixed.tsunamiImpactTime) : 0,
    });
    const priorities = normalizedPriorities(terms, cfg.weights);
    st.tasks.length = 0;
    candidates.forEach((s, i) => {
      s.view.priority = priorities[i];
      s.view.breakdown = { ...terms[i] };
      st.tasks.push(s.view);
    });

    const available = this.drones.filter(
      (d) => d.active && !d.charging && (d.status === 'IDLE' || d.status === 'TRAVELLING' || d.status === 'SEARCHING'),
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
      priority: priorities[i],
      searchCost: aggs[i].unsearched / (1.4 * this.fixed.sensorRange),
      released: this.released.has(s.id),
    }));
    const result = allocate(allocDrones, allocTasks, {
      weights: cfg.weights,
      diag: Math.hypot(this.W, this.H),
      capacity: this.fixed.batteryCapacity,
      baseX: this.baseX,
      baseY: this.baseY,
      hysteresis: HYSTERESIS,
      releasedBonus: RELEASED_BONUS,
      spread: 25,
      margin: this.margin,
    });

    const owner = new Map<number, number>();
    for (const d of this.drones) if (d.taskId != null) owner.set(d.taskId, d.id);
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
      if (to === d.taskId) continue;
      d.commitment = to != null ? priorities[candidates.indexOf(this.sectors[to])] : 0;
      const change: Change = { drone: d, from: d.taskId, to };
      d.taskId = to;
      if (to == null) {
        if (this.atBase(d)) {
          d.status = 'IDLE';
          d.path = [];
        } else {
          d.status = 'RETURNING';
          this.pathHome(d);
        }
      } else {
        const s = this.sectors[to];
        if (insideSector(s, d.x, d.y)) {
          d.status = 'SEARCHING';
          d.path = [];
        } else {
          d.status = 'TRAVELLING';
          this.pathToSector(d, s);
        }
        const rel = this.released.get(to);
        const prevOwner = owner.get(to);
        if (rel !== undefined) {
          this.released.delete(to);
          change.takeoverFrom = rel;
          st.metrics.tasksReassigned++;
        } else if (prevOwner !== undefined && prevOwner !== d.id) {
          change.takeoverFrom = prevOwner;
          st.metrics.tasksReassigned++;
        }
      }
      changes.push(change);
    }
    for (const d of this.drones) if (d.active && d.taskId != null) this.sectors[d.taskId].view.assignedDrone = d.id;

    if (reasons.length && (changes.length || announce)) {
      const what = changes.length
        ? `${changes.length} drone${changes.length === 1 ? '' : 's'} re-tasked`
        : `${candidates.length} sectors re-scored, assignments unchanged`;
      this.emit('replan', `Fleet replan (${reasons.join('; ')}): ${what}`);
    }
    for (const c of changes) this.emitAssignment(c, terms, priorities, candidates, distance.get(c.drone.id) ?? 0);
  }

  private aggregate(s: Sector): SectorAgg {
    const agg = emptyAgg();
    const { known, searched, frontier } = this.k;
    const hazard = this.k.view.hazard;
    const { terrain, population } = this.world;
    const info = this.state.config.info;
    const impacted = !!this.state.flood?.impacted;
    const flood = this.floodMask;
    const W = this.W;
    let done = 0;
    for (let y = s.y0; y < s.y1; y++) {
      for (let x = s.x0; x < s.x1; x++) {
        const i = y * W + x;
        if (known[i] && terrain[i] === WATER) continue;
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
        if (!impacted && this.floodProne[i]) agg.flood += u * (info.population ? population[i] + this.popFloor : 1);
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
        if (known[i] && this.world.terrain[i] === WATER) continue;
        believed++;
        if (searched[i] >= SEARCHED_THRESHOLD) done++;
      }
    }
    return believed > 0 ? done / believed : 1;
  }

  private emitAssignment(c: Change, terms: Terms[], priorities: number[], candidates: Sector[], dist: number) {
    const d = c.drone;
    if (c.to == null) {
      const from = c.from != null ? ` (left Sector ${this.sectors[c.from].name})` : '';
      this.emit('reassign', `Drone ${d.id} has no worthwhile reachable sector${from} — returning to base`, d.id);
      return;
    }
    const s = this.sectors[c.to];
    const idx = candidates.indexOf(s);
    const w = this.state.config.weights;
    const t = terms[idx];
    const contrib: [string, number, number][] = [
      ['urgency', w.urgency * t.urgency, t.urgency],
      ['hazard', w.hazard * t.hazard, t.hazard],
      ['population', w.population * t.population, t.population],
      ['rescue value', rescueWeight(w) * t.rescue, t.rescue],
      ['unsearched', w.information * t.information, t.information],
    ];
    const top = contrib
      .filter((x) => x[1] > 0.01)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name, , v]) => `${name} ${v.toFixed(2)}`);
    const km = ((dist * this.world.meta.cellSizeM) / 1000).toFixed(1);
    const why = `priority ${priorities[idx].toFixed(2)}: ${[...top, `${km} km`].join(', ')}`;
    let msg = `Drone ${d.id} → Sector ${s.name} (${why})`;
    if (c.takeoverFrom !== undefined) msg += ` — taking over from Drone ${c.takeoverFrom}`;
    else if (c.from != null) msg += ` — switching from Sector ${this.sectors[c.from].name}`;
    this.emit(c.from == null && c.takeoverFrom === undefined ? 'assign' : 'reassign', msg, d.id, s.id);
  }

  private finish() {
    const st = this.state;
    if (st.metrics.complete) return;
    this.updateMetrics();
    st.metrics.complete = true;
    st.running = false;
    for (const d of this.drones) {
      if (!d.active) continue;
      if (d.taskId != null) this.sectors[d.taskId].view.assignedDrone = null;
      d.taskId = null;
      d.path = [];
      if (d.status !== 'DISABLED') d.status = 'IDLE';
    }
    const m = st.metrics;
    const mins = Math.floor(st.time / 60);
    const secs = Math.round(st.time % 60);
    this.emit(
      'complete',
      `Search complete in ${mins}m${String(secs).padStart(2, '0')}s — ${Math.round(m.areaSearchedFrac * 100)}% of area covered, ` +
        `${m.survivorsFound}/${m.survivorsTotal} survivors found${m.survivorsLost ? `, ${m.survivorsLost} lost` : ''}`,
    );
  }

  private updateMetrics() {
    let dist = 0;
    for (const d of this.drones) dist += d.distanceTravelled;
    this.acc.apply(this.state.metrics, this.state.time, dist, this.fixed.batteryCapacity);
  }

  private emit(type: SimEventType, message: string, droneId?: number, taskId?: number) {
    const e: SimEvent = { t: this.state.time, type, message };
    if (droneId !== undefined) e.droneId = droneId;
    if (taskId !== undefined) e.taskId = taskId;
    this.events.push(e);
  }
}
