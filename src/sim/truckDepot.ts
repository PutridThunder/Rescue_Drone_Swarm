import { Terrain } from "../shared/terrain";
import type { TaskView } from "../types";
import { nearestHome } from "./allocation";
import { AStar } from "./astar";
import {
  ACTIVE_BLOCK_WEIGHT,
  KMEANS_ITERATIONS,
  PRIORITY_PULL_ABOVE,
  TRUCK_MOVE_MIN,
  TRUCK_REPLAN,
  TRUCK_SPACING,
  TRUCK_SPEED_FRAC,
} from "./constants";
import type { SimContext } from "./context";
import { cellCentre, type Point } from "./grid";
import { messages } from "./messages";
import { Truck } from "./truck";

/** Charging trucks: where they start, driving on the road network, and moving toward the work. */
export class TruckDepot {
  readonly trucks: Truck[];
  /** Cells trucks may drive on (the road network connected to the staging area). */
  private readonly offRoad: Uint8Array;
  private readonly roadCells: number[] = [];
  private readonly astar: AStar;
  private timer = 0;

  constructor(private readonly ctx: SimContext) {
    this.offRoad = new Uint8Array(ctx.N).fill(1);
    this.astar = new AStar(ctx.W, ctx.H);
    this.trucks = this.spawn(Math.max(1, ctx.cfg.truckCount));
  }

  get(id: number): Truck {
    return this.trucks[id - 1];
  }

  nearest(x: number, y: number): Truck {
    let best = this.trucks[0];
    let bestD = Infinity;
    for (const t of this.trucks) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  distanceToNearest(x: number, y: number): number {
    return nearestHome(this.trucks, x, y);
  }

  /** Drive trucks along their routes. A truck waits while a low-battery drone is flying to it. */
  drive(dt: number) {
    const step = this.ctx.cfg.speed * TRUCK_SPEED_FRAC * dt;
    const awaited = new Set<Truck>();
    for (const d of this.ctx.fleet) if (d.airborne && d.status === "LOW_BATTERY") awaited.add(this.nearest(d.x, d.y));
    for (const t of this.trucks) if (!awaited.has(t)) t.advance(step);
  }

  /** Reposition trucks every TRUCK_REPLAN seconds. */
  tick(dt: number) {
    this.timer -= dt;
    if (this.timer <= 0) this.reposition(this.ctx.state.tasks);
  }

  /** Park every truck where it is (mission over). */
  parkAll() {
    for (const t of this.trucks) {
      t.path = [];
      t.status = "PARKED";
    }
  }

  /** Trucks start near the staging area on the connected road network, spaced apart. */
  private spawn(count: number): Truck[] {
    const { ctx } = this;
    const { terrain } = ctx.world;
    const { W, N } = ctx;
    const base = { x: ctx.world.base.x + 0.5, y: ctx.world.base.y + 0.5 };
    let start = -1;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      if (terrain[i] !== Terrain.Road) continue;
      const c = cellCentre(i, W);
      const d = (c.x - base.x) ** 2 + (c.y - base.y) ** 2;
      if (d < bestD) {
        bestD = d;
        start = i;
      }
    }
    const trucks: Truck[] = [];
    if (start < 0) {
      // No roads (synthetic worlds): trucks can park anywhere on open land.
      for (let i = 0; i < N; i++) {
        if (terrain[i] !== Terrain.Water && !ctx.masks.tall[i]) {
          this.offRoad[i] = 0;
          this.roadCells.push(i);
        }
      }
      for (let k = 0; k < count; k++) trucks.push(new Truck(k + 1, base.x, base.y));
      return trucks;
    }
    // Breadth-first over 4-connected road cells: the order is road distance from staging.
    const order: number[] = [start];
    this.offRoad[start] = 0;
    for (let q = 0; q < order.length; q++) {
      const i = order[q];
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || !this.offRoad[j] || terrain[j] !== Terrain.Road) continue;
        this.offRoad[j] = 0;
        order.push(j);
      }
    }
    this.roadCells.push(...order);
    for (let k = 0; k < count; k++) {
      const c = cellCentre(order[Math.min(order.length - 1, k * TRUCK_SPACING)], W);
      trucks.push(new Truck(k + 1, c.x, c.y));
    }
    return trucks;
  }

  /**
   * Move trucks toward where the work is: weighted k-means over the busy and high-priority
   * blocks, snapped to the road network, so drones spend less battery commuting.
   */
  private reposition(tasks: TaskView[]) {
    const { ctx } = this;
    this.timer = TRUCK_REPLAN;
    if (tasks.length === 0 || this.roadCells.length === 0) return;
    const points: WeightedPoint[] = [];
    for (const t of tasks) {
      const w = t.assignedDrone != null ? ACTIVE_BLOCK_WEIGHT : t.priority > PRIORITY_PULL_ABOVE ? t.priority : 0;
      if (w > 0) points.push({ x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2, w });
    }
    if (points.length === 0) return;
    const centres = weightedKMeans(points, this.trucks.map((t) => ({ x: t.x, y: t.y })), KMEANS_ITERATIONS);

    this.trucks.forEach((t, k) => {
      const target = this.nearestRoadCell(centres[k]);
      const tx = target % ctx.W;
      const ty = Math.floor(target / ctx.W);
      const from = t.goal ?? t;
      if (Math.hypot(tx + 0.5 - from.x, ty + 0.5 - from.y) < TRUCK_MOVE_MIN) return;
      const cells = this.astar.find(Math.floor(t.x), Math.floor(t.y), tx, ty, this.offRoad, null);
      if (!cells || cells.length < 2) return;
      t.path = cells.map((c) => cellCentre(c, ctx.W));
      t.goal = { x: tx + 0.5, y: ty + 0.5 };
      t.status = "DRIVING";
      const place = ctx.sectors.at(tx, ty).view.label;
      ctx.log.emit("truck", messages.truckMoving(t.id, cells.length, ctx.world.meta.cellSizeM, place));
    });
  }

  private nearestRoadCell(p: Point): number {
    let best = this.roadCells[0];
    let bestD = Infinity;
    for (const i of this.roadCells) {
      const c = cellCentre(i, this.ctx.W);
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}

export interface WeightedPoint extends Point {
  w: number;
}

/** Lloyd's k-means with point weights, starting from `seeds` (one centre per seed). */
export function weightedKMeans(points: WeightedPoint[], seeds: Point[], iterations: number): Point[] {
  const centres = seeds.map((s) => ({ ...s }));
  for (let iter = 0; iter < iterations; iter++) {
    const sx = centres.map(() => 0);
    const sy = centres.map(() => 0);
    const sw = centres.map(() => 0);
    for (const p of points) {
      let k = 0;
      let bestD = Infinity;
      centres.forEach((c, ci) => {
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          k = ci;
        }
      });
      sx[k] += p.x * p.w;
      sy[k] += p.y * p.w;
      sw[k] += p.w;
    }
    centres.forEach((c, ci) => {
      if (sw[ci] > 0) {
        c.x = sx[ci] / sw[ci];
        c.y = sy[ci] / sw[ci];
      }
    });
  }
  return centres;
}
