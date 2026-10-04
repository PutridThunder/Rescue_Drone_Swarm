// DeepSearch client: asks the server (api/deepsearch.ts -> Gemini with web search) how to
// weight the mission, and converts the answer into the planner's priority weights.
// Online and optional: the simulation itself never calls it. Answers are cached in the browser
// for an hour, so asking the same thing again costs no tokens.

import type { DeepSearchRequest, DeepSearchResult, DeepSearchWeightKey } from "../../api/deepsearch";
import { DEFAULT_WEIGHTS } from "../sim/defaults";
import type { Weights } from "../types";

export type { DeepSearchRequest, DeepSearchResult };

/** DeepSearch factor -> planner weight. */
export const WEIGHT_FOR: Record<DeepSearchWeightKey, keyof Weights> = {
  population: "population",
  hazard: "hazard",
  urgency: "urgency",
  unsearched_area: "information",
  distance_cost: "distance",
  battery_cost: "battery",
  avoid_overlap: "redundancy",
};

export const FACTOR_LABEL: Record<DeepSearchWeightKey, string> = {
  population: "Population",
  hazard: "Hazard",
  urgency: "Urgency",
  unsearched_area: "Unsearched area",
  distance_cost: "Distance cost",
  battery_cost: "Battery cost",
  avoid_overlap: "Avoid overlap",
};

/**
 * DeepSearch weights are 0..1 with 0.5 = normal. The planner's weights have their own scales
 * (urgency 3, distance 0.8...), so 0.5 maps to the tuned default, 1.0 to twice it, 0 to off.
 */
export function toPlannerWeights(w: DeepSearchResult["weights"]): Weights {
  const out = { ...DEFAULT_WEIGHTS };
  for (const [factor, key] of Object.entries(WEIGHT_FOR) as [DeepSearchWeightKey, keyof Weights][]) {
    out[key] = Math.round(DEFAULT_WEIGHTS[key] * (w[factor] / 0.5) * 100) / 100;
  }
  return out;
}

const CACHE_TTL_MS = 60 * 60_000; // same question within an hour: no new Gemini call
const CACHE_PREFIX = "deepsearch:";

export async function requestDeepSearch(input: DeepSearchRequest): Promise<DeepSearchResult> {
  const key = CACHE_PREFIX + JSON.stringify(input);
  const saved = readCache(key);
  if (saved) return { ...saved, tokens: null, cached: true };
  const result = await fetchDeepSearch(input);
  writeCache(key, result);
  return result;
}

async function fetchDeepSearch(input: DeepSearchRequest): Promise<DeepSearchResult> {
  let res: Response;
  try {
    res = await fetch("/api/deepsearch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  } catch {
    throw new Error("No connection: DeepSearch needs the internet.");
  }
  const body = (await res.json().catch(() => ({}))) as DeepSearchResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? (res.status === 404 ? "DeepSearch isn't available on this server." : `HTTP ${res.status}`));
  return body;
}

function readCache(key: string): DeepSearchResult | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, result } = JSON.parse(raw) as { at: number; result: DeepSearchResult };
    return Date.now() - at < CACHE_TTL_MS ? result : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, result: DeepSearchResult) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), result }));
  } catch {
    // storage full or blocked: caching is only a saving
  }
}
