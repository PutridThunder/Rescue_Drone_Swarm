import { DETOUR } from "./allocation";
import {
  ANNOUNCE_RECHARGE_BELOW,
  CHARGE_TIME,
  DOCK_DIST,
  DOCK_REPLAN_DELAY,
  FULL_BATTERY,
  HOVER_DRAIN,
  RESERVE_BASE_CELLS,
  RESERVE_CAPACITY_SHARE,
  SEARCHED_THRESHOLD,
  SWEEP_MIN_DIST,
  SWEEP_TURN_BASE,
  SWEEP_TURN_WEIGHT,
  TRUCK_DRIFT,
} from "./constants";
import type { SimContext } from "./context";
import type { Drone } from "./drone";
import { messages } from "./messages";
import { insideSector, SECTOR_DONE, type Sector } from "./tasks";
import type { Truck } from "./truck";

/**
 * Flies each drone through its states: launch from a truck, travel to the assigned block, sweep
 * it, return to a truck when done or low on battery, land, recharge.
 */
export class DroneController {
  /** Battery kept in reserve for the flight home (cells). */
  private readonly reserve: number;

  constructor(private readonly ctx: SimContext) {
    this.reserve = RESERVE_CAPACITY_SHARE * ctx.cfg.batteryCapacity + RESERVE_BASE_CELLS;
  }

  get batteryReserve(): number {
    return this.reserve;
  }

  update(d: Drone, dt: number) {
    if (!d.active) return;
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
      if (d.batteryCells < ctx.depot.distanceToNearest(d.x, d.y) * DETOUR + this.reserve) this.recallForCharge(d);
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

  /** In-block sweep: fly to the nearest unsearched cell, preferring to keep going straight. */
  private sweepNext(d: Drone) {
    const { ctx } = this;
    const s = ctx.sectors.get(d.taskId!);
    const { searched } = ctx.knowledge;
    const hx = Math.cos(d.heading);
    const hy = Math.sin(d.heading);
    let believed = 0;
    let done = 0;
    let best = -1;
    let bestScore = Infinity;
    ctx.sectors.forEachCoverageCell(s, (i, x, y) => {
      believed++;
      if (searched[i] >= SEARCHED_THRESHOLD) {
        done++;
        return;
      }
      if (ctx.navBlocked[i] || ctx.unreachable[i]) return;
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
    if (frac >= SECTOR_DONE || best < 0) {
      this.finishBlock(d, s, frac < SECTOR_DONE && believed > 0);
      return;
    }
    if (!ctx.nav.planPath(d, best % ctx.W, Math.floor(best / ctx.W))) ctx.unreachable[best] = 1;
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
    ctx.state.metrics.tasksCompleted++;
    const pct = Math.round(ctx.sectors.searchedFrac(s) * 100);
    ctx.log.emit("taskComplete", messages.blockFinished(d.id, s.view.label, pct, exhausted), d.id, s.id);
    s.view.assignedDrone = null;
    d.taskId = null;
    d.status = "IDLE";
    d.path = [];
    ctx.replan.soon(); // routine: the assignment events speak for themselves
  }
}
