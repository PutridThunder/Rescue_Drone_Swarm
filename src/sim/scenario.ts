import type { InfoModes, SurvivorView, World } from "../types";
import type { Rng } from "./rng";

const WATER = 0;
const PARK = 3;

/** True tsunami hazard: low-lying (below 1.5 x run-up) and close to the coast. */
export function computeHazardTruth(world: World, runupM: number): Float32Array {
  const n = world.terrain.length;
  const out = new Float32Array(n);
  const elevScale = Math.max(1, runupM * 1.5);
  for (let i = 0; i < n; i++) {
    if (world.terrain[i] === WATER) continue;
    const elevF = clamp01(1 - world.elevation[i] / elevScale);
    const coastF = Math.exp(-world.coastDistance[i] / 30);
    out[i] = elevF * (0.35 + 0.65 * coastF);
  }
  return out;
}

/** Cells that flood on impact: elevation below run-up and connected (4-way) to open water. */
export function computeFloodMask(world: World, runupM: number): Uint8Array {
  const { width, height } = world.meta;
  const n = width * height;
  const mask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (world.terrain[i] === WATER) {
      mask[i] = 2;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    const visit = (j: number) => {
      if (mask[j] === 0 && world.elevation[j] < runupM) {
        mask[j] = 1;
        queue[tail++] = j;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
  }
  for (let i = 0; i < n; i++) if (mask[i] === 2) mask[i] = 0;
  return mask;
}

/**
 * The fleet's hazard estimate and predicted flood zone, given what it is allowed to know.
 * With elevation info it can use the true run-up model; without, only a coarse coastal belt.
 */
export function estimateHazard(
  world: World,
  info: InfoModes,
  hazardTruth: Float32Array,
  floodMask: Uint8Array,
  outHazard: Float32Array,
  outFloodProne: Uint8Array,
) {
  const n = world.terrain.length;
  for (let i = 0; i < n; i++) {
    if (world.terrain[i] === WATER) {
      outHazard[i] = 0;
      outFloodProne[i] = 0;
    } else if (info.elevation) {
      outHazard[i] = hazardTruth[i];
      outFloodProne[i] = floodMask[i];
    } else {
      const cd = world.coastDistance[i];
      outHazard[i] = 0.8 * Math.exp(-cd / 12);
      outFloodProne[i] = cd <= 12 ? 1 : 0;
    }
  }
}

/** Hidden ground-truth survivors: population-weighted, some hikers in parks, some clustered. */
export function sampleSurvivors(
  world: World,
  count: number,
  rng: Rng,
  hazardTruth: Float32Array | null,
  allowed?: Uint8Array, // cells a survivor may occupy (e.g. not deep inside high-rises)
): SurvivorView[] {
  const { width, height } = world.meta;
  const n = width * height;
  let popSum = 0;
  let land = 0;
  for (let i = 0; i < n; i++) {
    if (world.terrain[i] !== WATER) {
      popSum += world.population[i];
      land++;
    }
  }
  if (land === 0) return [];
  const meanPop = popSum > 0 ? popSum / land : 1;
  const cum = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const t = world.terrain[i];
    if (t !== WATER && (!allowed || allowed[i])) {
      let w = world.population[i] + meanPop * (t === PARK ? 0.25 : 0.04);
      if (hazardTruth) w *= 1 + 12 * hazardTruth[i]; // tsunami scenario: busy waterfront (Shipyards, Quay)
      acc += w;
    }
    cum[i] = acc;
  }

  const out: SurvivorView[] = [];
  for (let s = 0; s < count; s++) {
    let cell = -1;
    if (out.length > 0 && rng.next() < 0.25) {
      const anchor = out[rng.int(out.length)];
      for (let tries = 0; tries < 8 && cell < 0; tries++) {
        const x = Math.floor(anchor.x) + rng.int(5) - 2;
        const y = Math.floor(anchor.y) + rng.int(5) - 2;
        const j = y * width + x;
        if (
          x >= 0 &&
          y >= 0 &&
          x < width &&
          y < height &&
          world.terrain[j] !== WATER &&
          (!allowed || allowed[j])
        )
          cell = j;
      }
    }
    if (cell < 0) cell = lowerBound(cum, rng.next() * acc);
    const x = cell % width;
    const y = (cell - x) / width;
    out.push({
      id: s + 1,
      x: x + rng.range(0.2, 0.8),
      y: y + rng.range(0.2, 0.8),
      found: false,
      foundBy: null,
      foundAt: null,
      lost: false,
      placed: false,
    });
  }
  return out;
}

function lowerBound(arr: Float64Array, v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
