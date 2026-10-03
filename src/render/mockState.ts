// Fake SimState generator for exercising the renderer + UI without the simulation layer.
import { Terrain, type DroneView, type SimConfig, type SimState, type SurvivorView, type TaskView, type World } from '../types';

export const MOCK_CONFIG: SimConfig = {
  seed: 1,
  droneCount: 6,
  sensorRange: 4,
  batteryCapacity: 900,
  speed: 4,
  survivorCount: 14,
  info: { geography: true, population: true, elevation: true, disaster: true },
  scenario: 'tsunami',
  tsunamiImpactTime: 45,
  tsunamiRunupM: 12,
  weights: { population: 1, hazard: 1.2, urgency: 1.5, information: 0.8, distance: 0.6, battery: 0.5, redundancy: 1 },
};

interface Cache {
  world: World;
  known: Uint8Array;
  searched: Float32Array;
  frontier: Uint8Array;
  hazard: Float32Array;
  survivorCells: { x: number; y: number }[];
  dirty: number[];
}

let cache: Cache | null = null;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function init(world: World): Cache {
  const n = world.terrain.length;
  const hazard = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (world.terrain[i] !== Terrain.Water && world.elevation[i] < 15) hazard[i] = 1 - world.elevation[i] / 15;
  }
  const rand = rng(7);
  const { width, height } = world.meta;
  const survivorCells: { x: number; y: number }[] = [];
  while (survivorCells.length < MOCK_CONFIG.survivorCount) {
    const x = Math.floor(rand() * width), y = Math.floor(rand() * height);
    if (world.terrain[y * width + x] !== Terrain.Water) survivorCells.push({ x: x + 0.5, y: y + 0.5 });
  }
  return { world, known: new Uint8Array(n), searched: new Float32Array(n), frontier: new Uint8Array(n), hazard, survivorCells, dirty: [] };
}

/** Cells whose knowledge changed during the last createMockState call. */
export function drainMockDirty(): number[] {
  if (!cache) return [];
  const d = cache.dirty;
  cache.dirty = [];
  return d;
}

export function createMockState(world: World, t: number): SimState {
  if (!cache || cache.world !== world) cache = init(world);
  const c = cache;
  const { width, height } = world.meta;
  const bx = world.base.x + 0.5, by = world.base.y + 0.5;
  const radius = 4 + t * 1.6;
  const knownR = radius + 18;

  // Knowledge: expanding disc around the base (slightly lumpy), frontier ring at its edge.
  const r0 = Math.max(0, Math.floor(by - knownR - 2)), r1 = Math.min(height - 1, Math.ceil(by + knownR + 2));
  for (let y = r0; y <= r1; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const ang = Math.atan2(y - by, x - bx);
      const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by) * (1 + 0.18 * Math.sin(ang * 5 + 1.3));
      const known = d < knownR ? 1 : 0;
      const searched = Math.max(c.searched[i], Math.min(1, Math.max(0, (radius - d) / 6)));
      const frontier = world.terrain[i] !== Terrain.Water && d >= radius - 1 && d < radius + 0.6 ? 1 : 0;
      if (known !== c.known[i] || Math.abs(searched - c.searched[i]) > 0.01 || frontier !== c.frontier[i]) {
        c.known[i] = known;
        c.searched[i] = searched;
        c.frontier[i] = frontier;
        c.dirty.push(i);
      }
    }
  }

  const drones: DroneView[] = [];
  for (let id = 0; id < MOCK_CONFIG.droneCount; id++) {
    const orbit = radius * (0.5 + 0.12 * id) + 3;
    const w = (0.35 + id * 0.03) * (id % 2 ? 1 : -1) * (20 / Math.max(10, orbit));
    const pos = (tt: number) => ({
      x: Math.min(width - 1, Math.max(0, bx + Math.cos(tt * w + id * 1.05) * orbit)),
      y: Math.min(height - 1, Math.max(0, by + Math.sin(tt * w + id * 1.05) * orbit * 0.8)),
    });
    const disabled = id === 4 && t > 18;
    const at = disabled ? 18 : t;
    const p = pos(at);
    const ahead = pos(at + 0.05);
    const path = disabled ? [] : Array.from({ length: 24 }, (_, k) => pos(at + (k + 1) * 0.25));
    const trail = Array.from({ length: 80 }, (_, k) => pos(Math.max(0, at - (80 - k) * 0.12)));
    drones.push({
      id,
      x: p.x,
      y: p.y,
      heading: Math.atan2(ahead.y - p.y, ahead.x - p.x),
      status: disabled ? 'DISABLED' : id === 2 && (t % 30) > 24 ? 'RETURNING' : id === 5 ? 'TRAVELLING' : 'SEARCHING',
      battery: disabled ? 0.4 : 1 - ((t * 0.02 + id * 0.13) % 1),
      sensorRange: MOCK_CONFIG.sensorRange,
      path,
      trail,
      taskId: disabled ? null : id,
      distanceTravelled: t * 4,
    });
  }

  const tasks: TaskView[] = Array.from({ length: 7 }, (_, k) => {
    const a = k * 0.9 + 0.3;
    const cx = Math.round(bx + Math.cos(a) * (radius + 6)), cy = Math.round(by + Math.sin(a) * (radius + 6) * 0.8);
    const x0 = Math.max(0, Math.min(width - 10, cx - 5)), y0 = Math.max(0, Math.min(height - 10, cy - 5));
    const priority = 1 - k / 7;
    return {
      id: k,
      x0,
      y0,
      x1: x0 + 10,
      y1: y0 + 10,
      priority,
      breakdown: { population: 0.6 * priority, hazard: 0.4, information: 0.5 },
      assignedDrone: k < MOCK_CONFIG.droneCount && k !== 4 ? k : null,
      searchedFrac: 0.2,
      isFrontier: true,
    };
  });

  const impactT = MOCK_CONFIG.tsunamiImpactTime;
  const survivors: SurvivorView[] = c.survivorCells.map((s, id) => {
    const i = Math.floor(s.y) * width + Math.floor(s.x);
    const found = c.searched[i] > 0.6;
    const lost = !found && t > impactT && world.elevation[i] < MOCK_CONFIG.tsunamiRunupM;
    return { id, x: s.x, y: s.y, found, foundBy: found ? id % MOCK_CONFIG.droneCount : null, foundAt: found ? t : null, lost };
  });

  let land = 0, searchedSum = 0, popTotal = 0, popReached = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] === Terrain.Water) continue;
    land++;
    searchedSum += c.searched[i];
    popTotal += world.population[i];
    popReached += world.population[i] * c.searched[i];
  }
  const found = survivors.filter((s) => s.found).length;
  const lost = survivors.filter((s) => s.lost).length;

  return {
    time: t,
    running: true,
    config: MOCK_CONFIG,
    knowledge: { known: c.known, searched: c.searched, frontier: c.frontier, hazard: c.hazard },
    drones,
    tasks,
    survivors,
    flood: { timeToImpact: impactT - t, impacted: t >= impactT, runupM: MOCK_CONFIG.tsunamiRunupM },
    metrics: {
      time: t,
      areaSearchedFrac: searchedSum / Math.max(1, land),
      survivorsFound: found,
      survivorsTotal: survivors.length,
      survivorsLost: lost,
      populationReached: popReached,
      populationTotal: popTotal,
      droneUtilization: 0.82,
      redundancyFrac: 0.07 + 0.05 * Math.sin(t * 0.1),
      distanceTravelled: t * 4 * MOCK_CONFIG.droneCount,
      batteryConsumed: t * 0.02 * MOCK_CONFIG.droneCount,
      tasksCompleted: Math.floor(t / 6),
      tasksReassigned: t > 18 ? 1 : 0,
      droneFailures: t > 18 ? 1 : 0,
      complete: false,
    },
  };
}

/** Reset cached knowledge (e.g. when restarting the demo). */
export function resetMockState(): void {
  cache = null;
}
