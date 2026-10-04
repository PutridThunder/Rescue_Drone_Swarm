import { Terrain } from "../shared/terrain";
import type { SurvivorView } from "../types";
import { CANOPY_GAIN, DETECT_PROB, DIRTY_STEPS, FACADE_GAIN, REDUNDANT_ABOVE, REVISIT_GAP, SEARCHED_THRESHOLD } from "./constants";
import { LandCover } from "../world/earthObservation";
import type { SimContext } from "./context";
import type { Drone } from "./drone";
import { buildSensorDisc, type SensorDisc } from "./knowledge";
import { messages } from "./messages";

/**
 * A drone's camera: each time it enters a new cell it observes a disc of cells around it, unless
 * a high-rise blocks the line of sight. Observations reveal geography, build search confidence,
 * and may detect survivors.
 */
export class Sensor {
  private readonly disc: SensorDisc;
  /** Set when an observation reveals a new obstacle; paths are re-checked after the sub-step. */
  obstacleDiscovered = false;

  /** Cells under tree canopy (from satellite land cover), if available. */
  private readonly canopy: Uint8Array | null;

  constructor(private readonly ctx: SimContext) {
    this.disc = buildSensorDisc(ctx.cfg.sensorRange);
    const cover = ctx.world.eo?.landCover;
    this.canopy = cover ? Uint8Array.from(cover, (c) => (c === LandCover.Trees ? 1 : 0)) : null;
  }

  observe(d: Drone) {
    const { ctx } = this;
    const { dx, dy, gain } = this.disc;
    const k = ctx.knowledge;
    const { known, searched, lastObsT, lastObsDrone } = k;
    const { tall, hidden } = ctx.masks;
    const { W, H, stats } = ctx;
    const t = ctx.state.time;
    const cx = Math.floor(d.x);
    const cy = Math.floor(d.y);

    for (let j = 0; j < dx.length; j++) {
      const x = cx + dx[j];
      const y = cy + dy[j];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (hidden[i] || this.lineBlocked(cx, cy, j)) continue;

      if (!known[i]) {
        known[i] = 1;
        k.markDirty(i);
        if (tall[i]) {
          ctx.navBlocked[i] = 1;
          this.obstacleDiscovered = true;
        }
      }
      const before = searched[i];
      const p = gain[j] * (tall[i] ? FACADE_GAIN : 1) * (this.canopy?.[i] ? CANOPY_GAIN : 1);
      const after = before + (1 - before) * p;
      searched[i] = after;
      if (((before * DIRTY_STEPS) | 0) !== ((after * DIRTY_STEPS) | 0)) k.markDirty(i);
      if (ctx.world.terrain[i] === Terrain.Water) continue;

      if (lastObsDrone[i] !== d.id || t - lastObsT[i] > REVISIT_GAP) {
        stats.visits++;
        if (before > REDUNDANT_ABOVE) stats.redundantVisits++;
      }
      lastObsDrone[i] = d.id;
      lastObsT[i] = t;
      if (before < SEARCHED_THRESHOLD && after >= SEARCHED_THRESHOLD) {
        stats.searchedCells++;
        d.cellsSearched++;
        stats.populationReached += ctx.priors.population[i];
      }
      const here = ctx.survivors.at(i);
      if (here) this.detect(here, p, d);
    }
  }

  /** True if a high-rise sits between the drone's cell and disc offset `j`. */
  private lineBlocked(cx: number, cy: number, j: number): boolean {
    const { rayStart, rayX, rayY } = this.disc;
    const { W, H } = this.ctx;
    const { tall } = this.ctx.masks;
    for (let r = rayStart[j]; r < rayStart[j + 1]; r++) {
      const rx = cx + rayX[r];
      const ry = cy + rayY[r];
      if (rx >= 0 && ry >= 0 && rx < W && ry < H && tall[ry * W + rx]) return true;
    }
    return false;
  }

  /** Each observation of a survivor's cell may find them, in proportion to the confidence gained. */
  private detect(survivors: SurvivorView[], p: number, d: Drone) {
    const { ctx } = this;
    for (const s of survivors) {
      if (s.found || s.lost) continue;
      if (ctx.rng.next() >= p * DETECT_PROB) continue;
      s.found = true;
      s.foundBy = d.id;
      s.foundAt = ctx.state.time;
      ctx.state.metrics.survivorsFound++;
      const block = ctx.sectors.boostAround(s.x, s.y);
      ctx.log.emit("survivor", messages.survivorFound(d.id, block.view.label), d.id, block.id);
      ctx.replan.request(`survivor found near ${block.view.label}`);
    }
  }
}
