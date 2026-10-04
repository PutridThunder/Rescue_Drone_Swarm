// Loads the satellite layers the Python pipeline writes for an area (eo.json + satellite.jpg)
// and applies them to the world: real population and land cover replace map-based estimates.

import type { EarthObservation, World } from "../types";
import { areaFile } from "./areas";

/** WorldCover land-cover codes the app uses. */
export const LandCover = { Trees: 10, Shrubland: 20, Grassland: 30, Cropland: 40, BuiltUp: 50, Bare: 60, Water: 80, Wetland: 90 } as const;

interface EoJSON {
  meta: { width: number; height: number; satellite?: string; sources: EarthObservation["sources"] };
  elevation: number[];
  landCover: number[];
  population: number[];
  ndwi: number[]; // percent
}

/** The area's satellite layers, or null if the pipeline hasn't been run for it. */
export async function loadEarthObservation(areaId: string, world: World): Promise<EarthObservation | null> {
  try {
    const res = await fetch(areaFile(areaId, "eo.json"));
    if (!res.ok) return null;
    const json = (await res.json()) as EoJSON;
    const n = world.meta.width * world.meta.height;
    if (json.meta.width !== world.meta.width || json.meta.height !== world.meta.height || json.population.length !== n) {
      console.warn("eo.json does not match the area grid; rebuild it with `npm run eo`");
      return null;
    }
    return {
      elevation: Float32Array.from(json.elevation),
      landCover: Uint8Array.from(json.landCover),
      population: Float32Array.from(json.population),
      ndwi: Float32Array.from(json.ndwi, (v) => v / 100),
      satelliteUrl: json.meta.satellite ? `/areas/${areaId}/${json.meta.satellite}` : null,
      sources: json.meta.sources,
    };
  } catch {
    return null;
  }
}

/**
 * Attach satellite layers to the world. The GHSL population map replaces the estimate from
 * building floor area (it is calibrated to census counts), so drones, crowd intel and the map
 * all use it.
 */
export function applyEarthObservation(world: World, eo: EarthObservation): World {
  return { ...world, population: eo.population, eo };
}
