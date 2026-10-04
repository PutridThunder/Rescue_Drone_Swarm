// Playable areas: each lives in public/areas/<id>/ (world.json, map.json, places.json) and is
// listed in public/areas/index.json. The current area comes from the URL (?area=<id>).

export interface AreaInfo {
  id: string;
  name: string; // e.g. "Metrotown, Burnaby"
  bbox: [number, number, number, number];
}

export const DEFAULT_AREA = "lonsdale";
const ID_PATTERN = /^[a-z0-9-]{1,40}$/;

export function currentAreaId(): string {
  const id = new URLSearchParams(location.search).get("area") ?? DEFAULT_AREA;
  return ID_PATTERN.test(id) ? id : DEFAULT_AREA;
}

export function areaFile(id: string, file: "world.json" | "map.json" | "places.json"): string {
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

/** Ask the dev server to build a new area from a place name. Resolves to the new area's id. */
export async function importArea(query: string): Promise<string> {
  const res = await fetch("/api/areas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !json.id) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.id;
}
