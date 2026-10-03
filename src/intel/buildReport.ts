// Turns bundled places + scheduled regional events into ranked crowd hotspots for a disaster time.
// Pure and offline: no network, runs in the browser.

import { occupancy, vancouverTime } from "./occupancy";
import { activeRegionalEvents, rippleFor } from "./regionalRipple";
import type { Hotspot, HotspotKind, IntelReport, IntelStep, Place, RegionalEvent } from "./types";

const MAX_HOTSPOTS = 15;
const MIN_PEOPLE = 25;
const CLUSTER_DEG = 0.0012; // ~100 m: small cafes/restaurants on one block become one hotspot
const SAME_HUB_DEG = 0.002; // ~200 m: transit points this close are one hub

// How much we trust the schedule-based estimate for each kind of place.
const BASE_CONFIDENCE: Record<HotspotKind, number> = {
  school: 0.75,
  health: 0.75,
  transit: 0.65,
  market: 0.55,
  venue: 0.45,
  dining: 0.4,
  worship: 0.5,
  park: 0.3,
  hotel: 0.5,
  community: 0.45,
  event: 0.85,
  other: 0.3,
};

const osmLink = (p: Place) => ({ title: `OpenStreetMap: ${p.name || p.type}`, url: `https://www.openstreetmap.org/${p.id}` });

export interface BuildInput {
  places: Place[];
  at: Date;
  regional?: RegionalEvent[];
  steps?: IntelStep[];
}

export function buildReport({ places, at, regional = [], steps = [] }: BuildInput): IntelReport {
  const t = vancouverTime(at);

  // 1. Schedule-based estimate for every place.
  const estimates = places.map((place) => {
    const occ = occupancy(place.type, place.kind, t, place.name);
    return { place, people: place.capacity * occ.level, reason: occ.reason, confidence: BASE_CONFIDENCE[place.kind], sources: [osmLink(place)] };
  });

  // 2. Big events elsewhere in the region (e.g. FIFA at BC Place) ripple into local hubs and pubs.
  const active = activeRegionalEvents(regional, at);
  const surgedHubs: Place[] = []; // one fan surge per transit hub, even if OSM maps it as several points
  const byCapacity = [...estimates].sort((x, y) => y.place.capacity - x.place.capacity);
  for (const e of byCapacity) {
    const ripple = rippleFor(e.place, active);
    if (!ripple) continue;
    if (ripple.extraPeople > 0) {
      if (surgedHubs.some((h) => Math.hypot(h.lat - e.place.lat, h.lon - e.place.lon) < SAME_HUB_DEG)) continue;
      surgedHubs.push(e.place);
    }
    e.people = Math.max(e.people + ripple.extraPeople, ripple.floorPeople);
    e.reason = `${e.reason}; ${ripple.reason}`;
    e.sources.push(ripple.source);
  }

  // 3. Group small places on the same block (cafes, restaurants) into one hotspot.
  const groups = new Map<string, typeof estimates>();
  for (const e of estimates) {
    const small = e.place.capacity < 100;
    const key = small ? `${e.place.kind}:${Math.round(e.place.lat / CLUSTER_DEG)}:${Math.round(e.place.lon / CLUSTER_DEG)}` : e.place.id;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }

  const hotspots: Hotspot[] = [];
  for (const g of groups.values()) {
    const people = g.reduce((s, e) => s + e.people, 0);
    if (people < MIN_PEOPLE) continue;
    const lead = g.reduce((a, b) => (b.people > a.people ? b : a));
    const name = lead.place.name || `Unnamed ${lead.place.type.replace(/_/g, " ")}`;
    hotspots.push({
      name: g.length > 1 ? `${name} + ${g.length - 1} nearby` : name,
      kind: lead.place.kind,
      lat: g.reduce((s, e) => s + e.place.lat, 0) / g.length,
      lon: g.reduce((s, e) => s + e.place.lon, 0) / g.length,
      people: Math.round(people),
      confidence: Math.max(...g.map((e) => e.confidence)),
      why: `${t.label}: ${lead.reason}${g.length > 1 ? ` across ${g.length} places` : ""}`,
      sources: g.flatMap((e) => e.sources).slice(0, 4),
    });
  }

  hotspots.sort((a, b) => b.people - a.people);
  const top = hotspots.slice(0, MAX_HOTSPOTS);
  const total = top.reduce((s, h) => s + h.people, 0);
  return {
    at: at.toISOString(),
    generatedAt: new Date().toISOString(),
    summary:
      (active.length ? `${active.map((a) => a.event.name).join(", ")} is on. ` : "") +
      `${t.label}: about ${total.toLocaleString()} people at ${top.length} hotspots. ` +
      (top.length ? `Busiest: ${top.slice(0, 3).map((h) => `${h.name} (~${h.people.toLocaleString()})`).join(", ")}.` : ""),
    hotspots: top,
    steps,
  };
}
