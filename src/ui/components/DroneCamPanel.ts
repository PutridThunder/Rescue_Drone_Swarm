// "Drone cam" window: a canvas the renderer draws the drone's view into, a game-style overlay
// (live badge, altitude, battery, target, crosshair), view buttons (drone cam / third person,
// plus map when full screen), thermal mode, and drag-to-move (mouse or touch; the position is
// remembered). Full screen, the window becomes a transparent overlay on the main view.

import type { DroneView } from "../../types";
import { droneColorCss } from "../../render/scene/palette";
import { $, h, prefs } from "../dom";
import "./DroneCamPanel.css";

export type DroneCamView = "fpv" | "chase" | "map";

export interface DroneCamCallbacks {
  onNext(): void;
  onClose(): void;
  onView(view: DroneCamView): void;
  onFull(full: boolean): void;
}

const VIEWS: [DroneCamView, string, string][] = [
  ["fpv", "Cam", "Drone camera (first person)"],
  ["chase", "3rd", "Third person (behind the drone)"],
  ["map", "Map", "Map view following the drone"],
];

const STATUS: Record<DroneView["status"], string> = {
  IDLE: "STANDBY",
  TRAVELLING: "EN ROUTE",
  SEARCHING: "SEARCHING",
  RETURNING: "RTB",
  LOW_BATTERY: "LOW BATTERY",
  CHARGING: "CHARGING",
  MANUAL: "PILOT",
  DISABLED: "SIGNAL LOST",
};
const POSITION_KEY = "dronecam-position";
const EDGE = 8; // px kept between the window and the screen edge

export class DroneCamPanel {
  readonly el: HTMLElement;
  /** The renderer draws the drone's view into this canvas. */
  readonly canvas: HTMLCanvasElement;

  constructor(root: HTMLElement, cb: DroneCamCallbacks) {
    this.el = h(
      "div",
      "dronecam immersive-keep",
      `<canvas class="dronecam-view"></canvas>
       <div class="dronecam-lost">SIGNAL LOST</div>
       <div class="dronecam-top">
         <span class="dronecam-badge"><i></i><b data-id>D1</b> <span data-status>STANDBY</span></span>
         <span class="dronecam-badge" data-telemetry></span>
       </div>
       <div class="dronecam-crosshair"></div>
       <div class="dronecam-bottom">
         <span class="dronecam-badge dronecam-target" data-target></span>
         <span class="dronecam-buttons">
           <span class="dronecam-views">${VIEWS.map(([v, label, title]) => `<button data-view="${v}" title="${title}">${label}</button>`).join("")}</span>
           <button data-action="thermal" title="Thermal camera">Thermal</button>
           <button data-action="next" title="Next drone">Next ›</button>
           <button data-action="full" title="Full screen (F)">⛶</button>
           <button data-action="close" title="Close">✕</button>
         </span>
       </div>`,
    );
    root.appendChild(this.el);
    this.canvas = $<HTMLCanvasElement>(this.el, "canvas");

    $(this.el, '[data-action="thermal"]').addEventListener("click", (e) => {
      const on = this.el.classList.toggle("thermal");
      (e.currentTarget as HTMLElement).classList.toggle("on", on);
    });
    $(this.el, '[data-action="next"]').addEventListener("click", () => cb.onNext());
    $(this.el, '[data-action="close"]').addEventListener("click", () => (this.full ? cb.onFull(false) : cb.onClose()));
    $(this.el, '[data-action="full"]').addEventListener("click", () => cb.onFull(!this.full));
    this.el.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => b.addEventListener("click", () => cb.onView(b.dataset.view as DroneCamView)));
    this.makeDraggable();
  }

  private full = false;

  /** Window (picture in picture) or full-screen overlay, and which view is active. */
  setMode(full: boolean, view: DroneCamView) {
    this.full = full;
    this.el.classList.toggle("full", full);
    this.el.dataset.mode = view;
    this.el.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    $(this.el, '[data-action="full"]').hidden = full;
    $(this.el, '[data-action="close"]').title = full ? "Exit full screen (Esc)" : "Close";
  }

  setVisible(visible: boolean) {
    this.el.hidden = !visible;
    if (visible) requestAnimationFrame(() => this.keepOnScreen());
  }

  update(d: DroneView, target: string | null, altitudeM: number) {
    this.el.style.setProperty("--drone", droneColorCss(d.id));
    this.el.classList.toggle("lost", d.status === "DISABLED");
    $(this.el, "[data-id]").textContent = `D${d.id}`;
    $(this.el, "[data-status]").textContent = STATUS[d.status];
    const alt = d.dockedTruck !== null || d.status === "DISABLED" ? 0 : altitudeM;
    $(this.el, "[data-telemetry]").textContent = `ALT ${alt} m · BAT ${Math.round(d.battery * 100)}%`;
    $(this.el, "[data-target]").textContent = target ? `▸ ${target}` : d.dockedTruck !== null ? `▸ On Truck ${d.dockedTruck}` : "";
  }

  private makeDraggable() {
    let grab: { dx: number; dy: number } | null = null;
    this.el.addEventListener("pointerdown", (e) => {
      if (this.full || (e.target as HTMLElement).closest("button") || e.button > 0) return;
      const r = this.el.getBoundingClientRect();
      grab = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add("dragging");
      e.preventDefault();
    });
    this.el.addEventListener("pointermove", (e) => {
      if (grab) this.moveTo(e.clientX - grab.dx, e.clientY - grab.dy);
    });
    const drop = () => {
      if (!grab) return;
      grab = null;
      this.el.classList.remove("dragging");
      const r = this.el.getBoundingClientRect();
      prefs.set(POSITION_KEY, { x: r.left, y: r.top });
    };
    this.el.addEventListener("pointerup", drop);
    this.el.addEventListener("pointercancel", drop);
    window.addEventListener("resize", () => this.keepOnScreen());
    const saved = prefs.get<{ x: number; y: number } | null>(POSITION_KEY, null);
    if (saved) requestAnimationFrame(() => this.moveTo(saved.x, saved.y));
  }

  private moveTo(x: number, y: number) {
    const maxX = window.innerWidth - this.el.offsetWidth - EDGE;
    const maxY = window.innerHeight - this.el.offsetHeight - EDGE;
    this.el.style.left = `${Math.max(EDGE, Math.min(maxX, x))}px`;
    this.el.style.top = `${Math.max(EDGE, Math.min(maxY, y))}px`;
    this.el.style.right = "auto";
  }

  private keepOnScreen() {
    if (!this.el.style.left) return; // still in its default spot
    const r = this.el.getBoundingClientRect();
    this.moveTo(r.left, r.top);
  }
}
