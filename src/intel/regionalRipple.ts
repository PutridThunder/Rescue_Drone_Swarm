// How a big scheduled event (a concert at Rogers Arena, a game at BC Place) changes crowds in the
// map: the venue itself fills up if it is inside the map, fans pass through transit hubs before
// and after, and people gather at local pubs and restaurants to watch sports.

import type { IntelSource, Place, RegionalEvent } from "./types";

const ARRIVAL_H = 2.5; // fans travel in during the 2.5 h before the start
const DEPARTURE_H = 1.5; // and travel home during the 1.5 h after the end
const TRANSIT_SHARE = 0.015; // share of attendance present at a North Shore hub at the peak
const WATCH_PARTY_LEVEL = 0.6; // pubs/restaurants at least this full during a big sports broadcast
const HOME_TEAM_LEVEL = 0.85; // ...and fuller when Canada plays
const MIN_ATTENDANCE = 5000;
const AT_VENUE_DEG = 0.003; // ~300 m: a place this close to the event location is the venue
const ARRIVED_SHARE = 0.4; // share of the crowd already inside during the arrival window

export interface RippleEffect {
  extraPeople: number; // added on top of the normal estimate
  floorPeople: number; // the place holds at least this many
  reason: string;
  source: IntelSource;
}

type Phase = "arrival" | "during" | "departure" | null;

function phaseAt(ev: RegionalEvent, at: Date): Phase {
  const h = (at.getTime() - Date.parse(ev.start)) / 3_600_000;
  if (h >= -ARRIVAL_H && h < 0) return "arrival";
  if (h >= 0 && h < ev.durationH) return "during";
  if (h >= ev.durationH && h < ev.durationH + DEPARTURE_H) return "departure";
  return null;
}

/** Events in progress (or with fans travelling) at the disaster time. */
export function activeRegionalEvents(events: RegionalEvent[], at: Date): { event: RegionalEvent; phase: Exclude<Phase, null> }[] {
  return events
    .filter((ev) => ev.attendance >= MIN_ATTENDANCE)
    .map((event) => ({ event, phase: phaseAt(event, at) }))
    .filter((e): e is { event: RegionalEvent; phase: Exclude<Phase, null> } => e.phase !== null);
}

/** Ripple effect of the active regional events on one place, or null if it is unaffected. */
export function rippleFor(place: Place, active: ReturnType<typeof activeRegionalEvents>): RippleEffect | null {
  let extra = 0;
  let floor = 0;
  const reasons: string[] = [];
  let source: IntelSource | null = null;
  for (const { event, phase } of active) {
    const label = `${event.name} at ${event.venue} (~${event.attendance.toLocaleString()})`;
    const atVenue = Math.hypot(place.lat - event.lat, place.lon - event.lon) < AT_VENUE_DEG && place.kind === "venue";
    if (atVenue && phase !== "departure") {
      floor = Math.max(floor, event.attendance * (phase === "during" ? 1 : ARRIVED_SHARE));
      reasons.push(`${event.name} ${phase === "during" ? "in progress" : "starting soon"}`);
      source ??= event.source;
    } else if (place.kind === "transit" && phase !== "during") {
      extra += event.attendance * TRANSIT_SHARE;
      reasons.push(`fans ${phase === "arrival" ? "heading to" : "returning from"} ${label}`);
      source ??= event.source;
    } else if (place.kind === "dining" && event.sport && phase === "during") {
      floor = Math.max(floor, place.capacity * (/canada/i.test(event.name) ? HOME_TEAM_LEVEL : WATCH_PARTY_LEVEL));
      reasons.push(`watching ${label}`);
      source ??= event.source;
    }
  }
  return source ? { extraPeople: extra, floorPeople: floor, reason: reasons.join("; "), source } : null;
}
