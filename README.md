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

- **World:** 218 × 167 grid of 30 m cells built from OpenStreetMap buildings, roads, parks and water, plus AWS Terrarium elevation tiles. Population is estimated from residential floor area.
- **Knowledge:** the fleet shares one map of what is known and searched. Ground truth (survivor locations, hazards) is hidden until sensed.
- **Priority:** each 10 × 10 sector is scored with configurable weights for population, hazard, urgency, information gain and rescue value, minus distance, battery and redundancy costs.
- **Allocation:** greedy auction that spreads drones across sectors, with hysteresis so drones finish their work.
- **Navigation:** 8-connected A* around tall buildings, with extra cost through hazard zones.
- **Resilience:** battery limits and recharging; disabling a drone releases its sector to the rest of the fleet.
- **Tsunami scenario:** low-lying coastal cells flood at impact, and survivors not yet found there are lost. With disaster info enabled, the fleet prioritizes the flood zone.

## Project layout

```
src/types.ts     shared contracts between layers
src/sim/         simulation and autonomy engine (pure TypeScript, tested)
src/world/       world loading and procedural fallback
src/render/      three.js renderer and HUD
scripts/         OSM and elevation data pipeline
```

Map data © OpenStreetMap contributors (ODbL).
