// Converts intel hotspots (lat/lon, people) into simulation crowds (grid cells).

import type { CrowdOptions, World } from "../types";
import type { Hotspot } from "./types";

const PEOPLE_PER_SURVIVOR = 250; // in the disaster scenario, roughly 1 in 250 people needs finding
const MAX_SURVIVORS = 5;

export interface CrowdPlacement {
  x: number;
  y: number;
  opts: CrowdOptions;
}

export function hotspotsToCrowds(world: World, hotspots: Hotspot[]): CrowdPlacement[] {
  const [S, W, N, E] = world.meta.bbox;
  const { width, height } = world.meta;
  return hotspots
    .map((h) => ({
      x: ((h.lon - W) / (E - W)) * width,
      y: ((N - h.lat) / (N - S)) * height,
      opts: {
        people: h.people,
        radius: Math.min(8, Math.max(2, Math.sqrt(h.people) / 6)),
        survivors: Math.min(MAX_SURVIVORS, Math.max(1, Math.round(h.people / PEOPLE_PER_SURVIVOR))),
        source: "intel" as const,
        label: `${h.name} · ~${h.people.toLocaleString()}`,
      },
    }))
    .filter((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height);
}
