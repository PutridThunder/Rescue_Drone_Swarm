# Rescue Drone Swarm

A browser-based simulation of an autonomous search-and-rescue drone swarm operating over the City of North Vancouver after a disaster.

The drones don't follow fixed routes. They continuously observe, update a shared map, find unsearched frontiers, score areas by population, hazard, urgency and cost, divide the work between themselves, and replan as new information arrives.

> This is a simulation of the concept, not a real-world deployment.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # simulation unit tests
npm run build    # static production build in dist/
```

`public/world.json` is checked in. To regenerate it from OpenStreetMap and elevation data, run `npm run data`.
Its per-cell arrays stay flat, with one grid row per line to make the map data easier to inspect.

## How it works

```
OBSERVE → UPDATE SHARED KNOWLEDGE → FIND FRONTIERS → SCORE SECTORS → ALLOCATE DRONES → A* PATHFIND → MOVE → REPLAN
```

- **World:** 254 × 211 grid of 10 m cells over Lower and Central Lonsdale, built from OpenStreetMap buildings, roads, parks and water, plus AWS Terrarium elevation tiles. Population is estimated from residential floor area.
- **Knowledge:** the fleet shares one map of what is known and searched. Ground truth (survivor locations, hazards) is hidden until sensed.
- **Priority:** each 10 × 10 sector is scored with configurable weights for population, hazard, urgency, information gain and rescue value, minus distance, battery and redundancy costs.
- **Allocation:** greedy auction that spreads drones across sectors, with hysteresis so drones finish their work.
- **Navigation:** 8-connected A* around tall buildings, with extra cost through hazard zones.
- **Resilience:** battery limits and recharging; disabling a drone releases its sector to the rest of the fleet.
- **Tsunami scenario:** low-lying coastal cells flood at impact, and survivors not yet found there are lost. With disaster info enabled, the fleet prioritizes the flood zone.

## Crowd intel

Predicts where people are at the moment the disaster strikes, so drones search those places first. Turn on **Crowd intel** under "What the drones know", pick a disaster time, and optionally press **Search online**.

It works in two layers, using free data only:

1. **Offline (bundled, instant, no network):**
   - `public/intel/places.json`: 234 gathering places in the map from OpenStreetMap (schools, SeaBus, hospital, markets, venues, restaurants) with estimated capacities. Refresh with `npm run intel:places`.
   - `public/intel/regional-events.json`: big upcoming events outside the map whose crowds ripple in (fans pass through Lonsdale Quay; pubs fill for sports watch parties). Empty by default; with a Ticketmaster key, events at BC Place, Rogers Arena and the PNE are found live.
   - `src/intel/occupancy.ts`: how full each kind of place is by day of week and hour.
2. **Online (dev server, `POST /api/intel`):** adds live signals. Social posts that mention a place raise its estimate and confidence; scheduled events become hotspots.

| Source | Key | Status |
|---|---|---|
| OpenStreetMap | none | always on |
| Mastodon hashtags | none | always on |
| Ticketmaster | free, `TICKETMASTER_API_KEY` | optional |
| Reddit | free app, `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | optional |
| Bluesky | free app password, `BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` | optional |

Copy `.env.example` to `.env.local` and fill in the keys you have, then restart `npm run dev`. Keys stay on the server and are never sent to the browser. X is not supported because reading or searching posts requires a paid X API plan.

To add a source, write `server/intel/sources/<name>.ts` exporting `(ctx) => Promise<SourceResult>` and add it to `SOURCES` in `server/intel/onlineSearch.ts`.

## Project layout

```
src/types.ts          shared contracts between layers
src/sim/              simulation and autonomy engine (pure TypeScript, tested)
src/world/            world loading and procedural fallback
src/render/           three.js renderer and HUD (UI.ts, IntelPanel.ts, ...)
src/intel/            crowd intel: occupancy model, report builder, browser client (tested)
server/intel/         online crowd intel: OSM places + one file per free web source
scripts/              data pipelines (map, elevation, places)
public/               bundled data: world.json, map.json, intel/
```

Map data © OpenStreetMap contributors (ODbL).
