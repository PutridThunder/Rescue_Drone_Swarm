// Browser side of crowd intel: the offline layer is computed locally from bundled files;
// the online layer asks the dev server (which holds any API keys).

import { buildReport } from "./buildReport";
import type { IntelReport, Place, RegionalEvent } from "./types";

export interface OfflineIntel {
  places: Place[];
  regional: RegionalEvent[];
}

/** Load the bundled offline layer (public/intel/*.json). */
export async function loadOfflineIntel(): Promise<OfflineIntel> {
  const [placesFile, regionalFile] = await Promise.all([
    fetch("/intel/places.json").then((r) => (r.ok ? r.json() : { places: [] })),
    fetch("/intel/regional-events.json").then((r) => (r.ok ? r.json() : { events: [] })),
  ]);
  return { places: placesFile.places ?? [], regional: regionalFile.events ?? [] };
}

/** Instant report from offline data only (no network). */
export function offlineReport(data: OfflineIntel, at: Date): IntelReport {
  return buildReport({
    places: data.places,
    regional: data.regional,
    at,
    mode: "offline",
    steps: [
      { source: "OpenStreetMap", status: "ok", detail: `${data.places.length} gathering places (bundled)` },
      { source: "Regional events", status: "ok", detail: `${data.regional.length} scheduled big events (bundled)` },
    ],
  });
}

/** Offline layer + live web sources, via the dev server. Throws if the server is unavailable. */
export async function searchOnline(at: Date, bbox: [number, number, number, number]): Promise<IntelReport> {
  const res = await fetch("/api/intel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ at: at.toISOString(), bbox }),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || "error" in json) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as IntelReport;
}
