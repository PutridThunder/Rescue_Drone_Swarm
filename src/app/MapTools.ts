// What a click on the map does, depending on the active tool. Distinguishes clicks from
// camera drags (a press that moves more than a few pixels is a drag). The search-area tool
// instead turns a drag into a circle (centre where the press starts).

import type { Renderer } from "../render/scene/Renderer";
import type { SearchArea, World } from "../types";
import type { Hud, Tool } from "../ui/Hud";
import { gridToLatLon, streetNear } from "../world/geo";
import type { DroneCamController } from "./DroneCamController";
import type { MissionRunner } from "./MissionRunner";

const DRAG_THRESHOLD_PX = 5;
const ERASE_RADIUS = 4; // cells
const MIN_AREA_RADIUS = 5; // cells (50 m); a smaller drag counts as a click

export class MapTools {
  private current: Tool = "move";
  private drawing: { centre: { x: number; y: number }; area: SearchArea | null } | null = null;

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
    private readonly runner: MissionRunner,
    private readonly hud: Hud,
    private readonly droneCam: DroneCamController,
    /** A new search circle was drawn (null: search everywhere). */
    private readonly onSearchArea: (area: SearchArea | null) => void,
  ) {
    const canvas = renderer.canvas;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (this.current === "area") this.startCircle(e);
    });
    canvas.addEventListener("pointermove", (e) => this.dragCircle(e));
    canvas.addEventListener("pointercancel", () => {
      down = null;
      this.endCircle(false);
    });
    canvas.addEventListener("pointerup", (e) => {
      const isClick = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= DRAG_THRESHOLD_PX;
      down = null;
      if (this.drawing) {
        this.dragCircle(e); // the release point sets the final radius
        this.endCircle(!isClick);
      }
      if (isClick) this.click(e.clientX, e.clientY);
    });
    canvas.addEventListener("wheel", () => hud.hidePlace(), { passive: true });
  }

  get tool(): Tool {
    return this.current;
  }

  set tool(tool: Tool) {
    this.current = tool;
    this.renderer.setCameraLocked(tool === "area"); // dragging draws instead of panning
  }

  private startCircle(e: PointerEvent) {
    const centre = this.renderer.pick(e.clientX, e.clientY);
    if (!centre) return;
    this.drawing = { centre, area: null };
    try {
      this.renderer.canvas.setPointerCapture(e.pointerId); // keep receiving moves outside the canvas
    } catch {
      // the pointer is already gone (e.g. a synthetic event); drawing still works without capture
    }
  }

  private dragCircle(e: PointerEvent) {
    if (!this.drawing) return;
    const p = this.renderer.pick(e.clientX, e.clientY);
    if (!p) return;
    const { centre } = this.drawing;
    const r = Math.hypot(p.x - centre.x, p.y - centre.y);
    this.drawing.area = r >= MIN_AREA_RADIUS ? { x: centre.x, y: centre.y, r } : null;
    this.renderer.previewSearchArea(this.drawing.area);
  }

  private endCircle(commit: boolean) {
    const area = this.drawing?.area ?? null;
    this.drawing = null;
    this.renderer.previewSearchArea(null);
    if (commit && area) this.onSearchArea({ x: round1(area.x), y: round1(area.y), r: round1(area.r) });
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
    if (this.tool === "area") {
      if (this.runner.config.searchArea) this.onSearchArea(null);
      else this.hud.toast("Drag from the centre outwards to draw the search area");
      return;
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

const round1 = (v: number) => Math.round(v * 10) / 10;
