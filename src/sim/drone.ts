import type { DroneStatus, DroneView } from "../types";
import type { Waypoint } from "./sweepPlan";

export const TRAIL_MAX = 300;

export class Drone implements DroneView {
  heading = 0;
  status: DroneStatus = "IDLE";
  battery = 1;
  path: { x: number; y: number }[] = [];
  trail: { x: number; y: number }[] = [];
  taskId: number | null = null;
  distanceTravelled = 0;
  dockedTruck: number | null = null;

  batteryCells: number;
  charging = false;
  commitment = 0;
  chargeFrom = 1; // battery fraction when charging started
  lastCell = -1;
  cellsSearched = 0;
  /** Pilot input for a MANUAL drone: thrust -1..1 (forward), turn -1..1 (clockwise on the map). */
  stick = { thrust: 0, turn: 0 };
  /** Remaining lawnmower waypoints through the current block. */
  sweep: { sector: number; waypoints: Waypoint[]; hasty?: boolean } | null = null;
  private trailAcc = 0;

  constructor(
    readonly id: number,
    public x: number,
    public y: number,
    public sensorRange: number,
    readonly capacity: number,
  ) {
    this.batteryCells = capacity;
    this.trail.push({ x, y });
  }

  get active(): boolean {
    return this.status !== "DISABLED";
  }

  drain(cells: number) {
    this.batteryCells = Math.max(0, this.batteryCells - cells);
    this.battery = this.batteryCells / this.capacity;
  }

  get airborne(): boolean {
    return this.active && this.dockedTruck === null;
  }

  /** Move along the waypoint list by up to `budget` cells. Returns distance moved. */
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
      if (dist <= budget) {
        this.x = wp.x;
        this.y = wp.y;
        this.path.shift();
        budget -= dist;
        moved += dist;
      } else {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        moved += budget;
        budget = 0;
      }
    }
    if (moved > 0) {
      this.distanceTravelled += moved;
      this.trailAcc += moved;
      if (this.trailAcc >= 1) {
        this.trailAcc = 0;
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > TRAIL_MAX) this.trail.shift();
      }
    }
    return moved;
  }
}
