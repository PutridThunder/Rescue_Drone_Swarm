import type { TaskView } from "../types";

export const SECTOR_SIZE = 10;
export const SECTOR_DONE = 0.85;

/** A fixed rectangular search area. Candidate tasks are sectors that are not yet sufficiently searched. */
export interface Sector {
  id: number;
  col: number;
  row: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  name: string;
  view: TaskView;
  exhausted: boolean;
  /** Only edge cells are left, and the neighbouring blocks' sweeps will cover them: skip for now. */
  waiting: boolean;
  /** Its known crowds have had their quick "hasty search" pass; the full sweep comes later. */
  hastyDone: boolean;
  boost: number; // survivor-cluster boost, 0..1
}

export function sectorName(col: number, row: number): string {
  let s = "";
  let c = col;
  do {
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${s}${row + 1}`;
}

export function buildSectors(
  width: number,
  height: number,
  size = SECTOR_SIZE,
): { sectors: Sector[]; cols: number } {
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const sectors: Sector[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * size;
      const y0 = row * size;
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);
      const id = sectors.length;
      sectors.push({
        id,
        col,
        row,
        x0,
        y0,
        x1,
        y1,
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2,
        name: sectorName(col, row),
        exhausted: false,
        waiting: false,
        hastyDone: false,
        boost: 0,
        view: {
          id,
          x0,
          y0,
          x1,
          y1,
          label: sectorName(col, row),
          priority: 0,
          breakdown: {},
          assignedDrone: null,
          searchedFrac: 0,
          isFrontier: false,
        },
      });
    }
  }
  return { sectors, cols };
}

export function sectorAt(
  x: number,
  y: number,
  cols: number,
  size = SECTOR_SIZE,
): number {
  return Math.floor(y / size) * cols + Math.floor(x / size);
}

export function insideSector(s: Sector, x: number, y: number): boolean {
  return x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1;
}
