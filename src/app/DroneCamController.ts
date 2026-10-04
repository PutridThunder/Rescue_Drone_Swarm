// The drone cam: which drone it shows, how (first person / third person), and where (a
// picture-in-picture window, or full screen with a map option). Keeps the renderer, the window
// and the HUD toggles in sync. Keys while full screen: V cycles views, Esc exits; F toggles.

import type { Renderer } from "../render/scene/Renderer";
import { QUALITY } from "../render/scene/quality";
import type { SimState } from "../types";
import { DroneCamPanel, type DroneCamView } from "../ui/components/DroneCamPanel";
import type { Hud } from "../ui/Hud";

const CYCLE: DroneCamView[] = ["chase", "fpv", "map"];

export class DroneCamController {
  private readonly panel: DroneCamPanel;
  private droneId = 1;
  private on = QUALITY.droneCamByDefault; // off by default on phones: it renders the scene twice
  private full = false;
  private view: DroneCamView = "fpv";
  private following = false; // the map camera is following our drone (full-screen map view)
  /** Called when full screen is entered or left (the challenge uses it to end the game). */
  onFullChange: ((full: boolean) => void) | null = null;

  constructor(
    root: HTMLElement,
    private readonly renderer: Renderer,
    private readonly hud: Hud,
    private readonly state: () => SimState,
  ) {
    this.panel = new DroneCamPanel(root, {
      onNext: () => this.next(),
      onClose: () => this.setOn(false),
      onView: (v) => this.setView(v),
      onFull: (f) => this.setFull(f),
    });
    window.addEventListener("keydown", (e) => this.key(e));
    this.sync();
  }

  get isFull(): boolean {
    return this.full;
  }

  setOn(on: boolean) {
    this.on = on;
    this.sync();
  }

  /** Show a specific drone (e.g. the one being followed). */
  show(droneId: number) {
    this.droneId = droneId;
    this.sync();
  }

  setView(view: DroneCamView) {
    this.view = !this.full && view === "map" ? "fpv" : view;
    this.sync();
  }

  setFull(full: boolean) {
    if (full === this.full) return;
    this.full = full;
    if (!full && this.view === "map") this.view = "fpv";
    this.sync();
    this.onFullChange?.(full);
  }

  /** Refresh the overlay text (altitude, battery, target). */
  refresh() {
    if (!this.on && !this.full) return;
    const st = this.state();
    const d = st.drones.find((x) => x.id === this.droneId) ?? st.drones[0];
    if (!d) return;
    this.droneId = d.id;
    const target = d.taskId != null ? (st.tasks.find((t) => t.id === d.taskId)?.label ?? null) : null;
    this.panel.update(d, target, st.config.flightAltitudeM);
  }

  private next() {
    const ids = this.state().drones.map((d) => d.id);
    this.show(ids[(ids.indexOf(this.droneId) + 1) % ids.length]);
  }

  private key(e: KeyboardEvent) {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if (k === "f" && (this.on || this.full)) this.setFull(!this.full);
    else if (!this.full) return;
    else if (k === "escape") this.setFull(false);
    else if (k === "v") this.setView(CYCLE[(CYCLE.indexOf(this.view) + 1) % CYCLE.length]);
  }

  private sync() {
    const { renderer } = this;
    const droneView = this.full && this.view !== "map";
    renderer.setDroneCamStyle(this.view === "chase" ? "chase" : "fpv");
    renderer.setDroneView(droneView);
    renderer.setDroneCam(this.full || this.on ? this.droneId : null, this.full ? null : this.panel.canvas);

    // Full-screen map view: the map camera follows our drone.
    const follow = this.full && this.view === "map";
    if (follow) renderer.setFollow(this.droneId);
    else if (this.following) renderer.setFollow(null);
    if (follow !== this.following) this.hud.setFollow(follow ? this.droneId : null);
    this.following = follow;

    this.panel.setMode(this.full, this.view);
    this.panel.setVisible(this.on || this.full);
    this.hud.setImmersive(this.full);
    this.hud.setDroneCamOn(this.on);
    this.refresh();
  }
}
