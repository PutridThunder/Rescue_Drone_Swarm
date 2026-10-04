import { AStar, lineOfSight, smoothPath } from "./astar";
import { DIRECT_FLIGHT_RANGE, ENTRY_ATTEMPTS, HAZARD_PATH_COST, SEARCHED_ENTRY_PENALTY, SEARCHED_THRESHOLD } from "./constants";
import type { SimContext } from "./context";
import type { Drone } from "./drone";
import type { Sector } from "./tasks";

/** Flight paths around known obstacles (A* plus string-pulling), with extra cost through hazards. */
export class Navigator {
  private readonly astar: AStar;
  private readonly hazardCostBuf: Float32Array;
  private hazardCost: Float32Array | null = null;

  constructor(private readonly ctx: SimContext) {
    this.astar = new AStar(ctx.W, ctx.H);
    this.hazardCostBuf = new Float32Array(ctx.N);
  }

  /** Known hazard per cell (null: no hazard intel). Hazard cells are allowed but cost more. */
  setHazard(hazard: Float32Array | null) {
    if (hazard) {
      for (let i = 0; i < this.ctx.N; i++) this.hazardCostBuf[i] = HAZARD_PATH_COST * hazard[i];
      this.hazardCost = this.hazardCostBuf;
    } else {
      this.hazardCost = null;
    }
  }

  /** Plan a path to the centre of cell (tx, ty). False if it can't be reached. */
  planPath(d: Drone, tx: number, ty: number): boolean {
    const { ctx } = this;
    const gx = tx + 0.5;
    const gy = ty + 0.5;
    const dist = Math.hypot(gx - d.x, gy - d.y);
    if ((!this.hazardCost || dist < DIRECT_FLIGHT_RANGE) && lineOfSight(d.x, d.y, gx, gy, ctx.navBlocked, ctx.W)) {
      d.path = [{ x: gx, y: gy }];
      return true;
    }
    const cells = this.astar.find(Math.floor(d.x), Math.floor(d.y), tx, ty, ctx.navBlocked, this.hazardCost);
    if (!cells) return false;
    d.path = smoothPath(cells, ctx.navBlocked, ctx.W);
    return true;
  }

  /** Path to the best entry cell of a block (nearest unsearched). False if none is reachable. */
  pathToSector(d: Drone, s: Sector): boolean {
    const { ctx } = this;
    const { searched } = ctx.knowledge;
    for (let attempt = 0; attempt < ENTRY_ATTEMPTS; attempt++) {
      let best = -1;
      let bestD = Infinity;
      ctx.sectors.forEachCoverageCell(s, (i, x, y) => {
        if (ctx.navBlocked[i] || ctx.unreachable[i]) return;
        const dist = Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) + (searched[i] >= SEARCHED_THRESHOLD ? SEARCHED_ENTRY_PENALTY : 0);
        if (dist < bestD) {
          bestD = dist;
          best = i;
        }
      });
      if (best < 0) return false;
      if (this.planPath(d, best % ctx.W, Math.floor(best / ctx.W))) return true;
      ctx.unreachable[best] = 1;
    }
    return true; // keep trying on later sub-steps
  }

  /** Path to land on the nearest truck. */
  pathToTruck(d: Drone) {
    const t = this.ctx.depot.nearest(d.x, d.y);
    if (!this.planPath(d, Math.floor(t.x), Math.floor(t.y))) d.path = [];
    d.path.push({ x: t.x, y: t.y });
  }

  /** A new obstacle was discovered: re-plan any path that now crosses one. */
  repathBlocked(drones: Drone[]) {
    const { navBlocked, W } = this.ctx;
    for (const d of drones) {
      if (!d.active || d.path.length === 0) continue;
      let px = d.x;
      let py = d.y;
      let blocked = false;
      for (const wp of d.path) {
        if (!lineOfSight(px, py, wp.x, wp.y, navBlocked, W)) {
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
}
