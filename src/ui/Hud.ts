// The heads-up display: assembles every HUD component and exposes one small API to the app.
//
//   BrandHeader (+ AreaPicker)   TransportBar                    ┌ right SidePanel ┐
//   ┌ left SidePanel ┐                                          │ StatsCard       │
//   │ SetupPanel     │              3D map                      │ FleetList       │
//   │ (+ IntelPanel) │                                          │ DecisionFeed    │
//   └────────────────┘                                          └─────────────────┘
//   Legend                        Toolbar        PlacePopover · ResultsModal · Toast · MobileTabs

import type { EarthObservation, InfoModes, Metrics, Scenario, SimConfig, SimEvent, SimState, Weights } from "../types";
import { BrandHeader } from "./components/BrandHeader";
import { DecisionFeed } from "./components/DecisionFeed";
import { FleetList } from "./components/FleetList";
import { DataSources } from "./components/DataSources";
import { Legend, type ViewOptions } from "./components/Legend";
import { MobileTabs } from "./components/MobileTabs";
import { PlacePopover, type PlaceInfo } from "./components/PlacePopover";
import { ResultsModal } from "./components/ResultsModal";
import { SetupPanel } from "./components/SetupPanel";
import { SidePanel } from "./components/SidePanel";
import { StatsCard } from "./components/StatsCard";
import { Toast } from "./components/Toast";
import { Toolbar, type Tool } from "./components/Toolbar";
import { TransportBar } from "./components/TransportBar";
import { h } from "./dom";
import "./styles/mobile.css"; // after the components: phone overrides win

export type { PlaceInfo, Tool, ViewOptions };

export interface HudCallbacks {
  onStartPause(): void;
  onReset(): void;
  onSpeed(multiplier: number): void;
  onScenario(s: Scenario): void;
  onInfo(info: Partial<InfoModes>): void;
  onSetup(partial: Partial<SimConfig>): void;
  onWeights(w: Partial<Weights>): void;
  onTool(tool: Tool): void;
  onFollow(droneId: number | null): void;
  onView(change: Partial<ViewOptions>): void;
  onChallenge(): void;
}

export class Hud {
  /** The HUD layer (other overlays, like the drone cam window, mount here). */
  readonly el: HTMLElement;
  readonly brand: BrandHeader;
  private readonly transport: TransportBar;
  private readonly setup: SetupPanel;
  private readonly stats: StatsCard;
  private readonly fleet: FleetList;
  private readonly feed: DecisionFeed;
  private readonly toolbar: Toolbar;
  private readonly legend: Legend;
  private readonly sources: DataSources;
  private readonly place: PlacePopover;
  private readonly results: ResultsModal;
  private readonly toaster: Toast;
  private following: number | null = null;

  constructor(root: HTMLElement, config: SimConfig, views: ViewOptions, cb: HudCallbacks) {
    const hud = (this.el = h("div", "hud"));
    root.appendChild(hud);

    this.brand = new BrandHeader(hud);
    this.transport = new TransportBar(hud, {
      onStartPause: cb.onStartPause,
      onReset: cb.onReset,
      onSpeed: cb.onSpeed,
      onDroneCam: (on) => cb.onView({ showDroneCam: on }),
      onChallenge: cb.onChallenge,
    });

    const left = new SidePanel(hud, "left", "Mission setup", "setup");
    this.setup = new SetupPanel(left.body, config, cb);
    this.sources = new DataSources(left.body);

    const right = new SidePanel(hud, "right", "Live", "live");
    this.stats = new StatsCard(right.body);
    this.fleet = new FleetList(right.body, (id) => {
      this.setFollow(this.following === id ? null : id);
      cb.onFollow(this.following);
    });
    this.feed = new DecisionFeed(right.body);

    this.toolbar = new Toolbar(hud, cb.onTool);
    this.legend = new Legend(hud, views, cb.onView);
    this.place = new PlacePopover(hud);
    this.results = new ResultsModal(hud, cb.onReset);
    this.toaster = new Toast(hud);
    new MobileTabs(hud);
    this.toolbar.setTool("move");
  }

  /** Where the crowd intel panel is mounted (inside mission setup). */
  get intelSlot(): HTMLElement {
    return this.setup.intelSlot;
  }

  setConfig(config: SimConfig) {
    this.setup.setConfig(config);
  }

  setTsunamiAvailable(available: boolean) {
    this.setup.setTsunamiAvailable(available);
  }

  /** List the satellite datasets behind this area and offer the satellite image toggle. */
  setEarthObservation(eo: EarthObservation | undefined) {
    this.sources.show(eo?.sources ?? []);
    this.legend.setViewAvailable("showSatellite", !!eo?.satelliteUrl);
  }

  setRunning(running: boolean, started: boolean) {
    this.transport.setRunning(running, started);
  }

  /** Refresh the live numbers (called a few times per second). */
  setState(state: SimState) {
    this.transport.update(state);
    this.stats.update(state);
    this.fleet.update(state);
  }

  log(events: SimEvent[]) {
    this.feed.add(events);
  }

  clearLog() {
    this.feed.clear();
  }

  showResults(m: Metrics, tsunami: boolean) {
    this.results.show(m, tsunami);
  }

  hideResults() {
    this.results.hide();
  }

  showPlace(p: PlaceInfo) {
    this.place.show(p);
  }

  hidePlace() {
    this.place.hide();
  }

  toast(message: string) {
    this.toaster.show(message);
  }

  setTool(tool: Tool) {
    this.toolbar.setTool(tool);
  }

  setFollow(id: number | null) {
    this.following = id;
    this.fleet.setFollowing(id);
  }

  /** Full-screen view: hide everything except overlays marked .immersive-keep. */
  setImmersive(on: boolean) {
    this.el.classList.toggle("immersive", on);
  }

  setDroneCamOn(on: boolean) {
    this.transport.setDroneCamOn(on);
    this.legend.setDroneCamOn(on);
  }
}
