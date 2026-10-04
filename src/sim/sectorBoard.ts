import { FOUND_BOOST_NEIGHBOUR, FOUND_BOOST_SELF, LABEL_MARGIN, SEARCHED_THRESHOLD } from "./constants";
import type { SimContext } from "./context";
import { emptyAgg, type SectorAgg } from "./priority";
import { buildSectors, sectorAt, type Sector } from "./tasks";

/**
 * The map divided into search blocks ("sectors", 10 x 10 cells): their street-name labels, how
 * much of each is searched and how valuable the rest is, and blocks handed back by drones.
 */
export class SectorBoard {
  readonly list: Sector[];
  private readonly cols: number;
  /** Block id -> drone that handed it back (failed or recalled). */
  private readonly released = new Map<number, number>();
  /** Block id -> priority it was assigned at, so someone finishes it. */
  private readonly releasedPriority = new Map<number, number>();

  constructor(private readonly ctx: SimContext) {
    const { sectors, cols } = buildSectors(ctx.W, ctx.H);
    this.list = sectors;
    this.cols = cols;
    for (const s of sectors) s.view.label = this.streetLabel(s) ?? `Block ${s.name}`;
  }

  get(id: number): Sector {
    return this.list[id];
  }

  at(x: number, y: number): Sector {
    return this.list[sectorAt(x, y, this.cols)];
  }

  /** Visit every cell of a block that counts toward its coverage, row by row. */
  forEachCoverageCell(s: Sector, visit: (i: number, x: number, y: number) => void) {
    const { ctx } = this;
    for (let y = s.y0; y < s.y1; y++) {
      for (let x = s.x0; x < s.x1; x++) {
        const i = y * ctx.W + x;
        if (ctx.countsForCoverage(i)) visit(i, x, y);
      }
    }
  }

  searchedFrac(s: Sector): number {
    const { searched } = this.ctx.knowledge;
    let believed = 0;
    let done = 0;
    this.forEachCoverageCell(s, (i) => {
      believed++;
      if (searched[i] >= SEARCHED_THRESHOLD) done++;
    });
    return believed > 0 ? done / believed : 1;
  }

  /** Sum the priority inputs (population, hazard, urgency, rescue value...) over a block's unsearched cells. */
  aggregate(s: Sector): SectorAgg {
    const { ctx } = this;
    const agg = emptyAgg();
    const { searched, frontier } = ctx.knowledge;
    const hazard = ctx.knowledge.view.hazard;
    const { population, predicted, floor } = ctx.priors;
    const info = ctx.state.config.info;
    const { floodMask, floodProne } = ctx.tsunami;
    const impacted = !!ctx.state.flood?.impacted;
    let done = 0;
    this.forEachCoverageCell(s, (i) => {
      agg.believed++;
      if (frontier[i]) agg.frontier = true;
      const sv = searched[i];
      if (sv >= SEARCHED_THRESHOLD) {
        done++;
        return;
      }
      const u = 1 - sv;
      agg.unsearched += u;
      const live = impacted && floodMask![i] ? 0 : 1; // nobody left to save in a flooded cell
      const pop = (info.population ? population[i] : 1) + (info.crowds ? predicted[i] : 0);
      const hz = hazard ? hazard[i] : 0;
      agg.population += pop * u * live;
      agg.hazard += hz * u * live;
      if (!impacted && floodProne[i]) agg.flood += u * (info.population ? population[i] + floor : 1);
      agg.rescue += pop * (hazard ? 0.25 + hz : 1) * u * live;
    });
    agg.searchedFrac = agg.believed > 0 ? done / agg.believed : 1;
    agg.boost = s.boost;
    return agg;
  }

  /** A survivor was found at (x, y): survivors cluster, so raise this block and its neighbours. */
  boostAround(x: number, y: number): Sector {
    const centre = this.at(x, y);
    for (const o of this.list) {
      const dc = Math.abs(o.col - centre.col);
      const dr = Math.abs(o.row - centre.row);
      if (dc <= 1 && dr <= 1) o.boost = Math.min(1, o.boost + (dc === 0 && dr === 0 ? FOUND_BOOST_SELF : FOUND_BOOST_NEIGHBOUR));
    }
    return centre;
  }

  // --- Blocks handed back by a failed or recalled drone ------------------------------------

  release(id: number, droneId: number, assignedPriority: number) {
    this.list[id].view.assignedDrone = null;
    this.released.set(id, droneId);
    this.releasedPriority.set(id, assignedPriority);
  }

  releasedBy(id: number): number | undefined {
    return this.released.get(id);
  }

  isReleased(id: number): boolean {
    return this.released.has(id);
  }

  releasedPriorityOf(id: number): number {
    return this.releasedPriority.get(id) ?? 0;
  }

  clearRelease(id: number) {
    this.released.delete(id);
    this.releasedPriority.delete(id);
  }

  /** Forget hand-backs for blocks that no longer need searching. */
  pruneReleased(stillOpen: Sector[]) {
    for (const id of this.released.keys()) if (!stillOpen.some((c) => c.id === id)) this.clearRelease(id);
  }

  /** "Lonsdale Ave & W 3rd St" from the two most common street names in and around the block. */
  private streetLabel(s: Sector): string | null {
    const { roadName, roadNames } = this.ctx.world;
    if (!roadNames.length) return null;
    const { W, H } = this.ctx;
    const counts = new Map<number, number>();
    for (let y = Math.max(0, s.y0 - LABEL_MARGIN); y < Math.min(H, s.y1 + LABEL_MARGIN); y++) {
      for (let x = Math.max(0, s.x0 - LABEL_MARGIN); x < Math.min(W, s.x1 + LABEL_MARGIN); x++) {
        const n = roadName[y * W + x];
        if (n >= 0) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (top.length === 0) return null;
    if (top.length === 1) return roadNames[top[0][0]];
    return `${roadNames[top[0][0]]} & ${roadNames[top[1][0]]}`;
  }
}
