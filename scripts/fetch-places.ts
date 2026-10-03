// Offline crowd-intel layer for one area: downloads gathering places (schools, transit, venues,
// markets...) from OpenStreetMap and writes public/areas/<id>/places.json, bundled with the app.
// Usage: npm run intel:places -- --id lonsdale
import fs from "node:fs";
import { parseArgs } from "node:util";
import { loadPlaces } from "./lib/places.ts";

const { values } = parseArgs({ options: { id: { type: "string", default: "lonsdale" } } });
const dir = `public/areas/${values.id}`;
const world = JSON.parse(fs.readFileSync(`${dir}/world.json`, "utf8")) as { meta: { bbox: [number, number, number, number] } };
const { places, cached } = await loadPlaces(world.meta.bbox);
fs.writeFileSync(`${dir}/places.json`, JSON.stringify({ bbox: world.meta.bbox, fetchedAt: new Date().toISOString(), places }));

const byKind = new Map<string, number>();
for (const p of places) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
console.log(`Wrote ${dir}/places.json: ${places.length} places${cached ? " (from cache)" : ""}`);
console.log("  " + [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));
