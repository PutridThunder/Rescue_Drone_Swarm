import type { Weights } from '../types';

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

export function emptyAgg(): SectorAgg {
  return { believed: 0, searchedFrac: 0, unsearched: 0, population: 0, hazard: 0, flood: 0, rescue: 0, frontier: false, boost: 0 };
}

/** Benefit terms, each normalized to 0..1 across the candidate set. */
export function computeTerms(aggs: SectorAgg[], ctx: TermContext): Terms[] {
  let maxPop = 0;
  let maxHaz = 0;
  let maxFlood = 0;
  let maxInfo = 0;
  let maxRescue = 0;
  const hazMean = new Float64Array(aggs.length);
  const info = new Float64Array(aggs.length);
  aggs.forEach((a, i) => {
    hazMean[i] = a.unsearched > 0 ? a.hazard / a.unsearched : 0;
    info[i] = a.unsearched * (a.frontier ? 1.25 : 1);
    maxPop = Math.max(maxPop, a.population);
    maxHaz = Math.max(maxHaz, hazMean[i]);
    maxFlood = Math.max(maxFlood, a.flood);
    maxInfo = Math.max(maxInfo, info[i]);
    maxRescue = Math.max(maxRescue, a.rescue);
  });
  return aggs.map((a, i) => ({
    population: norm(a.population, maxPop),
    hazard: ctx.useHazard ? norm(hazMean[i], maxHaz) : 0,
    urgency: ctx.useUrgency ? norm(a.flood, maxFlood) * ctx.timePressure : 0,
    information: norm(info[i], maxInfo),
    rescue: Math.min(1, norm(a.rescue, maxRescue) + a.boost),
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
