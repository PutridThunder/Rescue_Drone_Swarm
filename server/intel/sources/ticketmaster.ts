// Ticketmaster Discovery API (free key: developer.ticketmaster.com): scheduled events around the
// disaster time. Events inside the map become hotspots; big events elsewhere in Metro Vancouver
// (BC Place, Rogers Arena, PNE) become regional events whose crowds ripple into the map.
import type { RegionalEvent, Signal } from "../../../src/intel/types";
import { failed, getJson, skipped, type SourceContext, type SourceResult } from "./common";

const SOURCE = "Ticketmaster";
const HOURS_BEFORE = 4; // events that started up to 4 h before are probably still running
const HOURS_AFTER = 3; // events starting soon already draw travelling crowds
const REGION_RADIUS_KM = 20;
const DEFAULT_DURATION_H = 3;

// Known big venues (capacity) - events elsewhere only matter if they draw a big crowd.
const BIG_VENUES: [RegExp, number][] = [
  [/bc place/i, 54500],
  [/rogers arena/i, 18900],
  [/pacific coliseum/i, 16000],
  [/pne|playland|hastings park/i, 10000],
  [/queen elizabeth theatre/i, 2800],
  [/orpheum/i, 2700],
];
const SPORT_SEGMENT = /sports/i;

interface TmEvent {
  name: string;
  url: string;
  dates?: { start?: { dateTime?: string } };
  classifications?: { segment?: { name?: string } }[];
  _embedded?: { venues?: { name?: string; location?: { latitude: string; longitude: string } }[] };
}

const tmTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function fetchTicketmaster({ at, bbox, env }: SourceContext): Promise<SourceResult> {
  if (!env.TICKETMASTER_API_KEY) return skipped(SOURCE, "add TICKETMASTER_API_KEY (free) to .env.local");
  try {
    const [s, w, n, e] = bbox;
    const params = new URLSearchParams({
      apikey: env.TICKETMASTER_API_KEY,
      latlong: `${(s + n) / 2},${(w + e) / 2}`,
      radius: String(REGION_RADIUS_KM),
      unit: "km",
      startDateTime: tmTime(new Date(at.getTime() - HOURS_BEFORE * 3_600_000)),
      endDateTime: tmTime(new Date(at.getTime() + HOURS_AFTER * 3_600_000)),
      size: "100",
    });
    const json = await getJson<{ _embedded?: { events?: TmEvent[] } }>(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);

    const signals: Signal[] = [];
    const regional: RegionalEvent[] = [];
    for (const ev of json._embedded?.events ?? []) {
      const venue = ev._embedded?.venues?.[0];
      const lat = Number(venue?.location?.latitude);
      const lon = Number(venue?.location?.longitude);
      const start = ev.dates?.start?.dateTime;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const title = `${ev.name}${venue?.name ? ` @ ${venue.name}` : ""}`;
      const inside = lat >= s && lat <= n && lon >= w && lon <= e;
      if (inside) {
        signals.push({ source: SOURCE, type: "event", title, text: ev.name, url: ev.url, time: start, lat, lon });
        continue;
      }
      const capacity = BIG_VENUES.find(([re]) => re.test(venue?.name ?? ""))?.[1];
      if (!capacity || !start) continue;
      regional.push({
        name: ev.name,
        venue: venue?.name ?? "venue",
        lat,
        lon,
        start,
        durationH: DEFAULT_DURATION_H,
        attendance: capacity,
        sport: ev.classifications?.some((c) => SPORT_SEGMENT.test(c.segment?.name ?? "")) ?? false,
        source: { title: `${SOURCE}: ${title}`, url: ev.url },
      });
    }
    return {
      signals,
      regional,
      step: { source: SOURCE, status: "ok", detail: `${signals.length} events in the map, ${regional.length} big events nearby (BC Place, Rogers Arena…)` },
    };
  } catch (err) {
    return failed(SOURCE, err);
  }
}
