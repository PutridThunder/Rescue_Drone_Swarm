// Imports a new playable area from a place name: geocode with OpenStreetMap Nominatim (free, no
// key), then run the same build script the team uses (scripts/build-area.mjs).
import { spawn } from "node:child_process";
import fs from "node:fs";

const UA = "rescue-drone-swarm/0.1 (hackathon simulation)";
const BUILD_TIMEOUT_MS = 6 * 60_000;
let busy = false; // Overpass and Nominatim are shared free services: one import at a time

interface Place {
  lat: string;
  lon: string;
  display_name: string;
}

async function geocode(query: string): Promise<{ lat: number; lon: number; name: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`geocoding failed (HTTP ${res.status})`);
  const [hit] = (await res.json()) as Place[];
  if (!hit) throw new Error(`couldn't find "${query}"`);
  // "Metrotown, Burnaby, Metro Vancouver Regional District, British Columbia, ..." -> "Metrotown, Burnaby"
  const parts = hit.display_name.split(",").map((p) => p.trim()).filter((p) => !/^\d/.test(p));
  return { lat: Number(hit.lat), lon: Number(hit.lon), name: parts.slice(0, 2).join(", ") };
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function runBuild(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build-area.mjs", ...args], { stdio: ["ignore", "inherit", "inherit"] });
    const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error("map build failed (OpenStreetMap may be busy, try again)"));
    });
  });
}

export async function importArea(query: string): Promise<{ id: string; name: string }> {
  if (busy) throw new Error("another import is running");
  busy = true;
  try {
    const place = await geocode(query);
    const id = slug(place.name);
    if (!fs.existsSync(`public/areas/${id}/world.json`)) {
      await runBuild(["--id", id, "--name", place.name, "--center", `${place.lat},${place.lon}`]);
    }
    return { id, name: place.name };
  } finally {
    busy = false;
  }
}
