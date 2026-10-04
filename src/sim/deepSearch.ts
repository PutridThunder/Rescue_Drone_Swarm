import type { Knowledge } from "./knowledge";
import type { Scenario, SimConfig, Weights, World } from "../types";

export interface DeepSearchInput {
  world: World;
  knowledge: Knowledge;
  scenario: Scenario;
  coastalTarget?: boolean;
  timePressure?: number;
}

export interface DeepSearchModel {
  coordinates: [number, number];
  scenario: string;
  weights: {
    population: number;
    hazard: number;
    urgency: number;
    unsearched_area: number;
    distance_cost: number;
    battery_cost: number;
    avoid_overlap: number;
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function avg(values: Float32Array | Uint8Array): number {
  if (!values.length) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total / values.length;
}

function maxValue(values: Float32Array | Uint8Array): number {
  if (!values.length) return 0;
  let max = 0;
  for (let i = 0; i < values.length; i++) max = Math.max(max, values[i]);
  return max;
}

function inferSceneLabel(world: World, scenario: Scenario): string {
  const isCoastal = world.coastDistance.some((d) => d < 40);
  if (scenario === "tsunami" || isCoastal) return "coastal warning and urgent survivor rescue";
  return "urban search and rescue with dynamic area coverage priorities";
}

function inferCoordinates(world: World): [number, number] {
  const { bbox } = world.meta;
  const [south, west, north, east] = bbox;
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  return [lat, lon];
}

function detectCoastalTarget(world: World, scenario: Scenario): boolean {
  const coastalCells = world.coastDistance.filter((d) => d < 40).length;
  if (scenario === "tsunami") return coastalCells > 0;
  return coastalCells > world.coastDistance.length * 0.08;
}

function estimatePopulationWeight(world: World, knowledge: Knowledge): number {
  const populationMax = maxValue(world.population);
  const populationMean = avg(world.population) / Math.max(1, populationMax);
  const searchedFrac = avg(knowledge.searched);
  const remainingPressure = clamp01((1 - searchedFrac) * 0.7 + populationMean * 0.7);
  return clamp01(0.3 + remainingPressure * 0.9);
}

function estimateHazardWeight(world: World, knowledge: Knowledge, scenario: Scenario, coastalTarget: boolean): number {
  const coastalRisk = clamp01(1 - avg(world.coastDistance) / Math.max(1, world.coastDistance.length));
  const hazardSignal = knowledge.view.hazard !== null ? clamp01(avg(knowledge.hazardBuf) / 1.2) : 0;
  const disasterBoost = scenario === "tsunami" ? 0.35 : coastalTarget ? 0.2 : 0.12;
  return clamp01((coastalRisk * 0.55) + (hazardSignal * 0.3) + disasterBoost);
}

function estimateUrgencyWeight(world: World, scenario: Scenario, coastalTarget: boolean, timePressure = 0.5): number {
  const coastalBias = coastalTarget ? 0.4 : 0.15;
  const disasterBias = scenario === "tsunami" ? 0.35 : 0.2;
  return clamp01((coastalBias + disasterBias + timePressure * 0.35) * 0.9);
}

function estimateUnsearchedAreaWeight(knowledge: Knowledge): number {
  const searchedFrac = avg(knowledge.searched);
  return clamp01(0.35 + (1 - searchedFrac) * 0.9);
}

function estimateDistanceCostWeight(world: World): number {
  const baseX = Math.max(0, Math.min(world.meta.width - 1, world.base.x));
  const baseY = Math.max(0, Math.min(world.meta.height - 1, world.base.y));
  const sizeFactor = Math.hypot(world.meta.width, world.meta.height) / 400;
  const centerDistance = Math.hypot(baseX - world.meta.width / 2, baseY - world.meta.height / 2) / Math.max(1, world.meta.width);
  return clamp01(0.2 + centerDistance * 0.8 + (sizeFactor - 1) * 0.15);
}

function estimateBatteryCostWeight(world: World): number {
  const terrainComplexity = avg(world.obstacleHeight);
  const elevationVariance = Math.max(0, avg(world.elevation) / 50);
  const cost = clamp01((terrainComplexity / 18) * 0.6 + elevationVariance * 0.4);
  return clamp01(0.25 + cost * 0.9);
}

function estimateOverlapWeight(knowledge: Knowledge): number {
  const searchedFrac = avg(knowledge.searched);
  const frontierBias = avg(knowledge.frontier);
  return clamp01(0.2 + (1 - searchedFrac) * 0.35 + frontierBias * 0.45);
}

export function buildDeepSearchModel(input: DeepSearchInput): DeepSearchModel {
  const { world, knowledge, scenario } = input;
  const coastalTarget = input.coastalTarget ?? detectCoastalTarget(world, scenario);
  const timePressure = clamp01(input.timePressure ?? 0.5);
  const weights = {
    population: estimatePopulationWeight(world, knowledge),
    hazard: estimateHazardWeight(world, knowledge, scenario, coastalTarget),
    urgency: estimateUrgencyWeight(world, scenario, coastalTarget, timePressure),
    unsearched_area: estimateUnsearchedAreaWeight(knowledge),
    distance_cost: estimateDistanceCostWeight(world),
    battery_cost: estimateBatteryCostWeight(world),
    avoid_overlap: estimateOverlapWeight(knowledge),
  };
  return {
    coordinates: inferCoordinates(world),
    scenario: inferSceneLabel(world, scenario),
    weights: {
      population: Number(weights.population.toFixed(1)),
      hazard: Number(weights.hazard.toFixed(1)),
      urgency: Number(weights.urgency.toFixed(1)),
      unsearched_area: Number(weights.unsearched_area.toFixed(1)),
      distance_cost: Number(weights.distance_cost.toFixed(1)),
      battery_cost: Number(weights.battery_cost.toFixed(1)),
      avoid_overlap: Number(weights.avoid_overlap.toFixed(1)),
    },
  };
}

export function computeDeepSearchWeights(input: DeepSearchInput): Weights {
  const model = buildDeepSearchModel(input);
  return {
    population: model.weights.population,
    hazard: model.weights.hazard,
    urgency: model.weights.urgency,
    information: model.weights.unsearched_area,
    distance: model.weights.distance_cost,
    battery: model.weights.battery_cost,
    redundancy: model.weights.avoid_overlap,
  };
}

export function applyDeepSearchWeights(config: SimConfig, world: World, knowledge: Knowledge): Weights {
  const next = computeDeepSearchWeights({
    world,
    knowledge,
    scenario: config.scenario,
    coastalTarget: detectCoastalTarget(world, config.scenario),
    timePressure: config.scenario === "tsunami" ? 0.9 : 0.6,
  });
  return next;
}
