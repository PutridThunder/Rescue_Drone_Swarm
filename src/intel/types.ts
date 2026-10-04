// Crowd intelligence types: places (bundled per area), scheduled events, and the resulting hotspots.

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

/** A gathering place from OpenStreetMap (offline layer, public/areas/<id>/places.json). */
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

/** A big scheduled event (e.g. a game at BC Place) whose crowds fill the venue and ripple outward. */
export interface RegionalEvent {
  name: string;
  venue: string;
  lat: number;
  lon: number;
  start: string; // ISO
  durationH: number;
  attendance: number;
  sport: boolean; // sports draw watch parties at local pubs
  homeGame?: boolean; // the local team plays: pubs fill even more
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
  status: "ok";
  detail: string;
}

export interface IntelReport {
  at: string; // disaster time (ISO)
  generatedAt: string;
  summary: string;
  hotspots: Hotspot[];
  steps: IntelStep[];
}
