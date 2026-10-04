import { DETOUR } from "./allocation";
import {
  ANNOUNCE_RECHARGE_BELOW,
  CHARGE_TIME,
  DOCK_DIST,
  DOCK_REPLAN_DELAY,
  FULL_BATTERY,
  HOVER_DRAIN,
  RECALL_BATTERY,
  RESERVE_BASE_CELLS,
  RESERVE_CAPACITY_SHARE,
  SEARCHED_THRESHOLD,
  LANE_SKIP_RADIUS,
  LANE_SPACING_SHARE,
  LANE_STEP,
  SWEEP_MIN_DIST,
  SWEEP_TURN_BASE,
  SWEEP_TURN_WEIGHT,
  TRUCK_DRIFT,
} from "./constants";
import type { SimContext } from "./context";
import type { Drone } from "./drone";
import { ManualPilot } from "./manualPilot";
import { messages } from "./messages";
import { planLanes } from "./sweepPlan";
import { insideSector, SECTOR_DONE, type Sector } from "./tasks";
import type { Truck } from "./truck";

/**
 * Flies each drone through its states: launch from a truck, travel to the assigned block, sweep
 * it, return to a truck when done or low on battery, land, recharge.
 */
export class DroneController {
  /** Battery kept in reserve for the flight home (cells). */
  private readonly reserve: number;
  private readonly manual: ManualPilot;

  constructor(private readonly ctx: SimContext) {
    this.manual = new ManualPilot(ctx);
    this.reserve = RESERVE_CAPACITY_SHARE * ctx.cfg.batteryCapacity + RESERVE_BASE_CELLS;
  }

  get batteryReserve(): number {
    return this.reserve;
  }

  update(d: Drone, dt: number) {
    if (!d.active) return;
    if (d.status === "MANUAL") {
      this.manual.update(d, dt);
      return;
    }
    const { ctx } = this;
    ctx.stats.activeTime += dt;
    if (d.status === "TRAVELLING" || d.status === "SEARCHING") ctx.stats.busyTime += dt;

    if (d.dockedTruck !== null && !d.charging && (d.status === "TRAVELLING" || d.status === "SEARCHING")) {
      d.dockedTruck = null; // take off for the assigned block
    }
    if (d.dockedTruck !== null) {
      this.rideAndCharge(d, ctx.depot.get(d.dockedTruck), dt);
      return;
    }

    if (d.status === "TRAVELLING" || d.status === "SEARCHING" || d.status === "IDLE") {
      const needed = ctx.depot.distanceToNearest(d.x, d.y) * DETOUR + this.reserve;
      if (d.battery < RECALL_BATTERY || d.batteryCells < needed) this.recallForCharge(d);
    }

    const moved = d.advance(ctx.cfg.speed * dt);
    const used = moved + HOVER_DRAIN * dt;
    d.drain(used);
    ctx.stats.batteryCells += used;

    const cell = Math.floor(d.y) * ctx.W + Math.floor(d.x);
    if (cell !== d.lastCell) {
      d.lastCell = cell;
      ctx.sensor.observe(d);
    }

    switch (d.status) {
      case "TRAVELLING": {
        const s = ctx.sectors.get(d.taskId!);
        if (insideSector(s, d.x, d.y)) {
          d.status = "SEARCHING";
          d.path = [];
        } else if (d.path.length === 0 && !ctx.nav.pathToSector(d, s)) {
          this.finishBlock(d, s, true);
        }
        break;
      }
      case "SEARCHING":
        if (d.path.length === 0) this.sweepNext(d);
        break;
      case "RETURNING":
      case "LOW_BATTERY": {
        const t = ctx.depot.nearest(d.x, d.y);
        if (Math.hypot(t.x - d.x, t.y - d.y) < DOCK_DIST) this.land(d, t);
        else if (d.path.length === 0 || this.truckMoved(d, t)) ctx.nav.pathToTruck(d);
        break;
      }
      case "IDLE":
        // Airborne with nothing to do: go land.
        d.status = "RETURNING";
        ctx.nav.pathToTruck(d);
        break;
    }
  }

  /** Hand the drone's block back to the fleet (it failed or must recharge). */
  releaseTask(d: Drone) {
    if (d.taskId == null) return;
    this.ctx.sectors.release(d.taskId, d.id, d.commitment);
    d.taskId = null;
    d.sweep = null;
  }

  /** Landed: ride along with the truck and charge if needed. */
  private rideAndCharge(d: Drone, t: Truck, dt: number) {
    d.x = t.x;
    d.y = t.y;
    d.heading = t.heading;
    if (!d.charging) return;
    d.batteryCells = Math.min(d.capacity, d.batteryCells + (d.capacity / CHARGE_TIME) * dt);
    d.battery = d.batteryCells / d.capacity;
    if (d.batteryCells < d.capacity) return;
    d.charging = false;
    d.status = "IDLE";
    if (d.chargeFrom < ANNOUNCE_RECHARGE_BELOW) this.ctx.log.emit("recharged", messages.recharged(d.id, t.id), d.id);
    this.ctx.replan.soon();
  }

  /** In-block sweep: fly the lawnmower lanes, then clean up whatever they left unsearched. */
  private sweepNext(d: Drone) {
    const s = this.ctx.sectors.get(d.taskId!);
    if (d.sweep?.sector !== s.id) {
      const spacing = Math.max(2, Math.round(this.ctx.cfg.sensorRange * LANE_SPACING_SHARE));
      d.sweep = { sector: s.id, waypoints: planLanes(s, d.x, d.y, spacing, LANE_STEP) };
    }
    if (!this.nextLaneWaypoint(d)) this.cleanupNext(d, s);
  }

  /** Head for the next lane waypoint that still has unsearched cells around it. */
  private nextLaneWaypoint(d: Drone): boolean {
    const { ctx } = this;
    const waypoints = d.sweep!.waypoints;
    while (waypoints.length > 0) {
      const { x, y } = waypoints.shift()!;
      const i = y * ctx.W + x;
      if (ctx.navBlocked[i] || ctx.unreachable[i] || !this.needsLook(x, y)) continue;
      if (Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) < SWEEP_MIN_DIST) continue;
      if (ctx.nav.planPath(d, x, y)) return true;
      ctx.unreachable[i] = 1;
    }
    return false;
  }

  /** True if any coverage cell near (x, y) is not yet searched. */
  private needsLook(x: number, y: number): boolean {
    const { ctx } = this;
    const r = LANE_SKIP_RADIUS;
    for (let yy = Math.max(0, y - r); yy <= Math.min(ctx.H - 1, y + r); yy++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(ctx.W - 1, x + r); xx++) {
        const i = yy * ctx.W + xx;
        if (ctx.knowledge.searched[i] < SEARCHED_THRESHOLD && ctx.countsForCoverage(i)) return true;
      }
    }
    return false;
  }

  /**
   * After the lanes: fly to the nearest unsearched cell, preferring to keep going straight.
   * Edge cells that the neighbouring block's (unsearched) sweep will cover anyway are left for
   * it: chasing them now is duplicate work (they were most of the clean-up flying).
   */
  private cleanupNext(d: Drone, s: Sector) {
    const { ctx } = this;
    const { searched } = ctx.knowledge;
    const hx = Math.cos(d.heading);
    const hy = Math.sin(d.heading);
    let believed = 0;
    let done = 0;
    let deferred = 0;
    let best = -1;
    let bestScore = Infinity;
    ctx.sectors.forEachCoverageCell(s, (i, x, y) => {
      believed++;
      if (searched[i] >= SEARCHED_THRESHOLD) {
        done++;
        return;
      }
      if (ctx.navBlocked[i] || ctx.unreachable[i]) return;
      if (this.neighbourWillCover(s, x, y)) {
        deferred++;
        return;
      }
      const dx = x + 0.5 - d.x;
      const dy = y + 0.5 - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < SWEEP_MIN_DIST) return;
      const cos = (dx * hx + dy * hy) / dist;
      const score = dist * (SWEEP_TURN_BASE - SWEEP_TURN_WEIGHT * cos);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const frac = believed > 0 ? done / believed : 1;
    if (frac < SECTOR_DONE && best < 0 && deferred > 0) {
      s.waiting = true; // the rest is on its edges: let the neighbours' sweeps finish it
      this.finishBlock(d, s, false);
      return;
    }
    if (frac >= SECTOR_DONE || best < 0) {
      this.finishBlock(d, s, frac < SECTOR_DONE && believed > 0);
      return;
    }
    if (!ctx.nav.planPath(d, best % ctx.W, Math.floor(best / ctx.W))) ctx.unreachable[best] = 1;
  }

  /** An edge cell whose neighbour across the block edge is still unsearched land. */
  private neighbourWillCover(s: Sector, x: number, y: number): boolean {
    const { ctx } = this;
    const across = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= ctx.W || ny >= ctx.H) return false;
      const j = ny * ctx.W + nx;
      return ctx.countsForCoverage(j) && !ctx.navBlocked[j] && ctx.knowledge.searched[j] < SEARCHED_THRESHOLD;
    };
    return (
      (x === s.x0 && across(x - 1, y)) ||
      (x === s.x1 - 1 && across(x + 1, y)) ||
      (y === s.y0 && across(x, y - 1)) ||
      (y === s.y1 - 1 && across(x, y + 1))
    );
  }

  /** Re-route when the truck we're flying to has moved away from our planned landing point. */
  private truckMoved(d: Drone, t: Truck): boolean {
    const end = d.path[d.path.length - 1];
    return !end || Math.hypot(end.x - t.x, end.y - t.y) > TRUCK_DRIFT;
  }

  private land(d: Drone, t: Truck) {
    d.path = [];
    d.x = t.x;
    d.y = t.y;
    d.dockedTruck = t.id;
    if (d.battery < FULL_BATTERY) {
      d.charging = true;
      d.chargeFrom = d.battery;
      d.status = "CHARGING";
    } else {
      d.status = "IDLE";
    }
    this.ctx.replan.soon(DOCK_REPLAN_DELAY);
  }

  private recallForCharge(d: Drone) {
    const { ctx } = this;
    const s = d.taskId != null ? ctx.sectors.get(d.taskId) : null;
    if (s) this.releaseTask(d);
    d.status = "LOW_BATTERY";
    ctx.nav.pathToTruck(d);
    const t = ctx.depot.nearest(d.x, d.y);
    ctx.log.emit("lowBattery", messages.lowBattery(d.id, Math.round(d.battery * 100), t.id, s?.view.label ?? null), d.id, s?.id);
    if (s) ctx.replan.request(`Drone ${d.id} recalled to recharge`);
  }

  /** Block done (or the rest is unreachable): free the drone for the next assignment. */
  private finishBlock(d: Drone, s: Sector, exhausted: boolean) {
    const { ctx } = this;
    if (exhausted) s.exhausted = true;
    // Neighbours left waiting for this block's sweep can now be re-checked.
    if (!s.waiting) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const n = ctx.sectors.at(s.cx + dx * (s.x1 - s.x0), s.cy + dy * (s.y1 - s.y0));
        if (n && n !== s) n.waiting = false;
      }
    }
    ctx.state.metrics.tasksCompleted++;
    const pct = Math.round(ctx.sectors.searchedFrac(s) * 100);
    ctx.log.emit("taskComplete", messages.blockFinished(d.id, s.view.label, pct, exhausted), d.id, s.id);
    s.view.assignedDrone = null;
    d.taskId = null;
    d.sweep = null;
    d.status = "IDLE";
    d.path = [];
    ctx.replan.soon(); // routine: the assignment events speak for themselves
  }
}
