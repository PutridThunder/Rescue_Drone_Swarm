import { Terrain } from "../shared/terrain";
import type { CrowdOptions, CrowdView } from "../types";
import { CROWD_PEOPLE, CROWD_RADIUS, CROWD_SURVIVORS, POPULATION_FLOOR_SHARE } from "./constants";
import type { SimContext } from "./context";
import { messages } from "./messages";

/**
 * What the fleet believes about where people are: the population estimate (plus crowds the user
 * reports) and the crowd-intel prediction. Crowds also put real survivors on the ground.
 */
export class PopulationPriors {
  /** Population estimate per cell (world copy; user crowds add to it). Used when population intel is on. */
  readonly population: Float32Array;
  /** Predicted people per cell from crowd intel. Used when crowd intel is on. */
  readonly predicted: Float32Array;
  /** Without population intel, this many people per cell are assumed everywhere. */
  readonly floor: number;
  /** Population over all searchable cells at the start. */
  readonly initialTotal: number;
  private nextCrowdId = 1;

  constructor(private readonly ctx: SimContext) {
    this.population = Float32Array.from(ctx.world.population);
    this.predicted = new Float32Array(ctx.N);
    let total = 0;
    let searchable = 0;
    for (let i = 0; i < ctx.N; i++) {
      if (!ctx.isSearchable(i)) continue;
      searchable++;
      total += this.population[i];
    }
    ctx.stats.searchableCells = searchable;
    this.initialTotal = total;
    this.floor = searchable > 0 ? (POPULATION_FLOOR_SHARE * total) / searchable : 0;
  }

  /**
   * Add a crowd. User crowds are a reported gathering (population prior); intel crowds are
   * predicted by crowd intel. Either way, `survivors` people are really there to be found.
   */
  addCrowd(x: number, y: number, opts: CrowdOptions = {}): CrowdView | null {
    const { ctx } = this;
    const i = ctx.cellIndex(x, y);
    if (i < 0 || ctx.world.terrain[i] === Terrain.Water) return null;
    const { people = CROWD_PEOPLE, radius = CROWD_RADIUS, survivors = CROWD_SURVIVORS, source = "user" } = opts;
    const cells = ctx.searchableCellsAround(x, y, radius);
    if (cells.length === 0) return null;
    const prior = source === "intel" ? this.predicted : this.population;
    for (const j of cells) prior[j] += people / cells.length;

    const crowd: CrowdView = { id: this.nextCrowdId++, x, y, radius, people, source, label: opts.label };
    ctx.state.crowds.push(crowd);
    if (source === "user") ctx.state.metrics.populationTotal += people; // a prediction isn't extra population
    for (let k = 0; k < survivors; k++) {
      const j = cells[ctx.rng.int(cells.length)];
      const s = ctx.survivors.add((j % ctx.W) + ctx.rng.range(0.2, 0.8), Math.floor(j / ctx.W) + ctx.rng.range(0.2, 0.8));
      if (s && source === "intel") s.placed = false; // part of the scenario, not a user marker
    }

    const place = opts.label ?? ctx.sectors.at(x, y).view.label;
    const info = ctx.state.config.info;
    const usedNow = source === "intel" ? info.crowds : info.population;
    if (!ctx.state.metrics.complete && usedNow) {
      ctx.replan.request(`crowd ${source === "intel" ? "predicted" : "reported"} at ${place}`, true);
    }
    if (source === "user") ctx.log.emit("placed", messages.crowdReported(people, place));
    return crowd;
  }

  /** Remove user crowds within sqrt(r2) cells, restoring the population estimate. Returns how many. */
  removeUserCrowdsNear(x: number, y: number, r2: number): number {
    const { ctx } = this;
    const crowds = ctx.state.crowds;
    let removed = 0;
    for (let k = crowds.length - 1; k >= 0; k--) {
      const c = crowds[k];
      if (c.source !== "user" || (c.x - x) ** 2 + (c.y - y) ** 2 > r2) continue;
      const cells = ctx.searchableCellsAround(c.x, c.y, c.radius);
      for (const j of cells) this.population[j] = Math.max(ctx.world.population[j], this.population[j] - c.people / cells.length);
      ctx.state.metrics.populationTotal -= c.people;
      crowds.splice(k, 1);
      removed++;
    }
    return removed;
  }
}
