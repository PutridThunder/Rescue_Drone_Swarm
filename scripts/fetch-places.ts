// Offline crowd-intel layer: downloads gathering places (schools, transit, venues, markets...) from
// OpenStreetMap for the mission area and writes public/intel/places.json, bundled with the app.
// Usage: npm run intel:places
import fs from "node:fs";
import { loadPlaces } from "../server/intel/places.ts";

const world = JSON.parse(fs.readFileSync("public/world.json", "utf8")) as { meta: { bbox: [number, number, number, number] } };
const { places, cached } = await loadPlaces(world.meta.bbox);
fs.mkdirSync("public/intel", { recursive: true });
fs.writeFileSync("public/intel/places.json", JSON.stringify({ bbox: world.meta.bbox, fetchedAt: new Date().toISOString(), places }));

const byKind = new Map<string, number>();
for (const p of places) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
console.log(`Wrote public/intel/places.json: ${places.length} places${cached ? " (from cache)" : ""}`);
for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${n}`);
console.log("Named examples:", places.filter((p) => p.name && p.capacity >= 300).slice(0, 12).map((p) => `${p.name} (${p.type}, ${p.capacity})`).join("; "));
