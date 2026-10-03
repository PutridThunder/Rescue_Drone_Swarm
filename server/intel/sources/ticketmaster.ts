// Ticketmaster Discovery API (free key: developer.ticketmaster.com): scheduled events near the area
// around the disaster time.
import type { Signal } from "../../../src/intel/types";
import { failed, getJson, skipped, type SourceContext, type SourceResult } from "./common";

const SOURCE = "Ticketmaster";
const HOURS_BEFORE = 4; // events that started up to 4 h before are probably still running
const HOURS_AFTER = 1;

interface TmEvent {
  name: string;
  url: string;
  dates?: { start?: { dateTime?: string } };
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
      radius: "3",
      unit: "km",
      startDateTime: tmTime(new Date(at.getTime() - HOURS_BEFORE * 3_600_000)),
      endDateTime: tmTime(new Date(at.getTime() + HOURS_AFTER * 3_600_000)),
      size: "50",
    });
    const json = await getJson<{ _embedded?: { events?: TmEvent[] } }>(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
    const signals: Signal[] = [];
    for (const ev of json._embedded?.events ?? []) {
      const venue = ev._embedded?.venues?.[0];
      const lat = Number(venue?.location?.latitude);
      const lon = Number(venue?.location?.longitude);
      if (!(lat >= s && lat <= n && lon >= w && lon <= e)) continue; // radius search is circular; keep the map area only
      signals.push({ source: SOURCE, type: "event", title: `${ev.name}${venue?.name ? ` @ ${venue.name}` : ""}`, text: ev.name, url: ev.url, time: ev.dates?.start?.dateTime, lat, lon });
    }
    return { signals, step: { source: SOURCE, status: "ok", detail: `${signals.length} events in the area around that time` } };
  } catch (err) {
    return failed(SOURCE, err);
  }
}
