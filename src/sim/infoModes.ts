import type { InfoModes } from "../types";
import type { SimContext } from "./context";
import { estimateHazard } from "./scenario";

/**
 * Apply what the fleet is told up front (the "What the drones know" switches). Called at start
 * (prev = null) and whenever a switch changes; only the parts that changed are recomputed.
 */
export function applyInfoModes(ctx: SimContext, prev: InfoModes | null) {
  const info = ctx.state.config.info;
  const k = ctx.knowledge;

  if (!prev || prev.geography !== info.geography) {
    // Street map known: every cell's geography (and obstacles) is known; otherwise only what was seen.
    for (let i = 0; i < ctx.N; i++) {
      k.known[i] = info.geography || k.searched[i] > 0 ? 1 : 0;
      ctx.navBlocked[i] = k.known[i] & ctx.masks.tall[i];
    }
    k.markAllDirty();
  }

  if (!prev || prev.disaster !== info.disaster || prev.elevation !== info.elevation) {
    const { hazardTruth, floodMask, floodProne } = ctx.tsunami;
    if (info.disaster && hazardTruth && floodMask) {
      estimateHazard(ctx.world, info, hazardTruth, floodMask, k.hazardBuf, floodProne);
      k.view.hazard = k.hazardBuf;
      ctx.nav.setHazard(k.hazardBuf);
    } else {
      k.view.hazard = null;
      ctx.nav.setHazard(null);
      floodProne.fill(0);
    }
    k.markAllDirty();
  }
}
