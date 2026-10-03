// Picture-in-picture "drone cam" window: a transparent viewport the renderer draws into, with a
// game-style overlay (live badge, altitude, battery, target, crosshair) and thermal mode.

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
  }

  /** The canvas the renderer draws the drone's view into. */
  get viewport(): HTMLCanvasElement {
    return this.q<HTMLCanvasElement>("#cam-viewport");
  }

  setVisible(visible: boolean) {
    this.el.hidden = !visible;
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
