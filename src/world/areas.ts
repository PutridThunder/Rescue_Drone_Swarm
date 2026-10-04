// Playable areas. Each is a set of files (world.json, map.json, places.json, eo.json,
// satellite.jpg) that lives either bundled in public/areas/<id>/ (the original four, instant
// and offline) or in Snowflake (served by /api/snowflake, so new areas need no redeploy).
// The current area comes from the URL (?area=<id>). Any place in the world can be searched; it
// is split into fixed map parts (scripts/lib/worldGrid.mjs) that are built on demand.

import type { Part } from "../../scripts/lib/worldGrid.mjs";
import { partFromId } from "../../scripts/lib/worldGrid.mjs";

export interface AreaInfo {
  id: string;
  name: string; // e.g. "Metrotown, Burnaby"
  bbox: [number, number, number, number];
  stored?: boolean; // in Snowflake
}

export interface PlaceResult {
  name: string;
  label: string; // e.g. "Tokyo, Japan"
  type: string; // e.g. "city"
  lat: number;
  lon: number;
  parts: Part[][]; // rows north to south
}

export type AreaFileName = "world.json" | "map.json" | "places.json" | "eo.json" | "satellite.jpg";

export const DEFAULT_AREA = "lonsdale";
const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const API = "/api/snowflake";

/** Areas bundled with the website (instant, no database needed), and Snowflake versions. */
let bundledIds = new Set<string>();
let storedVersions = new Map<string, number>();

export function currentAreaId(): string {
  const id = new URLSearchParams(location.search).get("area") ?? DEFAULT_AREA;
  return ID_PATTERN.test(id) ? id : DEFAULT_AREA;
}

/**
 * Where to load one of an area's files from. Bundled areas (like the default, North Vancouver)
 * load straight from the website so anyone can try them without waiting on the database;
 * everything else comes from Snowflake.
 */
export function areaFile(id: string, file: AreaFileName): string {
  if (bundledIds.has(id)) return `/areas/${id}/${file}`;
  const version = storedVersions.get(id);
  if (version !== undefined) return `${API}?area=${id}&file=${file}&v=${version}`;
  return partFromId(id) ? `${API}?area=${id}&file=${file}` : `/areas/${id}/${file}`;
}

/** The areas bundled with the website (a small static file: fast). */
export async function loadBundledAreas(): Promise<AreaInfo[]> {
  const areas = (await getJson<{ areas: AreaInfo[] }>("/areas/index.json"))?.areas ?? [];
  bundledIds = new Set(areas.map((a) => a.id));
  return areas;
}

/** The areas stored in Snowflake (empty if it isn't set up or can't be reached). */
export async function loadStoredAreas(): Promise<AreaInfo[]> {
  const stored = (await getJson<{ areas: (AreaInfo & { version: number })[] }>(`${API}?areas`))?.areas ?? [];
  storedVersions = new Map(stored.map((a) => [a.id, a.version]));
  return stored.map(({ version: _v, ...a }) => ({ ...a, stored: true }));
}

/** One list for the picker: bundled areas first, then the rest of Snowflake's. */
export function mergeAreas(bundled: AreaInfo[], stored: AreaInfo[]): AreaInfo[] {
  const ids = new Set(bundled.map((a) => a.id));
  return [...bundled, ...stored.filter((a) => !ids.has(a.id))];
}

/** Switch area by reloading with ?area=<id> (keeps every module simple: one area per page load). */
export function openArea(id: string) {
  const url = new URL(location.href);
  url.searchParams.set("area", id);
  location.href = url.toString();
}

/** Places matching a name anywhere in the world, each with its grid of map parts. */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const res = await fetch(`${API}?search=${encodeURIComponent(query)}`).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { places?: PlaceResult[]; error?: string } | null;
  if (!res?.ok || !body?.places) throw new Error(body?.error ?? "Search needs the internet and the app's server.");
  return body.places;
}

/** Make sure a map part exists (building it from OpenStreetMap if needed). Resolves to its id. */
export async function buildPart(partId: string): Promise<string> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "build", part: partId }) }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
  if (!res?.ok || !body?.id) throw new Error(body?.error ?? "Couldn't reach the server.");
  return body.id;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
