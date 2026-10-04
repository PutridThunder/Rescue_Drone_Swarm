// Crowd intel flow (fully offline): when the disaster time changes, recompute the hotspots and
// hand them to the mission as predicted crowds.

import { loadOfflineIntel, offlineReport, type OfflineIntel } from "../intel/client";
import { hotspotsToCrowds, type CrowdPlacement } from "../intel/toCrowds";
import type { World } from "../types";
import { IntelPanel } from "../ui/components/IntelPanel";

export class CrowdIntelController {
  private constructor(
    private readonly world: World,
    private readonly data: OfflineIntel,
    private readonly panel: IntelPanel,
    private readonly onCrowds: (crowds: CrowdPlacement[]) => void,
  ) {}

  static async create(areaId: string, world: World, mount: HTMLElement, onCrowds: (crowds: CrowdPlacement[]) => void): Promise<CrowdIntelController> {
    const data = await loadOfflineIntel(areaId);
    let controller: CrowdIntelController | null = null;
    const now = new Date();
    const panel = new IntelPanel(mount, now, data.regional, (at) => controller?.setTime(at));
    controller = new CrowdIntelController(world, data, panel, onCrowds);
    controller.setTime(now);
    return controller;
  }

  setTime(at: Date) {
    const report = offlineReport(this.data, at);
    this.panel.setReport(report);
    this.onCrowds(hotspotsToCrowds(this.world, report.hotspots));
  }
}
