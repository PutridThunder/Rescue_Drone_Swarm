// The search area the user draws: a circle in grid cells. Everything outside it is ignored by
// the fleet (no survivors placed there, not counted in coverage, never assigned).

export interface SearchArea {
  x: number; // centre, cells
  y: number;
  r: number; // radius, cells
}

/** 1 for cells whose centre is inside the circle; null when there is no search area. */
export function searchAreaMask(area: SearchArea | null, W: number, H: number): Uint8Array | null {
  if (!area) return null;
  const mask = new Uint8Array(W * H);
  const r2 = area.r * area.r;
  for (let y = Math.max(0, Math.floor(area.y - area.r)); y <= Math.min(H - 1, Math.ceil(area.y + area.r)); y++) {
    for (let x = Math.max(0, Math.floor(area.x - area.r)); x <= Math.min(W - 1, Math.ceil(area.x + area.r)); x++) {
      if ((x + 0.5 - area.x) ** 2 + (y + 0.5 - area.y) ** 2 <= r2) mask[y * W + x] = 1;
    }
  }
  return mask;
}
