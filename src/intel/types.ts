// Crowd intelligence shared by the server-side deep search and the browser.

export type HotspotKind =
  | "event"
  | "transit"
  | "school"
  | "health"
  | "market"
  | "venue"
  | "dining"
  | "worship"
  | "park"
  | "hotel"
  | "community"
  | "other";

/** A gathering place from OpenStreetMap (offline layer, public/intel/places.json). */
export interface Place {
  id: string; // OSM id, e.g. "node/123"
  name: string;
  kind: HotspotKind;
  type: string; // OSM tag value, e.g. "school", "ferry_terminal"
  lat: number;
  lon: number;
  capacity: number; // people at full occupancy
  capacitySource: "osm" | "estimate";
}

/** Something found online: a social-media post or a scheduled event. */
export interface Signal {
  source: string; // "Mastodon", "Ticketmaster", "Reddit", "Bluesky"
  type: "post" | "event";
  title: string;
  url: string;
  text: string;
  time?: string; // ISO
  lat?: number; // events only
  lon?: number;
  people?: number; // events only: expected attendance
}

/** A big event outside the map (e.g. a FIFA match at BC Place) whose crowds ripple into it. */
export interface RegionalEvent {
  name: string;
  venue: string;
  lat: number;
  lon: number;
  start: string; // ISO
  durationH: number;
  attendance: number;
  sport: boolean; // sports draw watch parties at local pubs
  source: IntelSource;
}

export interface IntelSource {
  title: string;
  url: string;
}

export interface Hotspot {
  name: string;
  kind: HotspotKind;
  lat: number;
  lon: number;
  people: number; // estimated people present at the disaster time
  confidence: number; // 0..1
  why: string; // one-line reasoning
  sources: IntelSource[];
}

/** What each data source contributed, shown to the user for transparency. */
export interface IntelStep {
  source: string;
  status: "ok" | "skipped" | "error";
  detail: string;
}

export interface IntelReport {
  at: string; // disaster time (ISO)
  generatedAt: string;
  summary: string;
  hotspots: Hotspot[];
  steps: IntelStep[];
  mode: "offline" | "live" | "snapshot"; // offline = bundled data only; live = with online search
}

export interface IntelRequest {
  at: string; // ISO timestamp
  bbox: [number, number, number, number]; // south, west, north, east
}
