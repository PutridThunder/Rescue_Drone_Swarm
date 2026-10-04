// DeepSearch: sends the area, scenario and the operator's notes to the server's Gemini endpoint
// and applies the priority weights it returns to the live mission (they also carry over to
// restarts). The simulation runs the same with or without it.

import { requestDeepSearch, toPlannerWeights } from "../intel/deepSearch";
import { DEFAULT_WEIGHTS } from "../sim/defaults";
import type { World } from "../types";
import { DeepSearchPanel } from "../ui/components/DeepSearchPanel";
import type { Hud } from "../ui/Hud";
import { hasCoastline } from "./config";
import type { MissionRunner } from "./MissionRunner";

export class DeepSearchController {
  private readonly panel: DeepSearchPanel;
  private busy = false;

  constructor(
    private readonly world: World,
    private readonly runner: MissionRunner,
    private readonly hud: Hud,
  ) {
    this.panel = new DeepSearchPanel(hud.deepSearchSlot, {
      onRun: (description) => void this.run(description),
      onReset: () => this.reset(),
    });
  }

  private async run(description: string) {
    if (this.busy) return;
    this.busy = true;
    this.panel.setBusy(true);
    const [south, west, north, east] = this.world.meta.bbox;
    try {
      const result = await requestDeepSearch({
        area: this.world.meta.name,
        lat: (south + north) / 2,
        lon: (west + east) / 2,
        scenario: this.runner.config.scenario,
        coastal: hasCoastline(this.world),
        description,
        localTime: new Date().toString(),
      });
      this.runner.applyLive({ weights: toPlannerWeights(result.weights) });
      this.panel.showResult(result);
      this.panel.status(`Applied to the mission · ${result.model}`);
      this.hud.toast("DeepSearch priorities applied");
    } catch (err) {
      this.panel.status((err as Error).message, true);
    } finally {
      this.busy = false;
      this.panel.setBusy(false);
    }
  }

  private reset() {
    this.runner.applyLive({ weights: { ...DEFAULT_WEIGHTS } });
    this.panel.clearResult();
    this.panel.status("Back to the default priorities");
  }
}
