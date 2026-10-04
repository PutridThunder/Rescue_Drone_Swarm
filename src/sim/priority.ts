import type { Weights } from "../types";

/** Raw per-sector sums over not-yet-searched cells (weighted by remaining unsearched-ness). */
export interface SectorAgg {
  believed: number; // cells the fleet believes are searchable land
  searchedFrac: number;
  unsearched: number; // sum of (1 - confidence) over unsearched cells
  population: number; // prior population (or 1 per cell if no prior) x unsearched
  hazard: number; // known hazard x unsearched
  flood: number; // predicted-flood cells x unsearched
  rescue: number; // population x exposure x unsearched
  frontier: boolean;
  boost: number; // survivor-cluster boost 0..1
}

export interface Terms {
  population: number;
  hazard: number;
  urgency: number;
  information: number;
  rescue: number;
}

export interface TermContext {
  useHazard: boolean;
  useUrgency: boolean;
  timePressure: number; // 0..1, rises as impact approaches; 0 after impact
}

/** Blocks on the edge of explored space are worth a little more (they reveal the map). */
const FRONTIER_INFO = 1.25;

export function emptyAgg(): SectorAgg {
  return {
    believed: 0,
    searchedFrac: 0,
    unsearched: 0,
    population: 0,
    hazard: 0,
    flood: 0,
    rescue: 0,
    frontier: false,
    boost: 0,
  };
}

/**
 * Benefit terms, each normalized to 0..1 across the candidate set.
 *
 * Terms are densities (per unsearched cell), i.e. value per second of searching. Totals would
 * make a half-searched block look half as valuable as a fresh one, so the fleet would skip the
 * blocks its cameras already brushed and leave a checkerboard of gaps to fly back to later.
 */
export function computeTerms(aggs: SectorAgg[], ctx: TermContext): Terms[] {
  const per = (value: number, a: SectorAgg) => (a.unsearched > 0 ? value / a.unsearched : 0);
  const pop = aggs.map((a) => per(a.population, a));
  const haz = aggs.map((a) => per(a.hazard, a));
  const flood = aggs.map((a) => per(a.flood, a));
  const rescue = aggs.map((a) => per(a.rescue, a));
  const info = aggs.map((a) => (a.unsearched > 0 ? (a.frontier ? FRONTIER_INFO : 1) : 0));
  const max = (xs: number[]) => xs.reduce((m, x) => Math.max(m, x), 0);
  const [maxPop, maxHaz, maxFlood, maxRescue, maxInfo] = [pop, haz, flood, rescue, info].map(max);
  return aggs.map((a, i) => ({
    population: norm(pop[i], maxPop),
    hazard: ctx.useHazard ? norm(haz[i], maxHaz) : 0,
    urgency: ctx.useUrgency ? norm(flood[i], maxFlood) * ctx.timePressure : 0,
    information: norm(info[i], maxInfo),
    rescue: Math.min(1, norm(rescue[i], maxRescue) + a.boost),
  }));
}

/** There is no dedicated rescue weight; expected rescue value rides on population + hazard. */
export function rescueWeight(w: Weights): number {
  return 0.5 * (w.population + w.hazard);
}

export function benefit(t: Terms, w: Weights): number {
  return (
    w.population * t.population +
    w.hazard * t.hazard +
    w.urgency * t.urgency +
    w.information * t.information +
    rescueWeight(w) * t.rescue
  );
}

/** Benefit scores scaled so the best candidate is 1. */
export function normalizedPriorities(terms: Terms[], w: Weights): number[] {
  const b = terms.map((t) => benefit(t, w));
  const max = Math.max(1e-9, ...b);
  return b.map((v) => Math.max(0, v) / max);
}

function norm(v: number, max: number): number {
  return max > 1e-9 ? v / max : 0;
}
