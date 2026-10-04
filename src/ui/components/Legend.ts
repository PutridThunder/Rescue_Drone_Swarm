// Map key plus view toggles (paths, camera footprints, street names, hidden survivors, drone cam).

import type { RenderOptions } from "../../render/scene/Renderer";
import { $, delegate, h } from "../dom";
import "./Legend.css";

/** View options shown as checkboxes; showDroneCam is handled by the app (not the renderer). */
export type ViewOptions = RenderOptions & { showDroneCam: boolean };

const KEYS = [
  ["unsearched", "Not searched"],
  ["searched", "Searched"],
  ["frontier", "Frontier"],
  ["tall", "Too tall to overfly"],
  ["survivor", "Survivor found"],
  ["truck", "Charging truck"],
];

const VIEWS: [keyof ViewOptions, string][] = [
  ["showPaths", "Flight paths"],
  ["showSensors", "Camera view"],
  ["showLabels", "Street names"],
  ["revealHidden", "Reveal hidden survivors"],
  ["showDroneCam", "Drone cam"],
];

export class Legend {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement, initial: ViewOptions, onView: (change: Partial<ViewOptions>) => void) {
    this.el = h(
      "div",
      "legend card",
      `<div class="legend-keys">${KEYS.map(([k, label]) => `<span><i class="legend-swatch swatch-${k}"></i>${label}</span>`).join("")}</div>
       <div class="legend-views">${VIEWS.map(
         ([k, label]) => `<label class="check"><input type="checkbox" data-view="${k}" ${initial[k] ? "checked" : ""}>${label}</label>`,
       ).join("")}</div>`,
    );
    root.appendChild(this.el);
    delegate<HTMLInputElement>(this.el, "change", "[data-view]", (input) => onView({ [input.dataset.view as keyof ViewOptions]: input.checked }));
  }

  setDroneCamOn(on: boolean) {
    $<HTMLInputElement>(this.el, '[data-view="showDroneCam"]').checked = on;
  }
}
