// A drone flown by a person (challenge mode): stick input instead of autonomy. It gets exactly
// what the autonomous drones get (speed, camera, battery, buildings it can't fly through) so a
// race against the algorithm is fair.

import { CHARGE_TIME, DOCK_DIST, HOVER_DRAIN } from "./constants";
import type { SimContext } from "./context";
import type { Drone } from "./drone";

const TURN_RATE = 2.4; // radians per second at full stick
const DOCK_RECHARGE_RANGE = DOCK_DIST * 2; // hover over a truck to recharge

export class ManualPilot {
  constructor(private readonly ctx: SimContext) {}

  update(d: Drone, dt: number) {
    const { ctx } = this;
    const { thrust, turn } = d.stick;
    if (d.dockedTruck !== null) {
      const t = ctx.depot.get(d.dockedTruck);
      d.x = t.x;
      d.y = t.y;
      if (thrust === 0 && turn === 0) return; // waiting on the truck for the pilot
      d.dockedTruck = null; // take off
    }

    d.heading += turn * TURN_RATE * dt;
    const step = Math.min(d.batteryCells, Math.max(-0.5, thrust) * ctx.cfg.speed * dt);
    const moved = this.move(d, Math.cos(d.heading) * step, Math.sin(d.heading) * step);
    d.distanceTravelled += moved;
    d.drain(moved + HOVER_DRAIN * dt);
    ctx.stats.batteryCells += moved + HOVER_DRAIN * dt;
    ctx.stats.activeTime += dt;

    const t = ctx.depot.nearest(d.x, d.y);
    if (Math.hypot(t.x - d.x, t.y - d.y) < DOCK_RECHARGE_RANGE) {
      d.batteryCells = Math.min(d.capacity, d.batteryCells + (d.capacity / CHARGE_TIME) * dt);
      d.battery = d.batteryCells / d.capacity;
    }

    const cell = Math.floor(d.y) * ctx.W + Math.floor(d.x);
    if (cell !== d.lastCell) {
      d.lastCell = cell;
      ctx.sensor.observe(d);
    }
  }

  /** Move, sliding along buildings too tall to overfly and the map edge. Returns distance moved. */
  private move(d: Drone, dx: number, dy: number): number {
    const x0 = d.x;
    const y0 = d.y;
    if (this.free(d.x + dx, d.y)) d.x += dx;
    if (this.free(d.x, d.y + dy)) d.y += dy;
    return Math.hypot(d.x - x0, d.y - y0);
  }

  private free(x: number, y: number): boolean {
    const { W, H, masks } = this.ctx;
    if (x < 0.5 || y < 0.5 || x > W - 0.5 || y > H - 0.5) return false;
    return !masks.tall[Math.floor(y) * W + Math.floor(x)];
  }
}
