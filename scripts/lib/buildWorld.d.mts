export interface BuiltWorld {
  world: Record<string, unknown> & { meta: { name: string; bbox: number[]; width: number; height: number; cellSizeM: number } };
  map: { buildings: unknown[]; roads: unknown[]; roadNames: string[] };
  buildingCount: number;
}
export function bboxAround(lat: number, lon: number, sizeKm?: string): [number, number, number, number];
export function formatWorldJson(json: unknown): string;
export function buildWorld(opts: {
  name: string;
  bbox: number[];
  staging?: number[] | null;
  cacheDir?: string | null;
  log?: (msg: string) => void;
  overpassTimeoutMs?: number;
  attempts?: number;
}): Promise<BuiltWorld>;
