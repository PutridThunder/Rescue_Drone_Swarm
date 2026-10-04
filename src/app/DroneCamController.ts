// Which drone the picture-in-picture camera shows, and whether it's on. Keeps the renderer,
// the window and the HUD toggles in sync.

import type { Renderer } from "../render/scene/Renderer";
import { QUALITY } from "../render/scene/quality";
import type { SimState } from "../types";
import { DroneCamPanel } from "../ui/components/DroneCamPanel";
import type { Hud } from "../ui/Hud";

export class DroneCamController {
  private readonly panel: DroneCamPanel;
  private droneId = 1;
  private on = QUALITY.droneCamByDefault; // off by default on phones: it renders the scene twice

  constructor(
    root: HTMLElement,
    private readonly renderer: Renderer,
    private readonly hud: Hud,
    private readonly state: () => SimState,
  ) {
    this.panel = new DroneCamPanel(root, { onNext: () => this.next(), onClose: () => this.setOn(false) });
    this.sync();
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

  /** Refresh the overlay text (altitude, battery, target). */
  refresh() {
    if (!this.on) return;
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

  private sync() {
    this.renderer.setDroneCam(this.on ? this.droneId : null, this.panel.canvas);
    this.panel.setVisible(this.on);
    this.hud.setDroneCamOn(this.on);
  }
}
