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

### Mission weighting

Each block is scored by population, hazard, urgency and unsearched area, minus distance, battery and overlap costs. The weights are tuned defaults in `src/sim/defaults.ts`; they are part of the simulation logic and not edited in the UI.

### Results storage (Snowflake)

Optional. When a mission or a challenge game ends, its results are stored in Snowflake, and a **Results history** panel (mission setup) shows what's stored: algorithm vs human record, average mission time per area and the latest runs. Without Snowflake the panel stays hidden and nothing else changes; the simulation itself never needs it.

Stored: per mission, the area, scenario, fleet, search circle, survivors found, time, % searched, distance, battery, and a coverage timeline (every 10 s); per game, both sides' survivors and area plus the winner (`snowflake/setup.sql` lists every column).

**Setup (once, about 15 minutes)**
1. In Snowflake (a trial account is enough), open a SQL worksheet and run all of `snowflake/setup.sql` as `ACCOUNTADMIN`. It creates the database, two tables, an X-Small warehouse that suspends after 60 s, and a service user that can only read and add rows. It is safe to run again.
2. Open `snowflake/token.sql` and run its statements **one at a time** (select one, then Ctrl/Cmd + Enter). The token statement shows its `token_secret` only once, so copy it immediately: use **1a** the first time and **1b** if the token already exists or the secret was lost. Statement 2 gives the account identifier, e.g. `MYORG-MYACCOUNT`. (A worksheet's "Run all" only shows the last result, which is why these aren't run together.)
3. In Vercel (Project > Settings > Environment Variables) add `SNOWFLAKE_ACCOUNT` and `SNOWFLAKE_TOKEN`, then redeploy.
4. **The whole world's map data:** in Snowflake's Marketplace, "Get" CARTO's free *Overture Maps* listings (Buildings, Transportation, Base; built from OpenStreetMap plus other open data, about 2.3 billion buildings), then run `snowflake/overture.sql`. Any searched city part is then built from your own Snowflake in a few seconds, with no outside map servers.
5. Optional: `npm run maps:upload` copies the four built-in areas (with their satellite layers) into Snowflake too. Locally, put the same two lines in `.env.local` (see `.env.example`) and restart `npm run dev`.

The token never reaches the browser: `api/snowflake.ts` is a Vercel function (the Vite dev server serves the same handler) that talks to Snowflake's SQL API and checks and clamps everything it receives. Never prefix these variables with `VITE_`. The token expires after 90 days; run statement 1b in `snowflake/token.sql` to renew it.

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
scripts/              area-data generation tools
public/areas/         bundled area datasets
public/intel/         event and crowd-intel data
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
