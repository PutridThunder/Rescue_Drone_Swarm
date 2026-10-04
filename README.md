# Rescue Drone Swarm

Rescue Drone Swarm is a browser-based simulation and decision-support platform for autonomous search-and-rescue drone operations in disaster-affected urban environments. It models a multi-drone fleet working over a city grid, sensing the environment, inferring uncertainty, prioritising search sectors, and planning routes around hazards, buildings, battery limits, and time pressure.

The project is designed around a core idea: in the first hours after a disaster, the most valuable information is often not simply "where is the nearest building" but "which cells are most likely to contain survivors, and which areas are most time-sensitive, dangerous, or inaccessible?" The simulator turns that question into a live, mission-aware planning problem.

This repo is not just a single city demo. It is a foundation for future disaster-response systems that can coordinate autonomous platforms, integrate geospatial data, and reason over real-time risk and search priorities across multiple hazard types.

## What the repo does

### Search and rescue simulation

The app simulates a swarm of drones searching a city after a disaster, such as a tsunami, flood, or building collapse scenario. It includes:

- multi-drone mission planning and task allocation
- live knowledge sharing across the fleet
- frontier-based search prioritisation
- pathfinding around buildings and obstacles using A* navigation
- population, hazard, urgency, and information-gain scoring
- battery management and recharging logic
- flood or hazard-triggered loss-of-life risk modelling
- metrics for area coverage, survivor discovery, drone utilization, and mission completion

This represents the operational core of a search-and-rescue system: drones do not fly fixed routes; they continuously re-evaluate the mission, update a shared operational picture, and adapt as new information appears.

### Urban risk and disaster intelligence

The simulation uses map and geospatial data drawn from OpenStreetMap, elevation models, Earth Observation datasets, and offline local area bundles. This provides a realistic city context for urban disaster response and extends naturally into broader real-time disaster analytics.

In the current project, the logic is demonstrated in search-and-rescue scenarios. The same architecture is suitable for future capabilities including:

- wildfire spread and edge propagation analysis
- thermal and smoke-driven risk mapping
- coastal condition monitoring and surge risk forecasting
- flood and inundation analysis for low-lying urban regions
- dynamic prioritisation of drone routes based on hazard evolution over time
- coordinated remote sensing and autonomous monitoring during fast-moving disasters

This means the repo is both a simulation of present-day SAR operations and a conceptual platform for real-time disaster intelligence and autonomy in future field deployments.

### DeepSearch (Gemini) and mission weighting

**DeepSearch** (Mission setup panel) asks Gemini, grounded with Google Search, how the fleet should prioritise this mission. It sends the area, its coordinates, the scenario, the time and optional notes from the operator (for example "concert at the arena, smoke on the waterfront"). Gemini returns a weight from 0.0 to 1.0 for each factor, plus a short rationale and the web sources it used:

- population, hazard, urgency, unsearched area, distance cost, battery cost, avoid overlap

0.5 means normal priority: it maps to the planner's tuned default weight. 1.0 doubles it and 0.0 turns it off (`src/intel/deepSearch.ts`). The weights apply to the running mission at once. **Default weights** goes back to the tuned defaults. The prompt is in `api/deepsearch.ts` (spec: [DeepSearch_prompt.md](./DeepSearch_prompt.md)).

DeepSearch is the only online feature, and it is optional: the simulation itself runs offline and works the same without it.

**Setup.** The Gemini key stays on the server. `api/deepsearch.ts` is a Vercel function, and the Vite dev server serves the same handler.

| Where | What to set |
|---|---|
| Vercel | Project > Settings > Environment Variables: `GEMINI_API_KEY` (all environments), then redeploy |
| Local dev | `.env.local` in the repo root: `GEMINI_API_KEY=...` (see `.env.example`), then restart `npm run dev` |

Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`). Never name it `VITE_GEMINI_API_KEY`: anything with the `VITE_` prefix is bundled into the public JavaScript.

## How the system works

```text
OBSERVE → UPDATE SHARED KNOWLEDGE → FIND FRONTIERS → SCORE SECTORS → ALLOCATE DRONES → PLAN PATHS → MOVE → REPLAN
```

The system operates in layers:

- World layer: city map, terrain, buildings, roads, water, elevation, and population priors
- Knowledge layer: what drones have sensed and what remains uncertain
- Planning layer: scoring sectors and assigning drone tasks
- Navigation layer: obstacle-aware route planning and battery-aware movement
- Mission layer: survivorship, completion metrics, and disaster-specific consequences

## Supported scenarios

The current simulation includes:

- search and rescue over urban blocks
- tsunami flood scenario with wave timing and run-up impacts
- area import and changeable operating zones
- crowd-intelligence hotspots and predicted population concentrations
- offline operation using bundled map data and generated area assets

## Areas and data

The app supports multiple city areas, with data bundled under `public/areas/`:

- Lonsdale, North Vancouver
- Downtown, Vancouver
- Metrotown, Burnaby
- Surrey City Centre

Each area includes world, map, population, and geospatial metadata, and can be rebuilt or supplemented through the project tooling.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # simulation unit tests
npm run build    # static production build in dist/
```

Area data is checked in under `public/areas/`. To rebuild an area from OpenStreetMap and elevation data, run `npm run area`.

## Satellite and geospatial pipeline

The project includes a Python-based EO pipeline for generating richer area data from remote sensing sources, including:

- Copernicus DEM for elevation and flood analysis
- ESA WorldCover for land-cover context
- GHSL population layers
- Sentinel-2 imagery and NDWI water-index outputs
- OpenStreetMap place and crowd metadata

This keeps the simulation realistic and offline-capable while allowing high-quality disaster context to be assembled before or during a mission.

## Project layout

```text
src/types.ts          shared contracts between layers
src/sim/              simulation and autonomy engine
src/world/            world loading, area data, procedural fallback
src/app/              application wiring and mission lifecycle
src/render/scene/     3D city renderer and drone scene
src/ui/               HUD and mission controls
src/intel/            crowd intel and disaster risk priors
server/areas/         dev-server support for importing new areas
scripts/              area-data generation tools
public/areas/         bundled area datasets
public/intel/         event and crowd-intel data
DeepSearch_prompt.md  coordinate-based mission-priority prompt template
```

## Future-facing vision

This repo stands as a prototype for more advanced autonomous disaster response systems. Beyond urban search and rescue, the same architecture may be extended to real-time disaster analysis and operational command systems for:

- wildfire spread forecasting and suppression prioritisation
- coastal monitoring and storm surge risk assessment
- dynamic flood modelling in low-lying cities
- rapid, data-driven triage for large incidents
- fleets of autonomous drones or ground robots working as a common operational picture

In that sense, the current project is both a scenario simulator and a platform for next-generation disaster intelligence.

Map data © OpenStreetMap contributors (ODbL). Contains modified Copernicus Sentinel data and Copernicus DEM (© DLR e.V. / Airbus, provided under COPERNICUS by the European Union and ESA). ESA WorldCover © ESA (CC BY 4.0). GHSL © European Commission JRC (CC BY 4.0).
