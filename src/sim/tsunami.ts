import type { FloodState } from "../types";
import type { SimContext } from "./context";
import { messages } from "./messages";
import { computeFloodMask, computeHazardTruth } from "./scenario";

/** Tsunami scenario: the true hazard and flood zone, the countdown, and the impact itself. */
export class Tsunami {
  /** True hazard per cell (null without a tsunami). The fleet only sees an estimate of it. */
  readonly hazardTruth: Float32Array | null;
  /** Cells that flood at impact (null without a tsunami). */
  readonly floodMask: Uint8Array | null;
  /** Cells the fleet believes will flood (set from hazard intel). */
  readonly floodProne: Uint8Array;
  /** Survivors found before impact (null until impact). */
  foundBeforeImpact: number | null = null;

  constructor(private readonly ctx: SimContext) {
    const { world, cfg } = ctx;
    const active = cfg.scenario === "tsunami";
    this.hazardTruth = active ? computeHazardTruth(world, cfg.tsunamiRunupM) : null;
    this.floodMask = active ? computeFloodMask(world, cfg.tsunamiRunupM) : null;
    this.floodProne = new Uint8Array(ctx.N);
  }

  initialFloodState(): FloodState | null {
    const { cfg } = this.ctx;
    return this.floodMask ? { timeToImpact: cfg.tsunamiImpactTime, impacted: false, runupM: cfg.tsunamiRunupM } : null;
  }

  /** Advance the countdown; strikes when it reaches zero. */
  tick() {
    const flood = this.ctx.state.flood;
    if (!flood) return;
    flood.timeToImpact = this.ctx.cfg.tsunamiImpactTime - this.ctx.state.time;
    if (!flood.impacted && flood.timeToImpact <= 0) this.strike();
  }

  /** Flood the low coast: unfound survivors there are lost, and the fleet re-plans around it. */
  private strike() {
    const { ctx } = this;
    const st = ctx.state;
    const flood = st.flood!;
    const mask = this.floodMask!;
    flood.impacted = true;
    let lost = 0;
    for (const s of st.survivors) {
      if (!s.found && !s.lost && mask[Math.floor(s.y) * ctx.W + Math.floor(s.x)]) {
        s.lost = true;
        lost++;
      }
    }
    let cells = 0;
    for (let i = 0; i < ctx.N; i++) cells += mask[i];
    st.metrics.survivorsLost += lost;
    this.foundBeforeImpact = st.metrics.survivorsFound;
    const areaKm2 = ((cells * ctx.world.meta.cellSizeM ** 2) / 1e6).toFixed(1);
    ctx.log.emit("impact", messages.tsunamiImpact(areaKm2, flood.runupM, lost, this.foundBeforeImpact));
    for (const d of ctx.fleet) d.commitment = 0; // new situation: let the fleet re-evaluate freely
    ctx.replan.request("tsunami impact", true);
  }
}
