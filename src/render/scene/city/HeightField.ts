// Terrain and roof heights in world units, sampled at fractional grid coordinates.
// World units: 1 unit = 1 grid cell horizontally, with heights at the same true scale.

import type { World } from "../../../types";

export class HeightField {
  readonly W: number;
  readonly H: number;
  /** Metres per world unit (the grid cell size). */
  readonly metresPerUnit: number;

  constructor(private readonly world: World) {
    this.W = world.meta.width;
    this.H = world.meta.height;
    this.metresPerUnit = world.meta.cellSizeM;
  }

  /** Ground height, bilinear over cell centres. */
  groundAt(x: number, y: number): number {
    const { W, H } = this;
    const fx = Math.min(W - 1, Math.max(0, x - 0.5));
    const fy = Math.min(H - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const ux = fx - x0;
    const uy = fy - y0;
    const e = this.world.elevation;
    const h = e[y0 * W + x0] * (1 - ux) * (1 - uy) + e[y0 * W + x1] * ux * (1 - uy) + e[y1 * W + x0] * (1 - ux) * uy + e[y1 * W + x1] * ux * uy;
    return h / this.metresPerUnit;
  }

  /** Top of whatever is at this spot (roof or ground). */
  surfaceAt(x: number, y: number): number {
    const i = Math.floor(y) * this.W + Math.floor(x);
    return this.groundAt(x, y) + (this.world.buildingHeight[i] ?? 0) / this.metresPerUnit;
  }

  /** Convert metres to world units. */
  units(metres: number): number {
    return metres / this.metresPerUnit;
  }
}
