// Runs the crowd intel flow (fully offline): recompute hotspots whenever the disaster time changes
// and hand the resulting crowds to the app through `onCrowds`.

import { IntelPanel } from "../render/IntelPanel";
import type { World } from "../types";
import { loadOfflineIntel, offlineReport, type OfflineIntel } from "./client";
import { hotspotsToCrowds, type CrowdPlacement } from "./toCrowds";
import type { IntelReport } from "./types";

export class IntelController {
  private at = new Date();
  private report: IntelReport | null = null;

  private constructor(
    private readonly world: World,
    private readonly data: OfflineIntel,
    private readonly panel: IntelPanel,
    private readonly onCrowds: (crowds: CrowdPlacement[], report: IntelReport) => void,
  ) {}

  static async create(
    areaId: string,
    world: World,
    mount: HTMLElement,
    onCrowds: (crowds: CrowdPlacement[], report: IntelReport) => void,
  ): Promise<IntelController> {
    const data = await loadOfflineIntel(areaId);
    let controller: IntelController | null = null;
    const panel = new IntelPanel(mount, new Date(), data.regional, {
      onTimeChange: (at) => controller?.setTime(at),
    });
    controller = new IntelController(world, data, panel, onCrowds);
    controller.publish(offlineReport(data, controller.at));
    return controller;
  }

  /** New disaster time: recompute the offline layer immediately. */
  setTime(at: Date) {
    this.at = at;
    this.publish(offlineReport(this.data, at));
  }

  get current(): IntelReport | null {
    return this.report;
  }

  private publish(report: IntelReport) {
    this.report = report;
    this.panel.setReport(report);
    this.onCrowds(hotspotsToCrowds(this.world, report.hotspots), report);
  }
}
