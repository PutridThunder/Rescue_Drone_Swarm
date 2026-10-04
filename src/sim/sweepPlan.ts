// Lawnmower ("boustrophedon") route through a block: parallel lanes spaced so the camera
// swaths overlap slightly, flown back and forth, starting from the corner nearest the drone.
// Systematic lanes leave far fewer slivers behind than chasing the nearest unsearched cell.

export interface Waypoint {
  x: number; // cell column
  y: number; // cell row
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

/**
 * Waypoints (cells) along lanes covering `b`, entered from (fromX, fromY).
 * @param spacing distance between lanes in cells (about the camera's useful swath width)
 * @param step distance between waypoints along a lane in cells
 */
export function planLanes(b: Bounds, fromX: number, fromY: number, spacing: number, step: number): Waypoint[] {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const horizontal = w >= h; // lanes run along the longer side: fewer turns
  const across = horizontal ? h : w;
  const along = horizontal ? w : h;
  const lanes = Math.max(1, Math.ceil(across / spacing));

  // Lane offsets (across) and stops (along), relative to the block corner.
  const offsets = Array.from({ length: lanes }, (_, k) => Math.floor(((k + 0.5) * across) / lanes));
  const stops: number[] = [];
  for (let a = 0; a < along; a += step) stops.push(a);
  if (stops[stops.length - 1] !== along - 1) stops.push(along - 1);

  // Start from the corner nearest the drone.
  const fromAcross = horizontal ? fromY - b.y0 : fromX - b.x0;
  const fromAlong = horizontal ? fromX - b.x0 : fromY - b.y0;
  if (fromAcross > across / 2) offsets.reverse();
  let forward = fromAlong <= along / 2;

  const out: Waypoint[] = [];
  for (const o of offsets) {
    const lane = forward ? stops : [...stops].reverse();
    for (const a of lane) out.push(horizontal ? { x: b.x0 + a, y: b.y0 + o } : { x: b.x0 + o, y: b.y0 + a });
    forward = !forward;
  }
  return out;
}
