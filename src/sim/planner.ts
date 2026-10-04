import type { Weights } from "../types";
import { allocate, type AllocDrone, type AllocTask, type Assignment } from "./allocation";
import {
  COMPLETE_COVERAGE,
  HYSTERESIS,
  RECALL_BATTERY,
  RELEASED_BONUS,
  SPREAD_RADIUS,
  SWEEP_EFFICIENCY,
  TIME_PRESSURE_BASE,
} from "./constants";
import type { SimContext } from "./context";
import type { Drone } from "./drone";
import { updateFrontier } from "./frontier";
import { messages } from "./messages";
import { computeTerms, normalizedPriorities, rescueWeight, type SectorAgg, type Terms } from "./priority";
import { clamp01 } from "./scenario";
import { insideSector, SECTOR_DONE, type Sector } from "./tasks";

interface Change {
  drone: Drone;
  from: number | null;
  to: number | null;
  takeoverFrom?: number;
}

interface Scored {
  candidates: Sector[];
  aggs: SectorAgg[];
  terms: Terms[];
  priorities: number[];
}

/**
 * The fleet's decision loop: refresh the frontier, score every block that still needs searching,
 * auction blocks to available drones, and announce what changed and why.
 */
export class Planner {
  constructor(private readonly ctx: SimContext) {}

  replan() {
    const { ctx } = this;
    const { reasons, announce } = ctx.replan.take();
    ctx.mission.updateMetrics();
    updateFrontier(ctx.knowledge, ctx.world.terrain, ctx.W, ctx.H, ctx.masks.hidden);

    const { candidates, aggs } = this.collectCandidates();
    ctx.sectors.pruneReleased(candidates);
    const st = ctx.state;
    const allResolved = st.survivors.every((s) => s.found || s.lost);
    if (candidates.length === 0 || (allResolved && st.metrics.areaSearchedFrac >= COMPLETE_COVERAGE)) {
      st.tasks.length = 0;
      ctx.mission.finish();
      return;
    }

    const scored = this.score(candidates, aggs);
    const available = ctx.fleet.filter(
      (d) =>
        d.active &&
        !d.charging &&
        !(d.airborne && d.battery < RECALL_BATTERY) && // low drones fly home first
        (d.status === "IDLE" || d.status === "TRAVELLING" || d.status === "SEARCHING" || d.status === "RETURNING"),
    );
    const assignments = this.auction(available, scored);
    const { changes, distance } = this.applyAssignments(available, assignments, scored);

    if (reasons.length && (changes.length || announce)) {
      ctx.log.emit("replan", messages.replanned(reasons, changes.length, candidates.length));
    }
    for (const c of changes) this.announce(c, scored, distance.get(c.drone.id) ?? 0);
  }

  /** Blocks that still need searching, with their aggregated priority inputs. */
  private collectCandidates(): { candidates: Sector[]; aggs: SectorAgg[] } {
    const candidates: Sector[] = [];
    const aggs: SectorAgg[] = [];
    for (const s of this.ctx.sectors.list) {
      const agg = this.ctx.sectors.aggregate(s);
      s.view.searchedFrac = agg.searchedFrac;
      s.view.isFrontier = agg.frontier;
      s.view.assignedDrone = null;
      if (!s.exhausted && agg.believed > 0 && agg.searchedFrac < SECTOR_DONE) {
        candidates.push(s);
        aggs.push(agg);
      }
    }
    return { candidates, aggs };
  }

  /** Priority of each candidate block; publishes them as state.tasks for the UI. */
  private score(candidates: Sector[], aggs: SectorAgg[]): Scored {
    const { ctx } = this;
    const flood = ctx.state.flood;
    const hazardOn = ctx.knowledge.view.hazard !== null;
    const beforeImpact = !!flood && !flood.impacted;
    const terms = computeTerms(aggs, {
      useHazard: hazardOn,
      useUrgency: hazardOn && beforeImpact,
      timePressure: beforeImpact
        ? TIME_PRESSURE_BASE + (1 - TIME_PRESSURE_BASE) * clamp01(1 - flood!.timeToImpact / ctx.cfg.tsunamiImpactTime)
        : 0,
    });
    const priorities = normalizedPriorities(terms, ctx.state.config.weights);
    const tasks = ctx.state.tasks;
    tasks.length = 0;
    candidates.forEach((s, i) => {
      s.view.priority = priorities[i];
      s.view.breakdown = { ...terms[i] };
      tasks.push(s.view);
    });
    return { candidates, aggs, terms, priorities };
  }

  private auction(available: Drone[], { candidates, aggs, priorities }: Scored): Assignment[] {
    const { ctx } = this;
    const drones: AllocDrone[] = available.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      battery: d.batteryCells,
      task: d.taskId,
      commitment: d.commitment,
    }));
    const tasks: AllocTask[] = candidates.map((s, i) => ({
      id: s.id,
      cx: s.cx,
      cy: s.cy,
      // An abandoned block keeps the priority it was assigned at, so someone finishes it.
      priority: Math.max(priorities[i], ctx.sectors.releasedPriorityOf(s.id)),
      searchCost: aggs[i].unsearched / (SWEEP_EFFICIENCY * ctx.cfg.sensorRange),
      released: ctx.sectors.isReleased(s.id),
    }));
    return allocate(drones, tasks, {
      weights: ctx.state.config.weights,
      diag: Math.hypot(ctx.W, ctx.H),
      capacity: ctx.cfg.batteryCapacity,
      homes: ctx.depot.trucks,
      hysteresis: HYSTERESIS,
      releasedBonus: RELEASED_BONUS,
      spread: SPREAD_RADIUS,
      margin: ctx.pilot.batteryReserve,
    });
  }

  /** Re-task drones whose assignment changed; record takeovers of handed-back blocks. */
  private applyAssignments(available: Drone[], assignments: Assignment[], { candidates, priorities }: Scored) {
    const { ctx } = this;
    const metrics = ctx.state.metrics;
    const owner = new Map<number, number>();
    for (const d of ctx.fleet) if (d.taskId != null) owner.set(d.taskId, d.id);
    const byDrone = new Map(assignments.map((a) => [a.droneId, a]));
    const changes: Change[] = [];
    const distance = new Map<number, number>();

    for (const d of available) {
      const a = byDrone.get(d.id);
      if (a) {
        const b = ctx.sectors.get(a.taskId).view.breakdown;
        b.distance = a.distCost;
        b.battery = a.battCost;
        b.redundancy = a.redundancy;
        distance.set(d.id, a.distance);
      }
      const to = a ? a.taskId : null;
      if (to === d.taskId) {
        if (to == null && d.status === "RETURNING") continue;
        if (to != null || d.dockedTruck !== null) continue;
      }
      d.commitment = to != null ? priorities[candidates.indexOf(ctx.sectors.get(to))] : 0;
      const change: Change = { drone: d, from: d.taskId, to };
      d.taskId = to;
      if (to == null) {
        if (d.dockedTruck !== null) {
          d.status = "IDLE";
          d.path = [];
        } else {
          d.status = "RETURNING";
          ctx.nav.pathToTruck(d);
        }
      } else {
        const s = ctx.sectors.get(to);
        if (insideSector(s, d.x, d.y)) {
          d.status = "SEARCHING";
          d.path = [];
        } else {
          d.status = "TRAVELLING";
          ctx.nav.pathToSector(d, s);
        }
        const releasedBy = ctx.sectors.releasedBy(to);
        const prevOwner = owner.get(to);
        if (releasedBy !== undefined) {
          ctx.sectors.clearRelease(to);
          change.takeoverFrom = releasedBy;
          metrics.tasksReassigned++;
        } else if (prevOwner !== undefined && prevOwner !== d.id) {
          change.takeoverFrom = prevOwner;
          metrics.tasksReassigned++;
        }
      }
      if (change.from !== change.to) changes.push(change); // heading home without a task isn't a re-task
    }
    for (const d of ctx.fleet) if (d.active && d.taskId != null) ctx.sectors.get(d.taskId).view.assignedDrone = d.id;
    return { changes, distance };
  }

  /** Explain an assignment in the decision feed: the two strongest reasons plus the distance. */
  private announce(c: Change, { candidates, terms, priorities }: Scored, distanceCells: number) {
    const { ctx } = this;
    const d = c.drone;
    if (c.to == null) {
      if (c.from != null) ctx.log.emit("reassign", messages.nothingInRange(d.id), d.id);
      return;
    }
    const s = ctx.sectors.get(c.to);
    const idx = candidates.indexOf(s);
    const reasons = topReasons(terms[idx], ctx.state.config.weights);
    let msg = messages.assignment(d.id, s.view.label, priorities[idx], reasons, distanceCells, ctx.world.meta.cellSizeM);
    if (c.takeoverFrom !== undefined) msg += messages.takingOver(c.takeoverFrom);
    else if (c.from != null) msg += messages.switchingFrom(ctx.sectors.get(c.from).view.label);
    ctx.log.emit(c.from == null && c.takeoverFrom === undefined ? "assign" : "reassign", msg, d.id, s.id);
  }
}

/** The two weighted terms that contributed most to a block's priority, e.g. "population 0.94". */
function topReasons(t: Terms, w: Weights): string[] {
  const contributions: [string, number, number][] = [
    ["urgency", w.urgency * t.urgency, t.urgency],
    ["hazard", w.hazard * t.hazard, t.hazard],
    ["population", w.population * t.population, t.population],
    ["rescue value", rescueWeight(w) * t.rescue, t.rescue],
    ["unsearched", w.information * t.information, t.information],
  ];
  return contributions
    .filter((x) => x[1] > 0.01)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, , v]) => `${name} ${v.toFixed(2)}`);
}
