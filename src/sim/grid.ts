// Grid helpers: cell indexing and the obstacle masks derived from building heights.
import type { World } from "../types";
import { ROOF_CLEARANCE_M } from "./constants";

export interface Point {
  x: number;
  y: number;
}

/** Centre of cell `i` in grid coordinates. */
export function cellCentre(i: number, width: number): Point {
  return { x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 };
}

/** Index of the cell containing (x, y), or -1 outside the grid. */
export function cellIndex(x: number, y: number, width: number, height: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return cx < 0 || cy < 0 || cx >= width || cy >= height ? -1 : cy * width + cx;
}

export interface ObstacleMasks {
  /** Cells drones cannot fly over: buildings within ROOF_CLEARANCE_M of flight altitude. */
  tall: Uint8Array;
  /** Cells no sensor can see (enclosed inside high-rises): excluded from coverage like water. */
  hidden: Uint8Array;
}

export function buildObstacleMasks(world: World, flightAltitudeM: number): ObstacleMasks {
  const { width: W, height: H } = world.meta;
  const N = W * H;
  const tall = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (world.obstacleHeight[i] > flightAltitudeM - ROOF_CLEARANCE_M) tall[i] = 1;

  const hidden = new Uint8Array(N);
  const open = (j: number, inGrid: boolean) => inGrid && !tall[j];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!tall[i]) continue;
      const exposed = open(i - 1, x > 0) || open(i + 1, x < W - 1) || open(i - W, y > 0) || open(i + W, y < H - 1);
      if (!exposed) hidden[i] = 1;
    }
  }
  return { tall, hidden };
}
