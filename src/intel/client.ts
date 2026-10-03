// Browser side of crowd intel: everything is computed locally from bundled files (no network APIs).

import { buildReport } from "./buildReport";
import { areaFile } from "../world/areas";
import type { IntelReport, Place, RegionalEvent } from "./types";

export interface OfflineIntel {
  places: Place[];
  regional: RegionalEvent[];
}

/** Load the bundled offline layer for an area (places) plus region-wide events. */
export async function loadOfflineIntel(areaId: string): Promise<OfflineIntel> {
  const [placesFile, regionalFile] = await Promise.all([
    fetch(areaFile(areaId, "places.json")).then((r) => (r.ok ? r.json() : { places: [] })),
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
    steps: [
      { source: "OpenStreetMap", status: "ok", detail: `${data.places.length} gathering places (bundled)` },
      { source: "Regional events", status: "ok", detail: `${data.regional.length} scheduled big events (bundled)` },
    ],
  });
}
