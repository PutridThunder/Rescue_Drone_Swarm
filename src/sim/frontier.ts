import type { Knowledge } from "./knowledge";

export const FRONTIER_THRESHOLD = 0.5;
const WATER = 0;

/**
 * Frontier = unsearched, not-known-water cells bordering searched cells or the known/unknown boundary.
 * Full O(N) pass; called at the replan cadence (~0.2 ms on 36k cells). Returns the frontier size.
 */
export function updateFrontier(
  k: Knowledge,
  terrain: Uint8Array,
  width: number,
  height: number,
): number {
  const { searched, known, frontier } = k;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      let f = 0;
      if (
        searched[i] < FRONTIER_THRESHOLD &&
        !(known[i] && terrain[i] === WATER)
      ) {
        const kn = known[i];
        if (
          x > 0 &&
          (searched[i - 1] >= FRONTIER_THRESHOLD || known[i - 1] !== kn)
        )
          f = 1;
        else if (
          x < width - 1 &&
          (searched[i + 1] >= FRONTIER_THRESHOLD || known[i + 1] !== kn)
        )
          f = 1;
        else if (
          y > 0 &&
          (searched[i - width] >= FRONTIER_THRESHOLD || known[i - width] !== kn)
        )
          f = 1;
        else if (
          y < height - 1 &&
          (searched[i + width] >= FRONTIER_THRESHOLD || known[i + width] !== kn)
        )
          f = 1;
      }
      if (frontier[i] !== f) {
        frontier[i] = f;
        k.markDirty(i);
      }
      count += f;
    }
  }
  return count;
}
