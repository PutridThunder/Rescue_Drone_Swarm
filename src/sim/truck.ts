import type { TruckStatus, TruckView } from "../types";

/** Ground charging vehicle: drives on roads, launches and recharges drones. */
export class Truck implements TruckView {
  heading = 0;
  status: TruckStatus = "PARKED";
  path: { x: number; y: number }[] = [];
  /** Where the truck is heading (cell centre), for re-routing decisions. */
  goal: { x: number; y: number } | null = null;

  constructor(
    readonly id: number,
    public x: number,
    public y: number,
  ) {}

  advance(budget: number): number {
    let moved = 0;
    while (budget > 1e-9 && this.path.length > 0) {
      const wp = this.path[0];
      const dx = wp.x - this.x;
      const dy = wp.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) {
        this.path.shift();
        continue;
      }
      this.heading = Math.atan2(dy, dx);
      const step = Math.min(dist, budget);
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      moved += step;
      budget -= step;
      if (step === dist) this.path.shift();
    }
    if (this.path.length === 0) {
      this.status = "PARKED";
      this.goal = null;
    }
    return moved;
  }
}
