import type { Weights } from "../types";

export const DETOUR = 1.15;

export interface AllocDrone {
  id: number;
  x: number;
  y: number;
  battery: number; // cells of travel remaining
  task: number | null;
  commitment: number; // priority the drone committed to its current task with
}

export interface AllocTask {
  id: number;
  cx: number;
  cy: number;
  priority: number; // 0..1
  searchCost: number; // estimated cells of travel to sweep it
  released: boolean; // freed by a failed / recalled drone
}

export interface AllocParams {
  weights: Weights;
  diag: number;
  capacity: number;
  homes: { x: number; y: number }[]; // charging trucks
  hysteresis: number;
  releasedBonus: number;
  spread: number; // redundancy kernel radius, cells
  margin: number; // battery reserve, cells
  /**
   * Value-per-time scoring: a block's priority is divided by (1 + time to reach and sweep it /
   * this many cells of flight), i.e. survivors per second rather than survivors at any cost.
   * Omitted: the older linear distance penalty.
   */
  halfValueCells?: number;
  /** Other searchers the fleet doesn't direct (e.g. a piloted drone): blocks near them count as covered. */
  others?: { x: number; y: number }[];
}

export interface Assignment {
  droneId: number;
  taskId: number;
  utility: number;
  distance: number;
  distCost: number;
  battCost: number;
  redundancy: number;
}

/**
 * Greedy auction: repeatedly take the best (drone, task) pair by
 * utility = priority / (1 + flight / halfValueCells) - w.battery*battery - w.redundancy*redundancy
 * (+ hysteresis): survivors per second of flight. Without halfValueCells, the older
 * priority - w.distance*dist - ... form.
 * A drone's current task is valued at max(current priority, priority it committed with) plus a
 * hysteresis bonus, so drones finish sectors instead of chasing fresher neighbours.
 * After each pick, raise the redundancy of tasks near the one just assigned so the fleet spreads out.
 * Pairs whose round trip exceeds the drone's remaining battery are excluded.
 */
export function allocate(
  drones: AllocDrone[],
  tasks: AllocTask[],
  p: AllocParams,
): Assignment[] {
  const w = p.weights;
  const nT = tasks.length;
  const redundancy = new Float64Array(nT);
  const taken = new Uint8Array(nT);
  const backDist = tasks.map((t) => nearestHome(p.homes, t.cx, t.cy) * DETOUR);
  const remaining = drones.slice();
  const out: Assignment[] = [];
  const distScale = Math.max(1, 0.5 * p.diag);
  const twoSigma2 = 2 * p.spread * p.spread;
  for (const o of p.others ?? []) {
    tasks.forEach((t, ti) => (redundancy[ti] += Math.exp(-((t.cx - o.x) ** 2 + (t.cy - o.y) ** 2) / twoSigma2)));
  }

  while (remaining.length > 0) {
    let best: Assignment | null = null;
    let bestDrone = -1;
    let bestTask = -1;
    for (let di = 0; di < remaining.length; di++) {
      const d = remaining[di];
      for (let ti = 0; ti < nT; ti++) {
        if (taken[ti]) continue;
        const t = tasks[ti];
        const dist = Math.hypot(t.cx - d.x, t.cy - d.y);
        const need =
          dist * DETOUR + Math.min(t.searchCost, 30) + backDist[ti] + p.margin;
        if (need > d.battery) continue;
        const distCost = Math.min(1, dist / distScale);
        const battCost = Math.min(1, need / p.capacity);
        const red = Math.min(1, redundancy[ti]);
        const pri =
          d.task === t.id ? Math.max(t.priority, d.commitment) : t.priority;
        const flight = dist * DETOUR + Math.min(t.searchCost, 30);
        let u = p.halfValueCells
          ? pri / (1 + flight / p.halfValueCells) - w.battery * battCost - w.redundancy * red
          : pri - w.distance * distCost - w.battery * battCost - w.redundancy * red;
        if (d.task === t.id) u += p.hysteresis;
        else if (t.released) u += p.releasedBonus;
        if (!best || u > best.utility) {
          best = {
            droneId: d.id,
            taskId: t.id,
            utility: u,
            distance: dist,
            distCost,
            battCost,
            redundancy: red,
          };
          bestDrone = di;
          bestTask = ti;
        }
      }
    }
    if (!best) break;
    out.push(best);
    taken[bestTask] = 1;
    remaining.splice(bestDrone, 1);
    const a = tasks[bestTask];
    for (let ti = 0; ti < nT; ti++) {
      if (taken[ti]) continue;
      const t = tasks[ti];
      const d2 = (t.cx - a.cx) ** 2 + (t.cy - a.cy) ** 2;
      redundancy[ti] += Math.exp(-d2 / twoSigma2);
    }
  }
  return out;
}

export function nearestHome(
  homes: { x: number; y: number }[],
  x: number,
  y: number,
): number {
  let best = Infinity;
  for (const h of homes) best = Math.min(best, Math.hypot(h.x - x, h.y - y));
  return best;
}
