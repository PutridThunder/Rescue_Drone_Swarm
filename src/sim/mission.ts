import type { SimContext } from "./context";
import { messages } from "./messages";

/** Mission-level bookkeeping: live metrics and the end of the search. */
export class Mission {
  constructor(private readonly ctx: SimContext) {}

  updateMetrics() {
    const { ctx } = this;
    let dist = 0;
    for (const d of ctx.fleet) dist += d.distanceTravelled;
    ctx.stats.apply(ctx.state.metrics, ctx.state.time, dist, ctx.cfg.batteryCapacity);
  }

  /** Search over: every drone flies back to a truck and lands, and the trucks park. */
  finish() {
    const { ctx } = this;
    const st = ctx.state;
    if (st.metrics.complete) return;
    this.updateMetrics();
    st.metrics.complete = true;
    for (const d of ctx.fleet) {
      if (!d.active) continue;
      if (d.taskId != null) ctx.sectors.get(d.taskId).view.assignedDrone = null;
      d.taskId = null;
      d.path = [];
      if (d.airborne) {
        d.status = "RETURNING";
        ctx.nav.pathToTruck(d);
      } else if (!d.charging) d.status = "IDLE";
    }
    ctx.depot.parkAll();
    const m = st.metrics;
    ctx.log.emit(
      "complete",
      messages.missionComplete(st.time, Math.round(m.areaSearchedFrac * 100), m.survivorsFound, m.survivorsTotal, m.survivorsLost),
    );
  }
}
