// Shared contracts between the world/render layer and the simulation layer.
// Grid is row-major: index = y * width + x. x grows east, y grows SOUTH (y = 0 is the north edge).
// All simulation distances are in CELLS unless suffixed with M (metres).

// ---------------------------------------------------------------------------
// World (ground truth geography)
// ---------------------------------------------------------------------------

export const enum Terrain {
  Water = 0,
  Ground = 1,
  Road = 2,
  Park = 3, // parks, forest, green space
  Building = 4,
}

export interface WorldMeta {
  name: string;
  bbox: [south: number, west: number, north: number, east: number];
  cellSizeM: number;
  width: number;
  height: number;
  source: 'osm' | 'procedural';
}

export interface World {
  meta: WorldMeta;
  terrain: Uint8Array; // Terrain enum per cell
  elevation: Float32Array; // metres above sea level (water ~0)
  buildingHeight: Float32Array; // metres, 0 if no building
  population: Float32Array; // estimated residents per cell (prior, not truth)
  coastDistance: Float32Array; // cells to nearest water cell (0 for water)
  base: { x: number; y: number }; // drone launch / recharge site
}

// On-disk JSON shape (public/world.json). Loader converts arrays to typed arrays.
export interface WorldJSON {
  meta: WorldMeta;
  terrain: number[];
  elevation: number[];
  buildingHeight: number[];
  population: number[];
  base: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Simulation config
// ---------------------------------------------------------------------------

export interface Weights {
  population: number;
  hazard: number;
  urgency: number;
  information: number;
  distance: number;
  battery: number;
  redundancy: number;
}

export interface InfoModes {
  geography: boolean; // terrain/buildings/roads known up front
  population: boolean; // population prior available
  elevation: boolean; // elevation known up front
  disaster: boolean; // hazard + urgency available (requires scenario)
}

export type Scenario = 'none' | 'tsunami';

export interface SimConfig {
  seed: number;
  droneCount: number;
  sensorRange: number; // cells
  batteryCapacity: number; // cells of travel on a full charge
  speed: number; // cells per simulated second
  survivorCount: number;
  info: InfoModes;
  scenario: Scenario;
  tsunamiImpactTime: number; // simulated seconds until the wave arrives
  tsunamiRunupM: number; // elevation below which cells flood on impact
  weights: Weights;
}

// ---------------------------------------------------------------------------
// Simulation state exposed to the renderer / UI (read-only views)
// ---------------------------------------------------------------------------

export type DroneStatus =
  | 'IDLE'
  | 'TRAVELLING'
  | 'SEARCHING'
  | 'RETURNING'
  | 'LOW_BATTERY'
  | 'DISABLED';

export interface DroneView {
  id: number;
  x: number; // float cell coords (cell centre = integer + 0.5)
  y: number;
  heading: number; // radians, 0 = east, PI/2 = south (grid +y)
  status: DroneStatus;
  battery: number; // 0..1
  sensorRange: number; // cells
  path: { x: number; y: number }[]; // remaining planned waypoints (cell coords)
  trail: { x: number; y: number }[]; // recent history, capped (e.g. last 300 points)
  taskId: number | null;
  distanceTravelled: number; // cells
}

export interface TaskView {
  id: number;
  x0: number; // inclusive cell rect
  y0: number;
  x1: number; // exclusive
  y1: number;
  priority: number; // normalized 0..1 among current tasks
  breakdown: Partial<Record<keyof Weights | 'rescue', number>>; // normalized term values 0..1
  assignedDrone: number | null;
  searchedFrac: number; // 0..1
  isFrontier: boolean;
}

export interface SurvivorView {
  id: number;
  x: number;
  y: number;
  found: boolean;
  foundBy: number | null;
  foundAt: number | null; // sim time
  lost: boolean; // e.g. flooded before being found
}

export interface Metrics {
  time: number;
  areaSearchedFrac: number; // of searchable (non-water) cells
  survivorsFound: number;
  survivorsTotal: number;
  survivorsLost: number;
  populationReached: number; // sum of population prior over searched cells
  populationTotal: number;
  droneUtilization: number; // fraction of drone-time spent TRAVELLING/SEARCHING
  redundancyFrac: number; // fraction of sensor observations on already-searched cells
  distanceTravelled: number; // cells, whole fleet
  batteryConsumed: number; // in full-charge units
  tasksCompleted: number;
  tasksReassigned: number;
  droneFailures: number;
  complete: boolean;
}

export interface FloodState {
  timeToImpact: number; // seconds, <= 0 once impacted
  impacted: boolean;
  runupM: number;
}

export type SimEventType =
  | 'assign'
  | 'reassign'
  | 'replan'
  | 'survivor'
  | 'failure'
  | 'lowBattery'
  | 'recharged'
  | 'taskComplete'
  | 'impact'
  | 'complete';

export interface SimEvent {
  t: number;
  type: SimEventType;
  droneId?: number;
  taskId?: number;
  message: string; // human-readable, shown in the decision log
}

export interface KnowledgeView {
  known: Uint8Array; // 1 if geography of cell is known to the fleet
  searched: Float32Array; // 0..1 search confidence
  frontier: Uint8Array; // 1 if cell is on the search frontier
  hazard: Float32Array | null; // 0..1 known hazard (null when disaster info off)
}

export interface SimState {
  time: number;
  running: boolean;
  config: SimConfig;
  knowledge: KnowledgeView;
  drones: DroneView[];
  tasks: TaskView[];
  survivors: SurvivorView[]; // ground truth; renderer shows found ones (all in debug)
  flood: FloodState | null;
  metrics: Metrics;
}

// Implemented by src/sim/Simulation.ts
export interface ISimulation {
  readonly state: SimState;
  step(dt: number): void; // advance by dt simulated seconds
  drainEvents(): SimEvent[];
  drainDirtyCells(): number[]; // cell indices whose knowledge changed since last drain
  disableDrone(id?: number): number | null; // random active drone if id omitted
  updateConfig(partial: Partial<SimConfig>): void; // weights/info modes apply live; others on reset
}
