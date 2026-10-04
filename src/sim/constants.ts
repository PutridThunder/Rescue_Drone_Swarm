// Tuning constants for the simulation, grouped by subsystem. Units are grid cells (10 m) and
// simulated seconds unless the name says otherwise.

// --- Search coverage ------------------------------------------------------------------------
/** A cell counts as searched once the fleet is this confident it would have seen someone there. */
export const SEARCHED_THRESHOLD = 0.8;
/** Searched confidence above which a re-observation is counted as duplicate work. */
export const REDUNDANT_ABOVE = 0.9;
/** Re-observing a cell after this many seconds counts as a new visit (for redundancy stats). */
export const REVISIT_GAP = 5;
/** Scales the per-observation confidence gain into a survivor detection probability. */
export const DETECT_PROB = 0.97;
/** Looking at a high-rise from the street is less thorough than overflying a roof. */
export const FACADE_GAIN = 0.6;
/** Thermal cameras see through tree canopy poorly (ESA WorldCover "tree cover" cells). */
export const CANOPY_GAIN = 0.55;
/** Knowledge changes are reported to the renderer in steps of 1/16 confidence. */
export const DIRTY_STEPS = 16;

// --- Flight ---------------------------------------------------------------------------------
/** Drones keep this much vertical space above rooftops (metres). */
export const ROOF_CLEARANCE_M = 3;
/** Movement per simulation sub-step, so sensing never skips cells. */
export const MAX_SUBSTEP_CELLS = 0.5;
/** Battery drained per second just to stay airborne (cells of travel). */
export const HOVER_DRAIN = 0.15;
/** Seconds to recharge from empty to full on a truck. */
export const CHARGE_TIME = 4;
/** Battery fraction treated as "full" when landing (no charge needed). */
export const FULL_BATTERY = 0.98;
/** Only announce a recharge if the drone came in below this battery fraction. */
export const ANNOUNCE_RECHARGE_BELOW = 0.8;
/** Below this battery share a drone always heads to a truck, however close it is. */
export const RECALL_BATTERY = 0.2;
/** Reserve kept for the trip home: a fixed part plus a share of capacity. */
export const RESERVE_BASE_CELLS = 3;
export const RESERVE_CAPACITY_SHARE = 0.04;
/** Hazard cells cost this much extra per step in path planning. */
export const HAZARD_PATH_COST = 0.5;
/** Straight-line shortcut (no A*) is allowed for targets closer than this. */
export const DIRECT_FLIGHT_RANGE = 12;

// --- In-block sweep -------------------------------------------------------------------------
/** Lawnmower lanes: spacing as a share of sensor range (camera confidence fades toward the edge). */
export const LANE_SPACING_SHARE = 1.25;
/** Distance between waypoints along a lane (cells). */
export const LANE_STEP = 3;
/** A waypoint is skipped when every cell within this radius is already searched. */
export const LANE_SKIP_RADIUS = 2;
/** Ignore candidate cells closer than this (the drone is already there). */
export const SWEEP_MIN_DIST = 0.7;
/** Sweep score = dist * (SWEEP_TURN_BASE - SWEEP_TURN_WEIGHT * cos(turn)): prefer going straight. */
export const SWEEP_TURN_BASE = 1.6;
export const SWEEP_TURN_WEIGHT = 0.6;
/** Entry-point attempts before a block is considered unreachable for now. */
export const ENTRY_ATTEMPTS = 4;
/** Penalty that makes already-searched cells the last choice as a block entry point. */
export const SEARCHED_ENTRY_PENALTY = 1000;

// --- Planning and allocation ----------------------------------------------------------------
/** Seconds between routine replans (events trigger extra replans). */
export const REPLAN_INTERVAL = 1.5;
/** Replan shortly after a drone lands, so it can be re-tasked. */
export const DOCK_REPLAN_DELAY = 0.25;
/** Bonus that keeps a drone on its current block instead of chasing fresher neighbours. */
export const HYSTERESIS = 0.15;
/** Bonus for a block abandoned by a failed or recalled drone, so it is picked up promptly. */
export const RELEASED_BONUS = 0.4;
/** Redundancy kernel radius (cells): nearby assignments discourage clustering. */
export const SPREAD_RADIUS = 25;
/** Estimated sweep cost of a block: unsearched cells / (SWEEP_EFFICIENCY * sensor range). */
export const SWEEP_EFFICIENCY = 1.4;
/** Finish once every survivor is found or lost and at least this share of the area is searched. */
export const COMPLETE_COVERAGE = 0.8;
/** Survivor found: priority boost for its block and the 8 neighbouring blocks (survivors cluster). */
export const FOUND_BOOST_SELF = 0.6;
export const FOUND_BOOST_NEIGHBOUR = 0.35;
/** Tsunami time pressure ramps from this base up to 1 as impact approaches. */
export const TIME_PRESSURE_BASE = 0.5;
/** Without population intel, this share of the mean population is assumed everywhere. */
export const POPULATION_FLOOR_SHARE = 0.1;

// --- Trucks ---------------------------------------------------------------------------------
/** Truck speed relative to drones. */
export const TRUCK_SPEED_FRAC = 0.35;
/** Seconds between truck repositioning decisions. */
export const TRUCK_REPLAN = 6;
/** Don't relocate a truck for less than this distance (cells). */
export const TRUCK_MOVE_MIN = 15;
/** Trucks start this many road cells apart along the network. */
export const TRUCK_SPACING = 60;
/** Drones land when within this distance of a truck. */
export const DOCK_DIST = 0.6;
/** Re-route to a moving truck once it is this far from the planned landing point. */
export const TRUCK_DRIFT = 1.5;
/** Repositioning: k-means iterations, and how strongly busy vs high-priority blocks pull trucks. */
export const KMEANS_ITERATIONS = 6;
export const ACTIVE_BLOCK_WEIGHT = 1.5;
export const PRIORITY_PULL_ABOVE = 0.5;

// --- Crowds (defaults for one planted by hand) -----------------------------------------------
export const CROWD_RADIUS = 3;
export const CROWD_PEOPLE = 60;
export const CROWD_SURVIVORS = 3;

// --- Street labels --------------------------------------------------------------------------
/** Look this many cells beyond a block's edge for street names. */
export const LABEL_MARGIN = 2;
