// Builds a complete playable area (map + offline crowd intel) and lists it in public/areas/index.json.
// Usage: npm run area -- --id metrotown --name "Metrotown, Burnaby" --center 49.2266,-123.0035
// Any option accepted by fetch-world.mjs can be passed through (--bbox, --size-km, --base).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { parseArgs } from "node:util";

const argv = process.argv.slice(2);
const { values } = parseArgs({ args: argv, strict: false, options: { id: { type: "string" }, name: { type: "string" } } });
if (!values.id || !values.name) {
  console.error('Usage: npm run area -- --id <id> --name "<Name>" --center <lat,lon>');
  process.exit(1);
}

const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("scripts/fetch-world.mjs", argv);
run("scripts/fetch-places.ts", ["--id", values.id]);

const indexFile = "public/areas/index.json";
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : { areas: [] };
const { meta } = JSON.parse(fs.readFileSync(`public/areas/${values.id}/world.json`, "utf8"));
const entry = { id: values.id, name: values.name, bbox: meta.bbox };
index.areas = [...index.areas.filter((a) => a.id !== values.id), entry];
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
console.log(`\nArea "${values.name}" ready: open /?area=${values.id}`);
