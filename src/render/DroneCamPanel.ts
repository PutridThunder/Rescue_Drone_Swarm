// Picture-in-picture "drone cam" window: a canvas the renderer draws into, with a game-style
// overlay (live badge, altitude, battery, target, crosshair), thermal mode, and drag-to-move.

import type { DroneView } from "../types";
import { droneColorCss } from "./palette";

export interface DroneCamCallbacks {
  onNext(): void;
  onClose(): void;
}

const STATUS: Record<DroneView["status"], string> = {
  IDLE: "STANDBY",
  TRAVELLING: "EN ROUTE",
  SEARCHING: "SEARCHING",
  RETURNING: "RTB",
  LOW_BATTERY: "LOW BATTERY",
  CHARGING: "CHARGING",
  DISABLED: "SIGNAL LOST",
};

const POSITION_KEY = "dronecam-position"; // remembered per browser
const EDGE = 8; // px kept between the window and the screen edge

export class DroneCamPanel {
  readonly el: HTMLElement;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;

  constructor(root: HTMLElement, cb: DroneCamCallbacks) {
    this.el = document.createElement("div");
    this.el.className = "dronecam";
    this.el.innerHTML = `
      <canvas class="viewport" id="cam-viewport"></canvas>
      <div class="lost">SIGNAL LOST</div>
      <div class="hud-top">
        <span class="live"><i></i><b id="cam-id">D1</b> <span id="cam-status">STANDBY</span></span>
        <span class="tele" id="cam-tele"></span>
      </div>
      <div class="crosshair"></div>
      <div class="hud-bottom">
        <span id="cam-target"></span>
        <span class="buttons">
          <button id="cam-thermal" title="Thermal camera">Thermal</button>
          <button id="cam-next" title="Next drone">Next ›</button>
          <button id="cam-close" title="Close">✕</button>
        </span>
      </div>`;
    root.appendChild(this.el);
    this.q("#cam-thermal").addEventListener("click", () => {
      this.el.classList.toggle("is-thermal");
      this.q("#cam-thermal").classList.toggle("on", this.el.classList.contains("is-thermal"));
    });
    this.q("#cam-next").addEventListener("click", () => cb.onNext());
    this.q("#cam-close").addEventListener("click", () => cb.onClose());
    this.makeDraggable();
  }

  /** Drag the window by pressing anywhere on it except its buttons (mouse or touch). */
  private makeDraggable() {
    let grab: { dx: number; dy: number } | null = null;
    this.el.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button") || e.button > 0) return;
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
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify({ x: r.left, y: r.top }));
      } catch {
        // storage unavailable (private mode): position just isn't remembered
      }
    };
    this.el.addEventListener("pointerup", drop);
    this.el.addEventListener("pointercancel", drop);
    window.addEventListener("resize", () => this.keepOnScreen());
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as { x: number; y: number } | null;
      if (saved) requestAnimationFrame(() => this.moveTo(saved.x, saved.y));
    } catch {
      // ignore unreadable saved position
    }
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

  /** The canvas the renderer draws the drone's view into. */
  get viewport(): HTMLCanvasElement {
    return this.q<HTMLCanvasElement>("#cam-viewport");
  }

  setVisible(visible: boolean) {
    this.el.hidden = !visible;
    if (visible) requestAnimationFrame(() => this.keepOnScreen());
  }

  update(d: DroneView, target: string | null, altitudeM: number) {
    this.el.style.setProperty("--drone", droneColorCss(d.id));
    this.el.classList.toggle("is-lost", d.status === "DISABLED");
    this.q("#cam-id").textContent = `D${d.id}`;
    this.q("#cam-status").textContent = STATUS[d.status];
    const alt = d.dockedTruck !== null || d.status === "DISABLED" ? 0 : altitudeM;
    this.q("#cam-tele").textContent = `ALT ${alt} m · BAT ${Math.round(d.battery * 100)}%`;
    this.q("#cam-target").textContent = target ? `▸ ${target}` : d.dockedTruck !== null ? `▸ On Truck ${d.dockedTruck}` : "";
  }
}
