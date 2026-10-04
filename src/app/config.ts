// Rules for changing the mission config, kept in one place.

import { Terrain } from "../shared/terrain";
import type { Scenario, SimConfig, World } from "../types";

/** Switching scenario also switches hazard intel (a tsunami warning comes with a flood map). */
export function withScenario(config: SimConfig, scenario: Scenario): SimConfig {
  const tsunami = scenario === "tsunami";
  return { ...config, scenario, info: { ...config.info, disaster: tsunami, elevation: tsunami } };
}

const MIN_WATER_SHARE = 0.02;

/** Tsunami only makes sense where the map has a coastline. */
export function hasCoastline(world: World): boolean {
  let water = 0;
  for (const t of world.terrain) if (t === Terrain.Water) water++;
  return water / world.terrain.length > MIN_WATER_SHARE;
}
