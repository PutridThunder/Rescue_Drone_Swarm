// Top control bar: start/pause, speed, restart, drone cam toggle, challenge mode, mission clock,
// tsunami countdown.

import type { SimState } from "../../types";
import { $, delegate, h } from "../dom";
import { formatClock } from "../format";
import { icon } from "../icons";
import "./TransportBar.css";

export interface TransportCallbacks {
  onStartPause(): void;
  onReset(): void;
  onSpeed(multiplier: number): void;
  onDroneCam(on: boolean): void;
  onChallenge(): void;
}

const SPEEDS = [1, 2, 4, 8];

export class TransportBar {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement, cb: TransportCallbacks) {
    this.el = h(
      "div",
      "transport card",
      `<button class="btn primary transport-play"></button>
       <div class="seg transport-speed">${SPEEDS.map((s) => `<button data-speed="${s}" class="${s === 1 ? "on" : ""}">${s}×</button>`).join("")}</div>
       <button class="btn icon transport-reset" title="Restart mission">${icon("reset")}</button>
       <button class="btn transport-cam" title="Show or hide the drone camera">${icon("camera")}<span>Drone cam</span></button>
       <button class="btn transport-game" title="Fly a drone yourself against the algorithm">${icon("gamepad")}<span>Challenge</span></button>
       <span class="transport-clock">00:00</span>
       <span class="chip danger transport-tsunami" hidden></span>`,
    );
    root.appendChild(this.el);

    $(this.el, ".transport-play").addEventListener("click", () => cb.onStartPause());
    $(this.el, ".transport-reset").addEventListener("click", () => cb.onReset());
    delegate(this.el, "click", ".transport-speed button", (b) => {
      this.el.querySelectorAll(".transport-speed button").forEach((x) => x.classList.toggle("on", x === b));
      cb.onSpeed(Number(b.dataset.speed));
    });
    $(this.el, ".transport-game").addEventListener("click", () => cb.onChallenge());
    $(this.el, ".transport-cam").addEventListener("click", () => {
      const on = !$(this.el, ".transport-cam").classList.contains("on");
      this.setDroneCamOn(on);
      cb.onDroneCam(on);
    });
  }

  setRunning(running: boolean, started: boolean) {
    const b = $(this.el, ".transport-play");
    b.innerHTML = running ? `${icon("pause")}<span>Pause</span>` : `${icon("play")}<span>${started ? "Resume" : "Start mission"}</span>`;
    b.classList.toggle("is-running", running);
  }

  setDroneCamOn(on: boolean) {
    $(this.el, ".transport-cam").classList.toggle("on", on);
  }

  update(state: SimState) {
    $(this.el, ".transport-clock").textContent = formatClock(state.time);
    const chip = $(this.el, ".transport-tsunami");
    const flood = state.flood;
    chip.hidden = !flood;
    if (!flood) return;
    chip.classList.toggle("hit", flood.impacted);
    chip.textContent = flood.impacted
      ? `Wave hit · ${state.metrics.survivorsLost} lost`
      : `Tsunami in ${formatClock(Math.max(0, flood.timeToImpact))}`;
  }
}
