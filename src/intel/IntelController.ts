// Runs the crowd intel flow: offline report first (instant), online search on request.
// Hands the resulting crowds to the app through `onCrowds`.

import { IntelPanel } from "../render/IntelPanel";
import type { World } from "../types";
import { loadOfflineIntel, offlineReport, searchOnline, type OfflineIntel } from "./client";
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

  static async create(world: World, mount: HTMLElement, onCrowds: (crowds: CrowdPlacement[], report: IntelReport) => void): Promise<IntelController> {
    const data = await loadOfflineIntel();
    let controller: IntelController | null = null;
    const panel = new IntelPanel(mount, new Date(), data.regional, {
      onTimeChange: (at) => controller?.setTime(at),
      onSearchOnline: () => controller?.searchOnline(),
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

  async searchOnline() {
    this.panel.setBusy("Searching OpenStreetMap, events and social media…");
    try {
      this.publish(await searchOnline(this.at, this.world.meta.bbox));
    } catch (err) {
      this.panel.setError(`Online search unavailable (${(err as Error).message}) — using offline data`);
    }
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
