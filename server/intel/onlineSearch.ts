// Online layer: asks every free source in parallel and merges the results with the offline places.
// To add a source, write server/intel/sources/<name>.ts and list it in SOURCES.
import fs from "node:fs";
import path from "node:path";
import { buildReport } from "../../src/intel/buildReport";
import type { IntelReport, IntelRequest, Place, RegionalEvent } from "../../src/intel/types";
import { fetchBluesky } from "./sources/bluesky";
import type { IntelEnv, SourceContext, SourceResult } from "./sources/common";
import { fetchMastodon } from "./sources/mastodon";
import { fetchReddit } from "./sources/reddit";
import { fetchTicketmaster } from "./sources/ticketmaster";

const SOURCES: ((ctx: SourceContext) => Promise<SourceResult>)[] = [fetchMastodon, fetchTicketmaster, fetchReddit, fetchBluesky];

const PLACES_FILE = path.resolve("public/intel/places.json");
const REGIONAL_FILE = path.resolve("public/intel/regional-events.json");
const SNAPSHOT_FILE = path.resolve("public/intel/snapshot.json");

export async function runOnlineSearch(req: IntelRequest, env: IntelEnv): Promise<IntelReport> {
  const { places } = JSON.parse(fs.readFileSync(PLACES_FILE, "utf8")) as { places: Place[] };
  const { events: regional } = JSON.parse(fs.readFileSync(REGIONAL_FILE, "utf8")) as { events: RegionalEvent[] };
  const ctx: SourceContext = { at: new Date(req.at), bbox: req.bbox, env };
  const results = await Promise.all(SOURCES.map((source) => source(ctx)));

  const report = buildReport({
    places,
    at: ctx.at,
    signals: results.flatMap((r) => r.signals),
    regional: [...regional, ...results.flatMap((r) => r.regional ?? [])],
    steps: [
      { source: "OpenStreetMap", status: "ok", detail: `${places.length} gathering places (offline)` },
      { source: "Regional events", status: "ok", detail: `${regional.length} scheduled big events (offline)` },
      ...results.map((r) => r.step),
    ],
    mode: "live",
  });
  // Keep the latest live result so static builds (no server) can still show it.
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ ...report, mode: "snapshot" }, null, 2));
  return report;
}
