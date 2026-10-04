// Converting between grid cells and latitude/longitude, and finding street names.

import type { World } from "../types";

export function gridToLatLon(world: World, x: number, y: number): { lat: number; lon: number } {
  const [S, W, N, E] = world.meta.bbox;
  return { lat: N - (y / world.meta.height) * (N - S), lon: W + (x / world.meta.width) * (E - W) };
}

export function latLonToGrid(world: World, lat: number, lon: number): { x: number; y: number } {
  const [S, W, N, E] = world.meta.bbox;
  return { x: ((lon - W) / (E - W)) * world.meta.width, y: ((N - lat) / (N - S)) * world.meta.height };
}

/** Name of the nearest street within `radius` cells, or null. */
export function streetNear(world: World, x: number, y: number, radius = 5): string | null {
  const { width, height } = world.meta;
  let best: string | null = null;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = Math.floor(x) + dx;
      const cy = Math.floor(y) + dy;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const n = world.roadName[cy * width + cx];
      const d = dx * dx + dy * dy;
      if (n >= 0 && d < bestD) {
        bestD = d;
        best = world.roadNames[n];
      }
    }
  }
  return best;
}
