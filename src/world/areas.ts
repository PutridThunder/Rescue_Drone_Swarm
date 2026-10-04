// Playable areas: each lives in public/areas/<id>/ (world.json, map.json, places.json, eo.json,
// satellite.jpg) and is listed in public/areas/index.json. The current area comes from the URL
// (?area=<id>). Areas ship with the website, so they load instantly and work offline.

export interface AreaInfo {
  id: string;
  name: string; // e.g. "Metrotown, Burnaby"
  bbox: [number, number, number, number];
}

export type AreaFileName = "world.json" | "map.json" | "places.json" | "eo.json" | "satellite.jpg";

export const DEFAULT_AREA = "lonsdale";
const ID_PATTERN = /^[a-z0-9-]{1,40}$/;

export function currentAreaId(): string {
  const id = new URLSearchParams(location.search).get("area") ?? DEFAULT_AREA;
  return ID_PATTERN.test(id) ? id : DEFAULT_AREA;
}

export function areaFile(id: string, file: AreaFileName): string {
  return `/areas/${id}/${file}`;
}

export async function loadAreaIndex(): Promise<AreaInfo[]> {
  try {
    const res = await fetch("/areas/index.json");
    return res.ok ? ((await res.json()) as { areas: AreaInfo[] }).areas : [];
  } catch {
    return [];
  }
}

/** Switch area by reloading with ?area=<id> (keeps every module simple: one area per page load). */
export function openArea(id: string) {
  const url = new URL(location.href);
  url.searchParams.set("area", id);
  location.href = url.toString();
}
