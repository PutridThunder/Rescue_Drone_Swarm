import type { MapJSON, World, WorldJSON } from "../types";
import { computeCoastDistance, generateProceduralWorld } from "./procedural";

export { computeCoastDistance, generateProceduralWorld };

export function worldFromJSON(json: WorldJSON): World {
  const { width, height } = json.meta;
  const n = width * height;
  if (json.terrain.length !== n || json.elevation.length !== n)
    throw new Error("world.json: array size mismatch");
  const world: World = {
    meta: json.meta,
    terrain: Uint8Array.from(json.terrain),
    elevation: Float32Array.from(json.elevation),
    buildingHeight: Float32Array.from(json.buildingHeight),
    population: Float32Array.from(json.population),
    coastDistance: new Float32Array(n),
    base: json.base,
    roadName: json.roadName
      ? Int16Array.from(json.roadName)
      : new Int16Array(n).fill(-1),
    roadNames: json.roadNames ?? [],
  };
  computeCoastDistance(world);
  return world;
}

/** Load public/world.json; falls back to a procedural world on any failure. */
export async function loadWorld(
  url = "/world.json",
  fallbackSeed = 1,
): Promise<World> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return worldFromJSON((await res.json()) as WorldJSON);
  } catch (err) {
    console.warn(
      `loadWorld: falling back to procedural world (${(err as Error).message})`,
    );
    return generateProceduralWorld(fallbackSeed);
  }
}

/** Load public/map.json (vector footprints and roads for rendering); null if unavailable. */
export async function loadMap(url = "/map.json"): Promise<MapJSON | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as MapJSON;
  } catch (err) {
    console.warn(`loadMap: no vector map (${(err as Error).message})`);
    return null;
  }
}
