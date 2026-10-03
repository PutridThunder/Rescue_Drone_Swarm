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

Area data is checked in under `public/areas/`. To rebuild an area from OpenStreetMap and elevation data, run `npm run area` (see Areas).
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

## Areas

Pick an area from the header (click the area name under the title):

| Area | id |
|---|---|
| Lonsdale, North Vancouver | `lonsdale` |
| Downtown, Vancouver (BC Place, Rogers Arena) | `downtown` |
| Metrotown, Burnaby | `metrotown` |
| City Centre, Surrey | `surrey-centre` |

Each area is a 2.5 × 2.1 km, 10 m grid in `public/areas/<id>/` (`world.json`, `map.json`, `places.json`), listed in `public/areas/index.json`. Areas are bundled, so they work offline.

To add an area (needs internet once, to download OpenStreetMap and elevation data):

```bash
npm run area -- --id kitsilano --name "Kitsilano, Vancouver" --center 49.2684,-123.1683
```

You can also type a place name under **Import an area** in the app while running `npm run dev`. Tsunami is disabled for areas without a coastline.

## Crowd intel

Predicts where people are at the moment the disaster strikes, so drones search those places first. Turn on **Crowd intel** under "What the drones know" and pick a disaster time. Everything runs offline in the browser, with no web search or online APIs:

- `public/areas/<id>/places.json`: gathering places from OpenStreetMap (schools, transit, hospitals, markets, venues, restaurants) with estimated capacities. Refresh with `npm run intel:places -- --id <id>`.
- `src/intel/occupancy.ts`: how full each kind of place is by day of week and hour (schools in session, commute peaks, dinner rush). Stadiums are empty unless an event is scheduled.
- `public/intel/regional-events.json`: upcoming big events (add them by hand). The venue fills if it is in the map, fans pass through transit hubs before and after, and pubs fill for sports.
- `src/intel/buildReport.ts`: combines these into ranked hotspots with reasons and OpenStreetMap links.

## Project layout

```
src/types.ts          shared contracts between layers
src/sim/              simulation and autonomy engine (pure TypeScript, tested)
src/world/            world loading and procedural fallback
src/render/           three.js renderer and HUD (UI.ts, IntelPanel.ts, ...)
src/intel/            crowd intel: occupancy model, report builder (offline, tested)
server/areas/         dev-server endpoint for importing a new area by place name
scripts/              data pipelines (map, elevation, places, build-area)
public/areas/         bundled areas: <id>/world.json, map.json, places.json
public/intel/         regional-events.json
```

Map data © OpenStreetMap contributors (ODbL).
