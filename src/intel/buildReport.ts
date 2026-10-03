// Turns places (offline) + online signals into ranked crowd hotspots for a disaster time.
// Runs in the browser (offline mode) and on the dev server (online mode) - pure, no I/O.

import { matchPostsToPlaces } from "./matchPosts";
import { occupancy, vancouverTime } from "./occupancy";
import { activeRegionalEvents, rippleFor } from "./regionalRipple";
import type { Hotspot, HotspotKind, IntelReport, IntelStep, Place, RegionalEvent, Signal } from "./types";

const MAX_HOTSPOTS = 15;
const MIN_PEOPLE = 25;
const CLUSTER_DEG = 0.0012; // ~100 m: small cafes/restaurants on one block become one hotspot
const DEFAULT_EVENT_ATTENDANCE = 500;
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
  signals?: Signal[];
  regional?: RegionalEvent[];
  steps?: IntelStep[];
  mode: IntelReport["mode"];
}

export function buildReport({ places, at, signals = [], regional = [], steps = [], mode }: BuildInput): IntelReport {
  const t = vancouverTime(at);
  const posts = signals.filter((s) => s.type === "post");
  const events = signals.filter((s) => s.type === "event" && s.lat != null && s.lon != null);

  // 1. Schedule-based estimate for every place.
  const estimates = places.map((place) => {
    const occ = occupancy(place.type, place.kind, t, place.name);
    return { place, people: place.capacity * occ.level, reason: occ.reason, boost: 1, confidence: BASE_CONFIDENCE[place.kind], sources: [osmLink(place)] };
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

  // 3. Social posts that mention a place raise its estimate and our confidence.
  const byId = new Map(estimates.map((e) => [e.place.id, e]));
  for (const m of matchPostsToPlaces(places, posts)) {
    const e = byId.get(m.place.id)!;
    e.boost += m.crowdy ? 0.6 : 0.25;
    e.confidence = Math.min(0.95, e.confidence + 0.15);
    if (e.sources.length < 4) e.sources.push({ title: `${m.post.source}: ${m.post.title.slice(0, 80)}`, url: m.post.url });
  }

  // 4. Group small places on the same block (cafes, restaurants) into one hotspot.
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
    const people = g.reduce((s, e) => s + e.people * e.boost, 0);
    if (people < MIN_PEOPLE) continue;
    const lead = g.reduce((a, b) => (b.people > a.people ? b : a));
    const name = lead.place.name || `Unnamed ${lead.place.type.replace(/_/g, " ")}`;
    const boosted = g.some((e) => e.boost > 1);
    hotspots.push({
      name: g.length > 1 ? `${name} + ${g.length - 1} nearby` : name,
      kind: lead.place.kind,
      lat: g.reduce((s, e) => s + e.place.lat, 0) / g.length,
      lon: g.reduce((s, e) => s + e.place.lon, 0) / g.length,
      people: Math.round(people),
      confidence: Math.max(...g.map((e) => e.confidence)),
      why: `${t.label}: ${lead.reason}${g.length > 1 ? ` across ${g.length} places` : ""}${boosted ? " — mentioned online" : ""}`,
      sources: g.flatMap((e) => e.sources).slice(0, 4),
    });
  }

  // 5. Scheduled events found online are hotspots in their own right.
  for (const ev of events) {
    hotspots.push({
      name: ev.title,
      kind: "event",
      lat: ev.lat!,
      lon: ev.lon!,
      people: ev.people ?? DEFAULT_EVENT_ATTENDANCE,
      confidence: BASE_CONFIDENCE.event,
      why: `${ev.source} event${ev.time ? ` at ${new Date(ev.time).toLocaleTimeString("en-CA", { timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit" })}` : ""}`,
      sources: [{ title: `${ev.source}: ${ev.title}`, url: ev.url }],
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
    mode,
  };
}
