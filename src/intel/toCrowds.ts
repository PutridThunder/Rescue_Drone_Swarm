// Converts intel hotspots (lat/lon, people) into simulation crowds (grid cells).

import type { CrowdOptions, World } from "../types";
import { latLonToGrid } from "../world/geo";
import type { Hotspot } from "./types";

const PEOPLE_PER_SURVIVOR = 250; // in the disaster scenario, roughly 1 in 250 people needs finding
const MAX_SURVIVORS = 5;
// Crowd disc radius in cells: grows with the square root of the crowd size, within limits.
const MIN_RADIUS = 2;
const MAX_RADIUS = 8;
const RADIUS_PER_SQRT_PERSON = 6;

export interface CrowdPlacement {
  x: number;
  y: number;
  opts: CrowdOptions;
}

export function hotspotsToCrowds(world: World, hotspots: Hotspot[]): CrowdPlacement[] {
  const { width, height } = world.meta;
  return hotspots
    .map((h) => ({
      ...latLonToGrid(world, h.lat, h.lon),
      opts: {
        people: h.people,
        radius: Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Math.sqrt(h.people) / RADIUS_PER_SQRT_PERSON)),
        survivors: Math.min(MAX_SURVIVORS, Math.max(1, Math.round(h.people / PEOPLE_PER_SURVIVOR))),
        source: "intel" as const,
        label: `${h.name} · ~${h.people.toLocaleString()}`,
      },
    }))
    .filter((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height);
}
