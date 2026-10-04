export interface Part {
  id: string;
  row: number;
  col: number;
  bbox: [number, number, number, number];
  center: [number, number];
}
export const PART_W_KM: number;
export const PART_H_KM: number;
export const MAX_PARTS_SIDE: number;
export function partAt(lat: number, lon: number): Part;
export function part(row: number, col: number): Part;
export function partFromId(id: string): Part | null;
export function partsCovering(bbox: [number, number, number, number], center: [number, number]): Part[][];
