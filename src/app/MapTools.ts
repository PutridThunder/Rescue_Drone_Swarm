// What a click on the map does, depending on the active tool. Distinguishes clicks from
// camera drags (a press that moves more than a few pixels is a drag).

import type { Renderer } from "../render/scene/Renderer";
import type { World } from "../types";
import type { Hud, Tool } from "../ui/Hud";
import { gridToLatLon, streetNear } from "../world/geo";
import type { DroneCamController } from "./DroneCamController";
import type { MissionRunner } from "./MissionRunner";

const DRAG_THRESHOLD_PX = 5;
const ERASE_RADIUS = 4; // cells

export class MapTools {
  tool: Tool = "move";

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
    private readonly runner: MissionRunner,
    private readonly hud: Hud,
    private readonly droneCam: DroneCamController,
  ) {
    const canvas = renderer.canvas;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointercancel", () => (down = null));
    canvas.addEventListener("pointerup", (e) => {
      const isClick = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= DRAG_THRESHOLD_PX;
      down = null;
      if (isClick) this.click(e.clientX, e.clientY);
    });
    canvas.addEventListener("wheel", () => hud.hidePlace(), { passive: true });
  }

  /** Follow a drone with the camera (null to stop) and show it in the drone cam. */
  follow(id: number | null) {
    this.renderer.setFollow(id);
    this.hud.setFollow(id);
    if (id !== null) this.droneCam.show(id);
  }

  private click(clientX: number, clientY: number) {
    if (this.tool === "move" || this.tool === "fail") {
      const drone = this.renderer.pickDrone(clientX, clientY);
      if (this.tool === "fail") return this.failDrone(drone);
      if (drone !== null) return this.toggleFollow(drone);
    }
    const cell = this.renderer.pick(clientX, clientY);
    if (!cell) return;
    switch (this.tool) {
      case "move":
        this.hud.showPlace({ street: streetNear(this.world, cell.x, cell.y), ...gridToLatLon(this.world, cell.x, cell.y), clientX, clientY });
        break;
      case "survivor":
        this.hud.toast(this.runner.place("survivor", cell.x, cell.y) ? "Survivor hidden — the drones don’t know where" : "Can’t place a survivor there");
        break;
      case "crowd":
        if (!this.runner.place("crowd", cell.x, cell.y)) this.hud.toast("Can’t place a crowd there");
        else if (!this.runner.config.info.population) this.hud.toast("Crowd added — turn on Population intel so drones use it");
        break;
      case "erase": {
        const n = this.runner.erase(cell.x, cell.y, ERASE_RADIUS);
        this.hud.toast(n ? `Removed ${n}` : "Nothing you placed is there");
        break;
      }
    }
  }

  private failDrone(id: number | null) {
    if (id === null) return this.hud.toast("Click directly on a drone");
    if (this.runner.sim.disableDrone(id) === null) this.hud.toast(`Drone ${id} is already down`);
  }

  private toggleFollow(id: number) {
    const next = this.renderer.following === id ? null : id;
    this.follow(next);
    this.hud.toast(next ? `Following Drone ${id}` : "Stopped following");
  }
}
