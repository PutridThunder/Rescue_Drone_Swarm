// Builds one playable area: public/areas/<id>/world.json (10 m simulation grid) and map.json
// (vector footprints/roads for rendering), from OSM (Overpass) + AWS Terrarium DEM tiles.
// Usage:
//   npm run data                                    (Lonsdale, the default area)
//   node scripts/fetch-world.mjs --id metrotown --name "Metrotown, Burnaby" --center 49.2266,-123.0035
// Options: --center lat,lon [--size-km 2.5x2.1] | --bbox S,W,N,E   --base lat,lon (truck staging)
// Raw responses are cached in scripts/.cache. The building itself is in lib/buildWorld.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bboxAround, buildWorld, formatWorldJson } from "./lib/buildWorld.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    id: { type: "string", default: "lonsdale" },
    name: { type: "string", default: "Lonsdale, North Vancouver" },
    bbox: { type: "string" },
    center: { type: "string" },
    "size-km": { type: "string", default: "2.5x2.1" },
    base: { type: "string", default: "49.3112,-123.0848" }, // Waterfront Park by Lonsdale Quay
  },
});
const nums = (v) => v.split(",").map(Number);

function areaBbox() {
  if (args.bbox) return nums(args.bbox);
  if (!args.center) return [49.308, -123.095, 49.327, -123.06]; // Lonsdale
  const [lat, lon] = nums(args.center);
  return bboxAround(lat, lon, args["size-km"]);
}

const OUT_DIR = path.join(here, "..", "public", "areas", args.id);
const OUT = path.join(OUT_DIR, "world.json");
const OUT_MAP = path.join(OUT_DIR, "map.json");

async function main() {
  const bbox = areaBbox();
  // Truck staging: --base, or the area centre when --center is given without one.
  const staging = args.center && args.base === "49.3112,-123.0848" ? nums(args.center) : nums(args.base);
  const { world, map, buildingCount } = await buildWorld({ name: args.name, bbox, staging, cacheDir: path.join(here, ".cache") });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, formatWorldJson(world));
  fs.writeFileSync(OUT_MAP, JSON.stringify(map));
  const vecBuildings = map.buildings;
  const vecRoads = map.roads;
  const { terrain, elevation, population, base } = world;
  const { width: WIDTH, height: HEIGHT } = world.meta;
  const NCELLS = WIDTH * HEIGHT;
  const T = { Water: 0, Ground: 1, Road: 2, Park: 3, Building: 4 };
  console.log(
    `Wrote ${OUT_MAP} (${(fs.statSync(OUT_MAP).size / 1e6).toFixed(2)} MB), ${vecBuildings.length} footprints, ${vecRoads.length} roads`,
  );

  // Summary
  const names = ["Water", "Ground", "Road", "Park", "Building"];
  const counts = [0, 0, 0, 0, 0];
  for (const t of terrain) counts[t]++;
  let lo = Infinity,
    hi = -Infinity,
    pop = 0;
  for (let i = 0; i < NCELLS; i++) {
    pop += population[i];
    if (terrain[i] !== T.Water) {
      lo = Math.min(lo, elevation[i]);
      hi = Math.max(hi, elevation[i]);
    }
  }
  console.log(
    `\nWrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`,
  );
  console.log(`  dims ${WIDTH} x ${HEIGHT}, OSM buildings ${buildingCount}`);
  names.forEach((nm, t) =>
    console.log(
      `  ${nm.padEnd(9)} ${String(counts[t]).padStart(6)}  (${((counts[t] / NCELLS) * 100).toFixed(1)}%)`,
    ),
  );
  console.log(`  population prior total ${Math.round(pop)}`);
  console.log(`  land elevation ${lo.toFixed(1)} .. ${hi.toFixed(1)} m`);
  console.log(
    `  base (${base.x}, ${base.y}) terrain ${names[terrain[base.y * WIDTH + base.x]]}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
